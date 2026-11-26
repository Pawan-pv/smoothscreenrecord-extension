/**
 * The user's privacy-shield choices, saved by the popup and read by the editor
 * when a recording starts. The shield is OPT-IN: with nothing saved it is OFF,
 * and no page is blurred on first use or on record start.
 *
 * Categories (only meaningful while `enabled` is true):
 *  - secrets:   passwords, API keys, JWT / Bearer tokens, one-time codes
 *  - pii:       emails, phone numbers, SSN / account IDs
 *  - financial: credit cards, IBAN, currency amounts (off by default)
 *
 * A malformed or missing value falls back to the DEFAULT, never to "all on":
 * a bad storage read must never turn on a feature the user did not opt into.
 */
export interface PrivacyPrefs {
  enabled: boolean;
  secrets: boolean;
  pii: boolean;
  financial: boolean;
}

export const PRIVACY_PREFS_KEY = 'smoothstudio_privacy_prefs';

export const DEFAULT_PRIVACY_PREFS: PrivacyPrefs = {
  enabled: false,
  secrets: true,
  pii: true,
  financial: false
};

/** Each category is kept only when it is a real boolean; anything else uses its default. */
export function normalizePrivacyPrefs(raw: unknown): PrivacyPrefs {
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const pick = (key: 'secrets' | 'pii' | 'financial'): boolean =>
    typeof source[key] === 'boolean' ? (source[key] as boolean) : DEFAULT_PRIVACY_PREFS[key];
  return {
    enabled: typeof source.enabled === 'boolean' ? source.enabled : DEFAULT_PRIVACY_PREFS.enabled,
    secrets: pick('secrets'),
    pii: pick('pii'),
    financial: pick('financial')
  };
}

export async function loadPrivacyPrefs(): Promise<PrivacyPrefs> {
  try {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return { ...DEFAULT_PRIVACY_PREFS };
    const stored = await chrome.storage.local.get([PRIVACY_PREFS_KEY]);
    return normalizePrivacyPrefs((stored as Record<string, unknown>)?.[PRIVACY_PREFS_KEY]);
  } catch {
    return { ...DEFAULT_PRIVACY_PREFS };
  }
}

export async function savePrivacyPrefs(prefs: PrivacyPrefs): Promise<void> {
  try {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
    await chrome.storage.local.set({ [PRIVACY_PREFS_KEY]: normalizePrivacyPrefs(prefs) });
  } catch {
    // Not saving a preference must never break recording.
  }
}

/** The options object the content script and the exporters understand. */
export function privacyOptionsFromPrefs(prefs: PrivacyPrefs): PrivacyPrefs {
  return {
    enabled: prefs.enabled,
    secrets: prefs.secrets,
    pii: prefs.pii,
    financial: prefs.financial
  };
}
