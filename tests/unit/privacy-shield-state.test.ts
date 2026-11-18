/**
 * Privacy shield: picker-blur vs. category state.
 *
 * A manual picker blur is the user's explicit choice. Re-applying the
 * automatic categories (the popup sends the whole option set on every toggle)
 * must not silently un-blur what the user chose by hand, and a full reset must
 * still restore the page exactly.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  applyAutoRedaction,
  resetRedactions,
  startElementPicker,
  stopElementPicker
} from '../../src/content/privacy-redactor';

const ALL_ON = { blurEmails: true, blurRevenue: true, blurApiKeys: true };

/** Drives the real picker handlers: hover + click on the given element. */
function pickerClick(el: HTMLElement) {
  const original = document.elementFromPoint;
  (document as any).elementFromPoint = () => el;
  try {
    document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 10, clientY: 10 }));
    document.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 })
    );
  } finally {
    (document as any).elementFromPoint = original;
  }
}

const isBlurred = (el: HTMLElement) =>
  el.style.filter.includes('blur(8px)') && el.classList.contains('smoothstudio-blur-redacted');

describe('Privacy shield: manual picker blurs survive automatic re-application', () => {
  beforeEach(() => {
    resetRedactions();
    document.body.innerHTML = `
      <div id="manual">Internal note that is not an email</div>
      <p id="mail">Write to ops.lead@acme-labs.io</p>
    `;
  });

  it('keeps a picker-blurred element blurred when the categories are re-applied', async () => {
    const manual = document.getElementById('manual') as HTMLElement;
    startElementPicker();
    pickerClick(manual);
    stopElementPicker();
    expect(isBlurred(manual)).toBe(true);

    applyAutoRedaction(ALL_ON);
    expect(isBlurred(manual), 'the manual blur must survive the auto scan').toBe(true);
    expect((document.getElementById('mail') as HTMLElement).style.filter).toContain('blur(8px)');

    // Toggling a category off re-applies the whole option set again.
    applyAutoRedaction({ ...ALL_ON, blurEmails: false });
    expect(isBlurred(manual), 'a category toggle must not discard the picker choice').toBe(true);
    expect((document.getElementById('mail') as HTMLElement).style.filter).toBe('');
    expect((document.getElementById('mail') as HTMLElement).textContent).toBe(
      'Write to ops.lead@acme-labs.io'
    );
  });

  it('honours the picker un-blur: a second picker click wins over later auto scans', async () => {
    const manual = document.getElementById('manual') as HTMLElement;
    startElementPicker();
    pickerClick(manual);
    expect(isBlurred(manual)).toBe(true);
    pickerClick(manual); // toggles it back off
    stopElementPicker();
    expect(isBlurred(manual)).toBe(false);

    applyAutoRedaction(ALL_ON);
    expect(isBlurred(manual), 'an element the user un-blurred must stay un-blurred').toBe(false);
  });

  it("restores the page's own inline filter after a manual blur and a full reset", () => {
    const manual = document.getElementById('manual') as HTMLElement;
    manual.style.filter = 'saturate(0.4)';

    startElementPicker();
    pickerClick(manual);
    stopElementPicker();
    expect(manual.style.filter).toBe('blur(8px)');

    applyAutoRedaction(ALL_ON);
    expect(isBlurred(manual)).toBe(true);

    resetRedactions();
    expect(manual.style.filter).toBe('saturate(0.4)');
    expect(manual.classList.contains('smoothstudio-blur-redacted')).toBe(false);
    expect(manual.getAttribute('data-smoothstudio-redacted')).toBeNull();
  });

  it('a full reset clears manual blurs completely', () => {
    const manual = document.getElementById('manual') as HTMLElement;
    startElementPicker();
    pickerClick(manual);
    stopElementPicker();
    expect(isBlurred(manual)).toBe(true);

    resetRedactions();
    expect(isBlurred(manual)).toBe(false);
    expect(manual.getAttribute('data-smoothstudio-redacted')).toBeNull();
  });

  it('leaves no picker listener behind that could blur a page later', () => {
    const manual = document.getElementById('manual') as HTMLElement;
    startElementPicker();
    pickerClick(manual);
    stopElementPicker();
    applyAutoRedaction(ALL_ON);
    resetRedactions();

    // After the picker is gone, a click on any element must not blur it.
    pickerClick(manual);
    expect(isBlurred(manual)).toBe(false);
  });
});
