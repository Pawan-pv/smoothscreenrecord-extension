/**
 * Which editor shortcut (if any) a key press means, given where the focus is.
 * Pure so the rules can be unit-tested without mounting the editor.
 *
 * Two rules keep shortcuts from fighting the page:
 * - typing surfaces (input, textarea, select, contenteditable) own EVERY key;
 * - a focused button/link owns Space (it activates the control), so Space must
 *   not also toggle playback.
 */
export type EditorShortcut = 'toggle-play' | 'seek-back' | 'seek-forward' | 'add-zoom' | 'delete-pill';

export interface ShortcutKeyEvent {
  code: string;
  key?: string;
  target: EventTarget | null;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}

function asElement(target: EventTarget | null): HTMLElement | null {
  return target && typeof (target as HTMLElement).tagName === 'string' ? (target as HTMLElement) : null;
}

/** A surface the user types into (or picks a value in): it keeps every key. */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = asElement(target);
  if (!el) return false;
  const tag = el.tagName.toUpperCase();
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (el.isContentEditable) return true;
  const editable = el.getAttribute?.('contenteditable');
  if (editable !== null && editable !== undefined && editable.toLowerCase() !== 'false') return true;
  const role = el.getAttribute?.('role');
  return role === 'textbox' || role === 'combobox' || role === 'listbox' || role === 'searchbox';
}

/** A focused control that Space/Enter activate natively. */
export function isActivatableControl(target: EventTarget | null): boolean {
  const el = asElement(target);
  if (!el) return false;
  const tag = el.tagName.toUpperCase();
  if (tag === 'BUTTON' || tag === 'SUMMARY') return true;
  if (tag === 'A' && el.hasAttribute?.('href')) return true;
  const role = el.getAttribute?.('role');
  return role === 'button' || role === 'link' || role === 'switch' || role === 'checkbox' || role === 'menuitem' || role === 'tab';
}

export function resolveEditorShortcut(e: ShortcutKeyEvent, ctx: { hasSelectedPill: boolean }): EditorShortcut | null {
  if (isTypingTarget(e.target)) return null;

  if (e.code === 'Space') {
    if (isActivatableControl(e.target)) return null;
    return 'toggle-play';
  }
  if (e.code === 'ArrowLeft') return 'seek-back';
  if (e.code === 'ArrowRight') return 'seek-forward';
  if (e.code === 'KeyZ') {
    return e.metaKey || e.ctrlKey || e.shiftKey ? null : 'add-zoom';
  }
  if ((e.code === 'Delete' || e.code === 'Backspace' || e.key === 'Delete' || e.key === 'Backspace') && ctx.hasSelectedPill) {
    return e.metaKey || e.ctrlKey || e.altKey ? null : 'delete-pill';
  }
  return null;
}
