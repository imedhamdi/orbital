/**
 * utils/moderation.js
 * Basic report handling with automatic temporary ban after three reports.
 * @param {object} deps - Dependencies
 * @param {import('redis').RedisClientType} deps.pubClient - Redis client
 * @param {import('socket.io').Server} deps.io - Socket.IO server
 * @returns {function(string):Promise<void>}
 */
function createHandleReport({ pubClient, io }) {
    const BAN_DURATION = 3600; // seconds
    return async function handleReport(reportedUserId) {
        const baseKey = `orbital:user:${reportedUserId}`;
        await pubClient.sAdd(`${baseKey}:reports`, Date.now());
        const count = await pubClient.sCard(`${baseKey}:reports`);
        if (count >= 3) {
            await pubClient.expire(baseKey, BAN_DURATION);
            io.to(reportedUserId).emit('app:banned');
        }
    };
}

module.exports = createHandleReport;
