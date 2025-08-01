// server.js - Version 3.0 (Ultimate - Sans dotenv)

// 1. Configuration manuelle des variables d'environnement
const config = {
  PORT: 3000, // Port par défaut
  REDIS_URL: 'redis://localhost:6379', // URL Redis par défaut
  ALLOWED_ORIGINS: 'http://localhost:3000', // Origines autorisées
  REDIS_TLS: false // TLS désactivé par défaut
};

// 2. Imports
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const { createClient } = require('redis');
const { createAdapter } = require('@socket.io/redis-adapter');
const sanitize = require('./utils/sanitize');
const createHandleReport = require('./utils/moderation');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const cors = require('cors');

let geoip;
try {
    geoip = require('geoip-lite');
    
} catch (e) {
    console.warn('geoip-lite not installed, geolocation disabled.');
    geoip = { lookup: () => null };
}

let handleReport;

// 3. Initialisation
const app = express();
const server = http.createServer(app);

// Sécurité
app.use(helmet());
app.use(cors({
    origin: config.ALLOWED_ORIGINS.split(',') || '*'
}));

// Limitation des requêtes
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100
});
app.use(limiter);

const io = new Server(server, {
    cors: {
        origin: config.ALLOWED_ORIGINS.split(',') || '*',
        methods: ['GET', 'POST']
    },
    connectionStateRecovery: {
        maxDisconnectionDuration: 2 * 60 * 1000,
        skipMiddlewares: true
    }
});

// Clés Redis pour une gestion centralisée
const KEYS = {
    WAITING_QUEUE: 'orbital:queue:waiting',
    USER_DATA: (id) => `orbital:user:${id}`,
    ACTIVE_CONNECTIONS: 'orbital:stats:connections',
    GEOIP_CACHE: (ip) => `orbital:geoip:${ip}`,
    REPORTS: (userId) => `orbital:reports:${userId}`
};

// Fonctions utilitaires
function getCountryFlagEmoji(code) {
    if (!code || code === 'XX') return '🌐';
    return String.fromCodePoint(...[...code.toUpperCase()].map(c => 127397 + c.charCodeAt()));
}

function getCountryName(code) {
    if (!code || code === 'XX') return 'Inconnu';
    try {
        return new Intl.DisplayNames(['fr'], { type: 'region' }).of(code) || code;
    } catch {
        return code;
    }
}

