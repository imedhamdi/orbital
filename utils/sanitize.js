/**
 * utils/sanitize.js
 * Enhanced sanitization for user input
 * @param {string} input - User provided string
 * @returns {string} Sanitized string
 */
const xssPatterns = [
    /<script.*?>.*?<\/script>/gi, // Script tags
    /on\w+="[^"]*"/gi, // Event handlers
    /javascript:[^"']*/gi, // JavaScript URLs
    /eval\(.*?\)/gi, // eval()
    /expression\(.*?\)/gi // CSS expressions
];

const emojiRegex = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{2B50}\u{1F004}\u{1F0CF}\u{1F18E}\u{1F191}-\u{1F19A}\u{1F1E6}-\u{1F1FF}]/gu;

function sanitize(input) {
    if (typeof input !== 'string') return '';
    
    // Conserver les emojis
    const emojis = input.match(emojiRegex) || [];
    
    // Nettoyer le texte
    let clean = input;
    xssPatterns.forEach(pattern => {
        clean = clean.replace(pattern, '');
    });
    
    // Échapper les balises HTML
    clean = clean.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    
    // Limiter la longueur et trim
    clean = clean.trim().substring(0, 200);
    
    // Réinsérer les emojis (simplifié)
    if (emojis.length > 0) {
        clean += ' ' + emojis.join(' ');
    }
    
    return clean;
}

module.exports = sanitize;