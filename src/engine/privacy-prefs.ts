/**
 * The user's privacy-shield choices (which categories to blur), saved by the
 * popup and read by the editor when it starts a recording, so a category the
 * user switched OFF in the popup is not silently switched back ON.
 *
 * Absent or malformed storage means "everything ON": a recording must never
 * leave sensitive data unblurred because a preference could not be read.
 */
export interface PrivacyPrefs {
  blurEmails: boolean;
  blurRevenue: boolean;
  blurApiKeys: boolean;
}

export const PRIVACY_PREFS_KEY = 'smoothstudio_privacy_prefs';

export const DEFAULT_PRIVACY_PREFS: PrivacyPrefs = {
  blurEmails: true,
  blurRevenue: true,
  blurApiKeys: true
};

/** Each category is kept only when it is a real boolean; anything else falls back to ON. */
export function normalizePrivacyPrefs(raw: unknown): PrivacyPrefs {
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const pick = (key: keyof PrivacyPrefs) => (typeof source[key] === 'boolean' ? (source[key] as boolean) : true);
  return {
    blurEmails: pick('blurEmails'),
    blurRevenue: pick('blurRevenue'),
    blurApiKeys: pick('blurApiKeys')
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
