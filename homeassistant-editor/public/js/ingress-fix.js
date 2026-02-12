/**
 * Ingress URL Fix
 * Ensures all fetch requests use absolute paths to prevent Safari from
 * making unauthenticated requests to Home Assistant when running through ingress.
 */

// Detect if running through Home Assistant ingress
const isIngress = window.location.pathname.includes('/api/hassio_ingress/');

// Get the base path for API requests
function getAPIBasePath() {
    if (isIngress) {
        // Running through ingress - use the full ingress path
        const pathMatch = window.location.pathname.match(/^(\/api\/hassio_ingress\/[^\/]+)/);
        return pathMatch ? pathMatch[1] : '';
    }
    // Direct access - use empty base path (relative URLs work fine)
    return '';
}

// Store the base path globally
window.EDITOR_API_BASE = getAPIBasePath();

// Override fetch to automatically prepend the base path
const originalFetch = window.fetch;
window.fetch = function (url, options) {
    // Only modify relative URLs starting with /api/
    if (typeof url === 'string' && url.startsWith('/api/') && window.EDITOR_API_BASE) {
        url = window.EDITOR_API_BASE + url;
        console.log('[Ingress Fix] Rewriting URL to:', url);
    }
    return originalFetch.call(this, url, options);
};

console.log('[Ingress] Running through ingress:', isIngress);
console.log('[Ingress] API base path:', window.EDITOR_API_BASE || '(none - direct access)');
