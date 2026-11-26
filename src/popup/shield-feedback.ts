/**
 * What the popup tells the user when the privacy shield (or the recorder's
 * telemetry) could not be attached to the page they are about to record.
 *
 * The service worker reports a per-tab result for every forwarded message:
 *   { tabId, ok, reason? }  with reason 'restricted_page' | 'injection_failed' | <chrome error>.
 * Before this existed the popup ignored those results, so a user recording a
 * page the shield could not reach got no hint that their emails/revenue/keys
 * were NOT being blurred.
 */
export interface TabDispatchOutcome {
  tabId: number;
  ok: boolean;
  reason?: string;
}

/** A user-facing sentence for a tab the shield did not reach, or null when it did (or there is no result). */
export function describeShieldOutcome(results: TabDispatchOutcome[] | undefined | null, tabId: number | undefined): string | null {
  if (!Array.isArray(results) || typeof tabId !== 'number') return null;
  const outcome = results.find((r) => r && r.tabId === tabId);
  if (!outcome || outcome.ok) return null;
  switch (outcome.reason) {
    case 'restricted_page':
      return 'Chrome does not let extensions run on this page (browser pages, the Web Store, new-tab pages), so the privacy shield cannot protect it. Record a normal web page instead.';
    case 'injection_failed':
      return 'SmoothStudio could not attach to this page (a PDF viewer, a Web Store page, or a site that blocks extensions). The privacy shield is NOT active on it: emails, credentials and financial figures would be recorded unblurred.';
    default:
      return 'The privacy shield did not confirm it is active on this page, so sensitive text on it may be recorded unblurred. Reload the page and try again.';
  }
}
