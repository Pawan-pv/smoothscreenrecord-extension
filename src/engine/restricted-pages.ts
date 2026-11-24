/**
 * Pages where Chrome does not let any extension run a content script. Recording
 * them works, but no click, mouse or keystroke can be tracked there, so there is
 * no auto-zoom and no styled cursor.
 *
 * Returns a short description of the page ("the Chrome Web Store", ...), or null
 * when the page can be tracked.
 */
export function untrackablePage(url: string | null | undefined): string | null {
  if (!url) return null;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  if (host === 'chromewebstore.google.com' || (host === 'chrome.google.com' && u.pathname.startsWith('/webstore'))) {
    return 'the Chrome Web Store';
  }
  if (host === 'microsoftedge.microsoft.com' && u.pathname.startsWith('/addons')) return 'the Edge Add-ons store';
  if ((host === 'www.google.com' && u.pathname.startsWith('/_/chrome/newtab')) || url.startsWith('chrome://newtab') || url.startsWith('chrome-search://')) {
    return 'the New Tab page';
  }
  const scheme = u.protocol;
  if (['chrome:', 'edge:', 'brave:', 'about:', 'devtools:', 'view-source:', 'chrome-extension:', 'chrome-untrusted:'].includes(scheme)) {
    return 'a browser page';
  }
  return null;
}
