// Shared touch-mode state used by screens: whether the touch UI is active,
// and a hidden <input> that brings up the phone's keyboard for seed entry.
// (The on-screen controls themselves live in ui/touch.ts.)

import { input } from '../engine/input';
import { save } from '../engine/save';
import { touchVisible, type TouchMode } from './touch-logic';
import { sanitizeSeed } from './logic';

/** Are the on-screen touch controls / touch chrome currently shown? */
export function touchUiActive(): boolean {
  return touchVisible((save.settings.touchControls ?? 'auto') as TouchMode, input.lastDevice);
}

// ---------------------------------------------------------------- soft keyboard (seed entry)
let el: HTMLInputElement | null = null;
let onChange: ((v: string) => void) | null = null;
let pendingFocus = false;

function ensureEl(): HTMLInputElement | null {
  if (typeof document === 'undefined') return null;
  if (el) return el;
  el = document.createElement('input');
  el.id = 'lk-text';
  el.type = 'text';
  el.autocomplete = 'off';
  el.spellcheck = false;
  el.setAttribute('autocapitalize', 'characters');
  el.setAttribute('autocorrect', 'off');
  el.setAttribute('enterkeyhint', 'go');
  el.setAttribute('aria-label', '시드 입력');
  el.maxLength = 32;
  el.addEventListener('input', () => {
    if (!el) return;
    const v = sanitizeSeed(el.value);
    if (el.value !== v) el.value = v;
    onChange?.(v);
  });
  document.body.appendChild(el);
  return el;
}

export const softKeyboard = {
  /** Start editing: the keyboard opens now if allowed, else on the next touch release. */
  open(initial: string, cb: (v: string) => void): void {
    const e = ensureEl();
    if (!e) return;
    e.value = initial;
    onChange = cb;
    pendingFocus = true;
    try {
      e.focus({ preventScroll: true });
    } catch {
      // focus outside a user gesture can fail (iOS) — retried in flush()
    }
  },
  close(): void {
    onChange = null;
    pendingFocus = false;
    if (el && typeof document !== 'undefined' && document.activeElement === el) el.blur();
  },
  get active(): boolean {
    return !!onChange;
  },
  /** Ask for focus again (e.g. the text box was tapped). */
  request(): void {
    if (onChange) pendingFocus = true;
  },
  /** Called from touchend / pointerup handlers (a user gesture) to show the keyboard. */
  flush(): void {
    if (!pendingFocus || !el || !onChange) return;
    pendingFocus = false;
    try {
      el.focus({ preventScroll: true });
    } catch {
      // ignore
    }
  },
};
