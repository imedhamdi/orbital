/**
 * utils/sanitize.js
 * Sanitize a string by removing basic XSS patterns and trimming length.
 * @param {string} input - User provided string
 * @returns {string} Sanitized string (max 20 chars)
 */
const xssPatterns = /<script.*?>.*?<\/script>|on\w+="[^"]*"/gi;

function sanitize(input) {
    if (typeof input !== 'string') return '';
    return input.replace(xssPatterns, '').trim().substring(0, 20);
}

module.exports = sanitize;
