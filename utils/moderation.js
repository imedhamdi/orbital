/**
 * utils/moderation.js
 * Enhanced moderation system with temporary bans and admin notifications
 * @param {object} deps - Dependencies
 * @param {import('redis').RedisClientType} deps.pubClient - Redis client
 * @param {import('socket.io').Server} deps.io - Socket.IO server
 * @returns {function(string):Promise<void>}
 */
function createHandleReport({ pubClient, io }) {
    const BAN_DURATION = 3600; // 1 hour in seconds
    const MAX_REPORTS = 3;
    const COOLDOWN_PERIOD = 86400; // 24 hours in seconds

    return async function handleReport(reportedUserId) {
        const reportKey = `orbital:reports:${reportedUserId}`;
        const userKey = `orbital:user:${reportedUserId}`;
        
        try {
            // Ajouter le report avec un timestamp
            const now = Date.now();
            await pubClient.zAdd(reportKey, {
                score: now,
                value: now.toString()
            });
            
            // Définir l'expiration pour le cooldown
            await pubClient.expire(reportKey, COOLDOWN_PERIOD);
            
            // Compter les reports récents
            const recentReports = await pubClient.zCount(
                reportKey,
                now - (COOLDOWN_PERIOD * 1000),
                now
            );
            
            // Si seuil atteint, bannir l'utilisateur
            if (recentReports >= MAX_REPORTS) {
                await pubClient.hSet(userKey, 'banned', 'true');
                await pubClient.expire(userKey, BAN_DURATION);
                
                // Notifier l'utilisateur banni
                io.to(reportedUserId).emit('app:banned', { 
                    duration: BAN_DURATION,
                    reason: 'Trop de signalements'
                });
                
                // Log pour l'administration (dans un vrai système, envoyer une notification)
                console.log(`[Moderation] User ${reportedUserId} banned for ${BAN_DURATION} seconds`);
                
                // Envoyer une notification aux modérateurs
                io.emit('admin:user-banned', {
                    userId: reportedUserId,
                    reason: 'Automatic ban: too many reports',
                    duration: BAN_DURATION
                });
            }
        } catch (err) {
            console.error('Error handling report:', err);
            throw err;
        }
    };
}

module.exports = createHandleReport;