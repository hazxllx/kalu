/**
 * Turns a human page name into a URL path, e.g. "Health Records" -> "/Health-Records".
 */
export function createPageUrl(pageName) {
    return '/' + pageName.replace(/ /g, '-');
}