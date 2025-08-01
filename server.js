// server.js - Version 2.0 (Scalable & Robust)

// 1. Imports
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const { createClient } = require('redis');
const { createAdapter } = require('@socket.io/redis-adapter');

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

// Création des clients Redis
const pubClient = createClient({ url: REDIS_URL });
const subClient = pubClient.duplicate();

// Fonction principale pour démarrer l'application
async function startServer() {
    try {
        // Connexion des clients Redis
        await Promise.all([pubClient.connect(), subClient.connect()]);
        console.log('✅ [Redis] Clients connected.');

        // Configuration de l'adaptateur Redis pour Socket.IO
        io.adapter(createAdapter(pubClient, subClient));
        console.log('✅ [Socket.IO] Redis adapter configured.');

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
        console.log(`[Join] User ${socket.id} joins with pseudo: "${pseudo}"`);
        // Stocke les informations de l'utilisateur dans Redis
        await pubClient.hSet(KEYS.USER_DATA(socket.id), {
            pseudo: pseudo || 'Anonymous',
            status: 'searching'
        });
        await findPartner(socket);
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
            // Ici, on pourrait incrémenter un score de signalement dans Redis
            // await pubClient.hIncrBy(KEYS.USER_DATA(partnerId), 'reports', 1);
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
        const [currentUserPseudo, partnerPseudo] = await Promise.all([
            pubClient.hGet(KEYS.USER_DATA(socket.id), 'pseudo'),
            pubClient.hGet(KEYS.USER_DATA(partnerId), 'pseudo')
        ]);

        // On utilise une transaction Redis pour assurer l'atomicité
        const transaction = pubClient.multi();
        transaction.hSet(KEYS.USER_DATA(socket.id), { status: 'connected', partnerId: partnerId });
        transaction.hSet(KEYS.USER_DATA(partnerId), { status: 'connected', partnerId: socket.id });
        await transaction.exec();

        // Notifier les deux utilisateurs
        io.to(socket.id).emit('app:state-update', {
            state: 'connected',
            partner: { pseudo: partnerPseudo },
            initiator: true
        });
        io.to(partnerId).emit('app:state-update', {
            state: 'connected',
            partner: { pseudo: currentUserPseudo },
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
