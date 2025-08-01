// server.js - Version 2.0 (Scalable & Robust)

// 1. Imports
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const { createClient } = require('redis');
const { createAdapter } = require('@socket.io/redis-adapter');
const sanitize = require('./utils/sanitize');
const createHandleReport = require('./utils/moderation');
let geoip;
try {
    geoip = require('geoip-lite');
} catch (e) {
    console.warn('geoip-lite not installed, geolocation disabled.');
    geoip = { lookup: () => null };
}

let handleReport;

// 2. Initialisation
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*", // Pour la simplicité, en production, à restreindre
    }
});

const PORT = process.env.PORT || 3000;
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

// Clés Redis pour une gestion centralisée
const KEYS = {
    WAITING_QUEUE: 'orbital:queue:waiting',
    USER_DATA: (id) => `orbital:user:${id}`,
};

const GEOIP_CACHE_PREFIX = 'orbital:geoip:';

function getCountryFlagEmoji(code) {
    return code === 'XX'
        ? '✨'
        : String.fromCodePoint(...[...code.toUpperCase()].map(c => 127397 + c.charCodeAt()));
}

const displayNames = new Intl.DisplayNames(['fr'], { type: 'region' });
function getCountryName(code) {
    if (code === 'XX') return '';
    try { return displayNames.of(code); } catch (_) { return ''; }
}

async function getGeoData(ip) {
    const cacheKey = `${GEOIP_CACHE_PREFIX}${ip}`;
    const cached = await pubClient.get(cacheKey);
    if (cached) return JSON.parse(cached);
    const geo = geoip.lookup(ip) || {};
    const countryCode = geo.country || 'XX';
    const data = {
        code: countryCode,
        emoji: getCountryFlagEmoji(countryCode),
        name: getCountryName(countryCode)
    };
    await pubClient.set(cacheKey, JSON.stringify(data), { EX: 86400 });
    return data;
}

// Création des clients Redis
const pubClient = createClient({ url: REDIS_URL });
const subClient = pubClient.duplicate();

// Fonction principale pour démarrer l'application
async function startServer() {
    try {
        // Connexion des clients Redis
        await Promise.all([pubClient.connect(), subClient.connect()]);
        console.log('✅ [Redis] Clients connected.');

        // Pré-chargement de la base GeoIP
        try { geoip.lookup('127.0.0.1'); } catch (_) {}

        // Initialise moderation utilities
        handleReport = createHandleReport({ pubClient, io });

        // Configuration de l'adaptateur Redis pour Socket.IO
        io.adapter(createAdapter(pubClient, subClient));
        console.log('✅ [Socket.IO] Redis adapter configured.');

        // Middleware GeoIP pour chaque connexion
        io.use(async (socket, next) => {
            const ip = (socket.handshake.headers['x-forwarded-for'] || socket.handshake.address || '').split(',')[0].trim();
            socket.geoData = await getGeoData(ip);
            next();
        });

        // Middleware pour servir les fichiers statiques
        app.use(express.static(path.join(__dirname, 'public')));

        // 3. Gestionnaire de connexion Socket.IO
        io.on('connection', handleConnection);

        // Démarrage du serveur HTTP
        server.listen(PORT, () => {
            console.log(`🚀 [Server] Orbital Chat listening on http://localhost:${PORT}`);
        });

    } catch (err) {
        console.error('❌ [Critical] Failed to start server:', err);
        process.exit(1);
    }
}

// Gestionnaire pour chaque nouvelle connexion
function handleConnection(socket) {
    console.log(`[Connection] User connected: ${socket.id}`);

    // Événement: un utilisateur rejoint le système
    socket.on('user:join', async ({ pseudo }) => {
        const safePseudo = sanitize(pseudo);
        console.log(`[Join] User ${socket.id} joins with pseudo: "${safePseudo}"`);
        await pubClient.hSet(KEYS.USER_DATA(socket.id), {
            pseudo: safePseudo || 'Anonymous',
            status: 'searching',
            countryCode: socket.geoData.code,
            countryEmoji: socket.geoData.emoji,
            countryName: socket.geoData.name
        });
        await findPartner(socket);
    });

    // Chat textuel
    socket.on('chat:text', async ({ text }) => {
        const partnerId = await pubClient.hGet(KEYS.USER_DATA(socket.id), 'partnerId');
        if (!partnerId) return;
        const cleanText = sanitize(text);
        const payload = { text: cleanText, sender: socket.id, timestamp: Date.now() };
        await pubClient.rPush(`orbital:chat:${socket.id}:${partnerId}`, JSON.stringify(payload));
        await pubClient.expire(`orbital:chat:${socket.id}:${partnerId}`, 3600);
        io.to(partnerId).emit('chat:text', payload);
    });

    // Événements de signalisation WebRTC
    socket.on('webrtc:offer', (data) => relayWebRTCSignal(socket, 'webrtc:offer', data));
    socket.on('webrtc:answer', (data) => relayWebRTCSignal(socket, 'webrtc:answer', data));
    socket.on('webrtc:ice-candidate', (data) => relayWebRTCSignal(socket, 'webrtc:ice-candidate', data));

    // Événement: l'utilisateur demande un nouveau partenaire
    socket.on('user:request-next', async () => {
        console.log(`[Next] User ${socket.id} requests a new partner.`);
        await cleanupAndFindNewPartner(socket);
    });
    
    // Événement: l'utilisateur signale son partenaire
    socket.on('user:report', async () => {
        const partnerId = await pubClient.hGet(KEYS.USER_DATA(socket.id), 'partnerId');
        if (partnerId) {
            console.log(`[Report] User ${socket.id} reported partner ${partnerId}.`);
            await handleReport(partnerId);
        }
    });

    // Événement: déconnexion
    socket.on('disconnect', () => {
        console.log(`[Disconnection] User disconnected: ${socket.id}`);
        handleDisconnect(socket);
    });
}

