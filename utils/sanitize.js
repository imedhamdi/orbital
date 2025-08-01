/**
 * utils/sanitize.js
 * Enhanced sanitization for user input
 * @param {string} input - User provided string
 * @returns {string} Sanitized string
 */
// Simplified sanitization preserving emoji order
function sanitize(input) {
    if (typeof input !== 'string') return '';

    let clean = input;

    // Échapper les balises HTML
    clean = clean.replace(/</g, '&lt;').replace(/>/g, '&gt;');

    // Supprimer les schémas JavaScript
    clean = clean.replace(/javascript:/gi, '');

    // Limiter la longueur et trim
    clean = clean.trim().substring(0, 200);

    return clean;
}

module.exports = sanitize;
