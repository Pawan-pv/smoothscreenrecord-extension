/**
 * Popup feedback when the shield cannot attach, saved privacy choices,
 * keyboard-shortcut focus rules, and a targeted privacy forward in the SW.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { describeShieldOutcome } from '../../src/popup/shield-feedback';
import { normalizePrivacyPrefs, loadPrivacyPrefs, savePrivacyPrefs, PRIVACY_PREFS_KEY } from '../../src/engine/privacy-prefs';
import { resolveEditorShortcut, isTypingTarget } from '../../src/editor/keyboard-shortcuts';

describe('describeShieldOutcome', () => {
  it('is silent when the shield reached the page, or there is nothing to say', () => {
    expect(describeShieldOutcome([{ tabId: 7, ok: true }], 7)).toBeNull();
    expect(describeShieldOutcome([{ tabId: 8, ok: false, reason: 'restricted_page' }], 7)).toBeNull(); // another tab
    expect(describeShieldOutcome(undefined, 7)).toBeNull();
    expect(describeShieldOutcome([{ tabId: 7, ok: false }], undefined)).toBeNull();
  });

  it('names a restricted page', () => {
    expect(describeShieldOutcome([{ tabId: 7, ok: false, reason: 'restricted_page' }], 7)).toMatch(/does not let extensions run on this page/);
  });

  it('warns that a failed injection means NOTHING is blurred', () => {
    expect(describeShieldOutcome([{ tabId: 7, ok: false, reason: 'injection_failed' }], 7)).toMatch(/NOT active/);
  });

  it('does not claim success for an unconfirmed shield', () => {
    expect(describeShieldOutcome([{ tabId: 7, ok: false, reason: 'missing_ack' }], 7)).toMatch(/did not confirm/);
  });
});

describe('privacy preferences', () => {
  it('missing or malformed storage means every category ON', () => {
    expect(normalizePrivacyPrefs(undefined)).toEqual({ blurEmails: true, blurRevenue: true, blurApiKeys: true });
    expect(normalizePrivacyPrefs({ blurEmails: 'no', blurRevenue: 0 })).toEqual({ blurEmails: true, blurRevenue: true, blurApiKeys: true });
  });

  it('keeps a category the user switched OFF', async () => {
    await savePrivacyPrefs({ blurEmails: false, blurRevenue: true, blurApiKeys: false });
    expect(await loadPrivacyPrefs()).toEqual({ blurEmails: false, blurRevenue: true, blurApiKeys: false });
    expect((await chrome.storage.local.get([PRIVACY_PREFS_KEY]))[PRIVACY_PREFS_KEY]).toBeTruthy();
  });
});

describe('Popup: shield feedback and remembered toggles', () => {
  beforeEach(() => cleanup());

  const sendWith = (results: any[]) => {
    (chrome.runtime as any).sendMessage = vi.fn((msg: any, cb?: (r: any) => void) => {
      if (msg.type === 'GET_RECORDING_STATUS') cb?.({ isRecording: false });
      else if (msg.type === 'APPLY_PRIVACY_OPTIONS') cb?.({ status: 'forwarded', results });
      else cb?.({});
    });
  };
  const openPopup = async () => {
    const { PopupApp } = await import('../../src/popup/popup');
    render(React.createElement(PopupApp));
  };

  it('toggling a category on a page the shield cannot reach shows a notice', async () => {
    sendWith([{ tabId: 101, ok: false, reason: 'injection_failed' }]);
    await openPopup();
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(screen.getByText('Auto-Blur Emails').closest('label')!.querySelector('input')!); // switch OFF (others stay ON)
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/NOT active/));
  });

  it('a successful shield shows no notice, and the notice can be dismissed', async () => {
    sendWith([{ tabId: 101, ok: true }]);
    await openPopup();
    fireEvent.click(screen.getByText('Auto-Blur Emails').closest('label')!.querySelector('input')!);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('Start on a page the shield cannot reach does NOT open the editor silently; "Record anyway" does', async () => {
    sendWith([{ tabId: 101, ok: false, reason: 'restricted_page' }]);
    await openPopup();
    fireEvent.click(screen.getByText('Start Studio Recording'));
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(chrome.tabs.create).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('Record anyway'));
    expect(chrome.tabs.create).toHaveBeenCalledTimes(1);
    expect((chrome.tabs.create as any).mock.calls[0][0].url).toContain('sourceTab=101');
  });

  it('Start with a working shield targets ONLY the recorded tab and opens the editor', async () => {
    sendWith([{ tabId: 101, ok: true }]);
    await openPopup();
    fireEvent.click(screen.getByText('Start Studio Recording'));
    await waitFor(() => expect(chrome.tabs.create).toHaveBeenCalledTimes(1));
    const applied = (chrome.runtime.sendMessage as any).mock.calls.map((c: any[]) => c[0]).find((m: any) => m.type === 'APPLY_PRIVACY_OPTIONS');
    expect(applied.tabId).toBe(101);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a category switched OFF earlier is OFF when the popup reopens', async () => {
    await savePrivacyPrefs({ blurEmails: false, blurRevenue: true, blurApiKeys: true });
    sendWith([]);
    await openPopup();
    await waitFor(() => {
      const box = screen.getByText('Auto-Blur Emails').closest('label')!.querySelector('input') as HTMLInputElement;
      expect(box.checked).toBe(false);
    });
  });
});

describe('Service worker: a privacy message that names a tab only goes to that tab', () => {
  it('forwards to the named tab and reports only its result', async () => {
    vi.resetModules();
    await import('../../src/background/service-worker');
    (chrome.tabs as any)._tabs.length = 0;
    (chrome.tabs as any)._tabs.push({ id: 1, active: true, url: 'https://a.example/' }, { id: 2, active: false, url: 'https://b.example/' });
    const listener = (chrome.runtime.onMessage as any).listeners[0];
    const res: any = await new Promise((resolve) => listener({ type: 'APPLY_PRIVACY_OPTIONS', options: { blurEmails: true }, tabId: 2 }, { id: 'popup' }, resolve));
    expect(res.results.map((r: any) => r.tabId)).toEqual([2]);
    const targets = (chrome.tabs.sendMessage as any).mock.calls.map((c: any[]) => c[0]);
    expect(targets).toEqual([2]);
  });

  it('without a tab it still forwards to every web tab (popup toggles)', async () => {
    vi.resetModules();
    await import('../../src/background/service-worker');
    (chrome.tabs as any)._tabs.length = 0;
    (chrome.tabs as any)._tabs.push({ id: 1, active: true, url: 'https://a.example/' }, { id: 2, active: false, url: 'https://b.example/' });
    const listener = (chrome.runtime.onMessage as any).listeners[0];
    const res: any = await new Promise((resolve) => listener({ type: 'APPLY_PRIVACY_OPTIONS', options: { blurEmails: true } }, { id: 'popup' }, resolve));
    expect(res.results.map((r: any) => r.tabId).sort()).toEqual([1, 2]);
  });
});

describe('editor keyboard shortcuts: focus rules', () => {
  const press = (code: string, target: Element | null, extra: Record<string, any> = {}, ctx = { hasSelectedPill: false }) =>
    resolveEditorShortcut({ code, key: extra.key ?? code, target, ...extra }, ctx);
  const el = (html: string) => {
    const host = document.createElement('div');
    host.innerHTML = html;
    document.body.appendChild(host);
    return host.firstElementChild as HTMLElement;
  };

  it('plain page focus: Space plays, arrows seek, Z adds a zoom', () => {
    expect(press('Space', document.body)).toBe('toggle-play');
    expect(press('ArrowLeft', document.body)).toBe('seek-back');
    expect(press('ArrowRight', document.body)).toBe('seek-forward');
    expect(press('KeyZ', document.body)).toBe('add-zoom');
  });

  it.each([
    ['<input type="text">'],
    ['<textarea></textarea>'],
    ['<select><option>a</option></select>'],
    ['<div contenteditable="true">x</div>'],
    ['<div contenteditable="">x</div>'],
    ['<div role="textbox"></div>']
  ])('typing surface %s owns every key', (html) => {
    const target = el(html);
    expect(isTypingTarget(target)).toBe(true);
    for (const code of ['Space', 'ArrowLeft', 'ArrowRight', 'KeyZ', 'Delete', 'Backspace']) {
      expect(press(code, target, {}, { hasSelectedPill: true })).toBeNull();
    }
  });

  it('contenteditable="false" is not a typing surface', () => {
    expect(isTypingTarget(el('<div contenteditable="false">x</div>'))).toBe(false);
  });

  it('a focused button keeps Space (it activates the button) but arrows still seek', () => {
    const button = el('<button>Export</button>');
    expect(press('Space', button)).toBeNull();
    expect(press('ArrowRight', button)).toBe('seek-forward');
    expect(press('Space', el('<a href="#x">l</a>'))).toBeNull();
    expect(press('Space', el('<div role="button"></div>'))).toBeNull();
  });

  it('Delete and Backspace delete the SELECTED zoom, and only when one is selected', () => {
    expect(press('Delete', document.body, {}, { hasSelectedPill: true })).toBe('delete-pill');
    expect(press('Backspace', document.body, {}, { hasSelectedPill: true })).toBe('delete-pill');
    expect(press('Delete', document.body, {}, { hasSelectedPill: false })).toBeNull();
    // From the timeline's own (focused) pill button too.
    expect(press('Delete', el('<button>pill</button>'), {}, { hasSelectedPill: true })).toBe('delete-pill');
  });

  it('modifier chords are left to the browser', () => {
    expect(press('KeyZ', document.body, { ctrlKey: true })).toBeNull();
    expect(press('KeyZ', document.body, { metaKey: true })).toBeNull();
    expect(press('KeyZ', document.body, { shiftKey: true })).toBeNull();
    expect(press('Delete', document.body, { ctrlKey: true }, { hasSelectedPill: true })).toBeNull();
  });
});