// 4. Fonctions de Matchmaking et de Signalisation

/**
 * Tente de trouver un partenaire pour un socket donné.
 * @param {import('socket.io').Socket} socket - Le socket de l'utilisateur.
 */
async function findPartner(socket) {
    console.log(`[Matchmaking] ${socket.id} is looking for a partner.`);
    
    // On essaie de trouver un partenaire en attente
    const partnerId = await pubClient.lPop(KEYS.WAITING_QUEUE);

    if (partnerId && partnerId !== socket.id) {
        // Partenaire trouvé ! Vérifions s'il est toujours en ligne.
        const partnerExists = await pubClient.exists(KEYS.USER_DATA(partnerId));
        if (!partnerExists) {
            console.log(`[Matchmaking] Popped partner ${partnerId} no longer exists. Searching again.`);
            return findPartner(socket); // Récursivité pour trouver un autre partenaire
        }

        console.log(`[Matchmaking] Partner found for ${socket.id}: ${partnerId}`);
        const [currentUserData, partnerData] = await Promise.all([
            pubClient.hGetAll(KEYS.USER_DATA(socket.id)),
            pubClient.hGetAll(KEYS.USER_DATA(partnerId))
        ]);

        // On utilise une transaction Redis pour assurer l'atomicité
        const transaction = pubClient.multi();
        transaction.hSet(KEYS.USER_DATA(socket.id), { status: 'connected', partnerId: partnerId });
        transaction.hSet(KEYS.USER_DATA(partnerId), { status: 'connected', partnerId: socket.id });
        await transaction.exec();

        // Notifier les deux utilisateurs
        io.to(socket.id).emit('app:state-update', {
            state: 'connected',
            partner: {
                pseudo: partnerData.pseudo,
                country: {
                    code: partnerData.countryCode,
                    emoji: partnerData.countryEmoji,
                    name: partnerData.countryName
                }
            },
            initiator: true
        });
        io.to(partnerId).emit('app:state-update', {
            state: 'connected',
            partner: {
                pseudo: currentUserData.pseudo,
                country: {
                    code: currentUserData.countryCode,
                    emoji: currentUserData.countryEmoji,
                    name: currentUserData.countryName
                }
            },
            initiator: false
        });

    } else {
        // Personne en attente, on ajoute l'utilisateur à la file
        console.log(`[Matchmaking] No partner found. Adding ${socket.id} to queue.`);
        await pubClient.rPush(KEYS.WAITING_QUEUE, socket.id);
        socket.emit('app:state-update', { state: 'waiting' });
    }
}

/**
 * Relaie un signal WebRTC à un partenaire.
 * @param {import('socket.io').Socket} socket
 * @param {string} eventName
 * @param {object} data
 */
async function relayWebRTCSignal(socket, eventName, data) {
    const partnerId = await pubClient.hGet(KEYS.USER_DATA(socket.id), 'partnerId');
    if (partnerId) {
        io.to(partnerId).emit(eventName, data);
    }
}

// 5. Fonctions de Nettoyage

/**
 * Gère la déconnexion propre d'un utilisateur.
 * @param {import('socket.io').Socket} socket
 */
async function handleDisconnect(socket) {
    const partnerId = await pubClient.hGet(KEYS.USER_DATA(socket.id), 'partnerId');

    if (partnerId) {
        // Notifier le partenaire qu'il est seul
        io.to(partnerId).emit('app:partner-left');
        // Mettre à jour le statut du partenaire pour qu'il recherche à nouveau
        await pubClient.hSet(KEYS.USER_DATA(partnerId), { status: 'searching', partnerId: '' });
    }
    
    // Supprimer l'utilisateur de la file d'attente s'il s'y trouvait
    await pubClient.lRem(KEYS.WAITING_QUEUE, 0, socket.id);
    // Supprimer toutes les données de l'utilisateur
    await pubClient.del(KEYS.USER_DATA(socket.id));
    console.log(`[Cleanup] Cleaned up data for ${socket.id}`);
}

/**
 * Gère la demande de "suivant" : nettoie l'ancienne connexion et en cherche une nouvelle.
 * @param {import('socket.io').Socket} socket
 */
async function cleanupAndFindNewPartner(socket) {
    const partnerId = await pubClient.hGet(KEYS.USER_DATA(socket.id), 'partnerId');

    if (partnerId) {
        io.to(partnerId).emit('app:partner-left');
        await pubClient.hSet(KEYS.USER_DATA(partnerId), { status: 'searching', partnerId: '' });
        // On remet le partenaire en recherche
        const partnerSocket = io.sockets.sockets.get(partnerId);
        if (partnerSocket) await findPartner(partnerSocket);
    }
    
    // On cherche un nouveau partenaire pour l'utilisateur actuel
    await pubClient.hSet(KEYS.USER_DATA(socket.id), { status: 'searching', partnerId: '' });
    await findPartner(socket);
}

// Lancement du serveur
startServer();