async function getGeoData(ip, pubClient) {
    if (!ip || ip === '::1' || ip === '127.0.0.1') {
        return {
            code: 'XX',
            emoji: '🌐',
            name: 'Localhost'
        };
    }

    const cacheKey = KEYS.GEOIP_CACHE(ip);
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
const pubClient = createClient({ 
    url: config.REDIS_URL,
    socket: {
        tls: config.REDIS_TLS === 'true',
        rejectUnauthorized: false
    }
});

const subClient = pubClient.duplicate();

// Fonction principale pour démarrer l'application
async function startServer() {
    try {
        await Promise.all([pubClient.connect(), subClient.connect()]);
        console.log('✅ [Redis] Clients connected');

        handleReport = createHandleReport({ pubClient, io });

        io.adapter(createAdapter(pubClient, subClient));
        console.log('✅ [Socket.IO] Redis adapter configured');

        io.use(async (socket, next) => {
            try {
                const ip = socket.handshake.headers['x-forwarded-for']?.split(',')[0].trim() || 
                           socket.handshake.address;
                
                socket.geoData = await getGeoData(ip, pubClient);
                next();
            } catch (err) {
                console.error('GeoIP middleware error:', err);
                next(err);
            }
        });

        io.use(async (socket, next) => {
            const userKey = KEYS.USER_DATA(socket.id);
            const exists = await pubClient.exists(userKey);
            
            if (exists === 0) return next();
            
            const isBanned = await pubClient.hGet(userKey, 'banned');
            if (isBanned === 'true') {
                const ttl = await pubClient.ttl(userKey);
                const error = new Error(`Vous êtes banni pour ${Math.ceil(ttl / 60)} minutes`);
                error.data = { banned: true, ttl };
                return next(error);
            }
            
            next();
        });

        app.use(express.static(path.join(__dirname, 'public')));

        app.get('/health', (req, res) => {
            res.status(200).json({ 
                status: 'healthy',
                connections: io.engine.clientsCount
            });
        });

        io.on('connection', handleConnection);

        setInterval(async () => {
            const count = io.engine.clientsCount;
            await pubClient.set(KEYS.ACTIVE_CONNECTIONS, count);
        }, 5000);

        server.listen(config.PORT, () => {
            console.log(`🚀 [Server] Orbital Chat listening on http://localhost:${config.PORT}`);
        });

    } catch (err) {
        console.error('❌ [Critical] Failed to start server:', err);
        process.exit(1);
    }
}

// Gestionnaire pour chaque nouvelle connexion
function handleConnection(socket) {
    console.log(`[Connection] User connected: ${socket.id}`);
    
    // Mise à jour des statistiques
    pubClient.incr('orbital:stats:total_connections');

    // Ping/pong pour mesurer la latence
    socket.on('ping', () => {
        socket.emit('pong');
    });

    // Événement: un utilisateur rejoint le système
    socket.on('user:join', async ({ pseudo }, callback) => {
        try {
            const safePseudo = sanitize(pseudo);
            console.log(`[Join] User ${socket.id} joins with pseudo: "${safePseudo}"`);

            await pubClient.hSet(KEYS.USER_DATA(socket.id), {
                pseudo: safePseudo || 'Anonymous',
                status: 'searching',
                countryCode: socket.geoData.code,
                countryEmoji: socket.geoData.emoji,
                countryName: socket.geoData.name,
                joinedAt: Date.now(),
                banned: 'false'
            });

            await findPartner(socket);
            callback?.({ success: true });
        } catch (err) {
            console.error('Join error:', err);
            callback?.({ success: false, error: err.message });
        }
    });

    // Chat textuel
    socket.on('chat:text', async ({ text }, callback) => {
        try {
            const partnerId = await pubClient.hGet(KEYS.USER_DATA(socket.id), 'partnerId');
            if (!partnerId) {
                return callback?.({ success: false, error: 'No partner found' });
            }

            const cleanText = sanitize(text);
            if (!cleanText) {
                return callback?.({ success: false, error: 'Empty message' });
            }

            const payload = { 
                text: cleanText, 
                sender: socket.id, 
                timestamp: Date.now() 
            };

            // Enregistrer le message dans Redis (historique)
            await pubClient.rPush(
                `orbital:chat:${socket.id}:${partnerId}`, 
                JSON.stringify(payload)
            );
            
            // Expire après 1h
            await pubClient.expire(
                `orbital:chat:${socket.id}:${partnerId}`,
                3600
            );

            // Envoyer au partenaire
            io.to(partnerId).emit('chat:text', payload);
            callback?.({ success: true });
        } catch (err) {
            console.error('Chat error:', err);
            callback?.({ success: false, error: err.message });
        }
    });

    // Événements de signalisation WebRTC
    socket.on('webrtc:offer', async (data, callback) => {
        try {
            await relayWebRTCSignal(socket, 'webrtc:offer', data);
            callback?.({ success: true });
        } catch (err) {
            callback?.({ success: false, error: err.message });
        }
    });

    socket.on('webrtc:answer', async (data, callback) => {
        try {
            await relayWebRTCSignal(socket, 'webrtc:answer', data);
            callback?.({ success: true });
        } catch (err) {
            callback?.({ success: false, error: err.message });
        }
    });

    socket.on('webrtc:ice-candidate', async (data, callback) => {
        try {
            await relayWebRTCSignal(socket, 'webrtc:ice-candidate', data);
            callback?.({ success: true });
        } catch (err) {
            callback?.({ success: false, error: err.message });
        }
    });

    // Événement: l'utilisateur demande un nouveau partenaire
    socket.on('user:request-next', async (_, callback) => {
        try {
            console.log(`[Next] User ${socket.id} requests a new partner`);
            await cleanupAndFindNewPartner(socket);
            callback?.({ success: true });
        } catch (err) {
            callback?.({ success: false, error: err.message });
        }
    });
    
    // Événement: l'utilisateur signale son partenaire
    socket.on('user:report', async (_, callback) => {
        try {
            const partnerId = await pubClient.hGet(KEYS.USER_DATA(socket.id), 'partnerId');
            
            if (partnerId) {
                console.log(`[Report] User ${socket.id} reported partner ${partnerId}`);
                await handleReport(partnerId);
                callback?.({ success: true });
            } else {
                callback?.({ success: false, error: 'No partner to report' });
            }
        } catch (err) {
            callback?.({ success: false, error: err.message });
        }
    });

    // Événement: déconnexion
    socket.on('disconnect', async () => {
        console.log(`[Disconnection] User disconnected: ${socket.id}`);
        await handleDisconnect(socket);
    });

    // Gestion des erreurs
    socket.on('error', (err) => {
        console.error(`[Error] Socket ${socket.id}:`, err.message);
    });
}

// 3. Fonctions de Matchmaking et de Signalisation

/**
 * Tente de trouver un partenaire pour un socket donné.
 * @param {import('socket.io').Socket} socket - Le socket de l'utilisateur.
 */
async function findPartner(socket) {
    console.log(`[Matchmaking] ${socket.id} is looking for a partner`);
    
    // On essaie de trouver un partenaire en attente
    const partnerId = await pubClient.lPop(KEYS.WAITING_QUEUE);

    if (partnerId && partnerId !== socket.id) {
        // Vérifier si le partenaire existe toujours
        const partnerExists = await pubClient.exists(KEYS.USER_DATA(partnerId));
        const partnerSocket = io.sockets.sockets.get(partnerId);
        
        if (!partnerExists || !partnerSocket) {
            console.log(`[Matchmaking] Partner ${partnerId} no longer exists. Searching again`);
            return findPartner(socket); // Récursivité pour trouver un autre partenaire
        }

        console.log(`[Matchmaking] Partner found for ${socket.id}: ${partnerId}`);
        const [currentUserData, partnerData] = await Promise.all([
            pubClient.hGetAll(KEYS.USER_DATA(socket.id)),
            pubClient.hGetAll(KEYS.USER_DATA(partnerId))
        ]);

        // Transaction Redis pour assurer l'atomicité
        const transaction = pubClient.multi();
        transaction.hSet(KEYS.USER_DATA(socket.id), { 
            status: 'connected', 
            partnerId: partnerId,
            connectedAt: Date.now()
        });
        transaction.hSet(KEYS.USER_DATA(partnerId), { 
            status: 'connected', 
            partnerId: socket.id,
            connectedAt: Date.now()
        });
        await transaction.exec();

        // Préparer les données des partenaires
        const currentUserPartnerData = {
            pseudo: partnerData.pseudo,
            country: {
                code: partnerData.countryCode,
                emoji: partnerData.countryEmoji,
                name: partnerData.countryName
            },
            socketId: partnerId
        };

        const partnerUserData = {
            pseudo: currentUserData.pseudo,
            country: {
                code: currentUserData.countryCode,
                emoji: currentUserData.countryEmoji,
                name: currentUserData.countryName
            },
            socketId: socket.id
        };

        // Notifier les deux utilisateurs
        io.to(socket.id).emit('app:state-update', {
            state: 'connected',
            partner: currentUserPartnerData,
            initiator: true
        });

        io.to(partnerId).emit('app:state-update', {
            state: 'connected',
            partner: partnerUserData,
            initiator: false
        });

    } else {
        // Personne en attente, on ajoute l'utilisateur à la file
        console.log(`[Matchmaking] No partner found. Adding ${socket.id} to queue`);
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
        const partnerSocket = io.sockets.sockets.get(partnerId);
        
        if (partnerSocket) {
            data.from = socket.id;
            partnerSocket.emit(eventName, data);
        } else {
            throw new Error('Partner socket not found');
        }
    } else {
        throw new Error('No partner assigned');
    }
}

// 4. Fonctions de Nettoyage

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
        await pubClient.hSet(KEYS.USER_DATA(partnerId), { 
            status: 'searching', 
            partnerId: '' 
        });
        
        // Remettre le partenaire dans la file d'attente
        const partnerSocket = io.sockets.sockets.get(partnerId);
        if (partnerSocket) {
            await findPartner(partnerSocket);
        }
    }
    
    // Supprimer l'utilisateur de la file d'attente s'il s'y trouvait
    await pubClient.lRem(KEYS.WAITING_QUEUE, 0, socket.id);
    
    // Supprimer les données utilisateur après un délai (pour permettre la reconnexion)
    setTimeout(async () => {
        const exists = await pubClient.exists(KEYS.USER_DATA(socket.id));
        if (exists) {
            const partnerId = await pubClient.hGet(KEYS.USER_DATA(socket.id), 'partnerId');
            if (!partnerId) {
                await pubClient.del(KEYS.USER_DATA(socket.id));
                console.log(`[Cleanup] Removed data for ${socket.id}`);
            }
        }
    }, 10000); // 10 secondes de délai
}

/**
 * Gère la demande de "suivant" : nettoie l'ancienne connexion et en cherche une nouvelle.
 * @param {import('socket.io').Socket} socket
 */
async function cleanupAndFindNewPartner(socket) {
    const partnerId = await pubClient.hGet(KEYS.USER_DATA(socket.id), 'partnerId');

    if (partnerId) {
        // Notifier l'ancien partenaire
        io.to(partnerId).emit('app:partner-left');
        
        // Réinitialiser l'ancien partenaire
        await pubClient.hSet(KEYS.USER_DATA(partnerId), { 
            status: 'searching', 
            partnerId: '' 
        });
        
        // Remettre l'ancien partenaire en recherche
        const partnerSocket = io.sockets.sockets.get(partnerId);
        if (partnerSocket) {
            await findPartner(partnerSocket);
        }
    }
    
    // Réinitialiser l'utilisateur actuel et chercher un nouveau partenaire
    await pubClient.hSet(KEYS.USER_DATA(socket.id), { 
        status: 'searching', 
        partnerId: '' 
    });
    
    await findPartner(socket);
}

// Lancement du serveur
startServer();

process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});