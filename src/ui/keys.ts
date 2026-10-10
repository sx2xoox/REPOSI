// Human-readable names for input bindings (keyboard / mouse / gamepad), so
// hints and the controls reference always match the actual bindings.

import type { Action } from '../engine/input';
import { input } from '../engine/input';
import { touchUiActive } from './touch-mode';
import { save } from '../engine/save';

const KEY_NAMES: Record<string, string> = {
  Space: 'Space',
  ShiftLeft: 'Shift',
  ShiftRight: 'Shift',
  ControlLeft: 'Ctrl',
  ControlRight: 'Ctrl',
  AltLeft: 'Alt',
  Escape: 'Esc',
  Enter: 'Enter',
  NumpadEnter: 'Enter',
  Backspace: '←Back',
  Tab: 'Tab',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Mouse0: '좌클릭',
  Mouse1: '휠클릭',
  Mouse2: '우클릭',
  Wheel: '휠',
  PageUp: 'PgUp',
  PageDown: 'PgDn',
  Delete: 'Del',
};

/** Display name of a KeyboardEvent.code / "MouseN" binding. */
export function keyName(code: string): string {
  if (KEY_NAMES[code]) return KEY_NAMES[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `Num${code.slice(6)}`;
  return code;
}

/** Gamepad button names per action (standard mapping, matches engine/input PAD_BUTTONS). */
export const PAD_NAMES: Partial<Record<Action, string>> = {
  dash: 'A',
  active: 'Y',
  consumable: 'B',
  inventory: 'Back',
  map: 'LB',
  pause: 'Start',
  confirm: 'A',
  cancel: 'B',
  fire: 'RT',
  special: 'LT',
  swap: 'R3',
  interact: 'X',
  tabPrev: 'LB',
  tabNext: 'RB',
  discard: 'X',
};

/**
 * Short label for an action given its bindings. `pad` picks the gamepad name.
 * Prefers keyboard keys over mouse buttons (more readable in hints).
 */
export function actionLabel(bindings: Record<Action, string[]>, action: Action, pad = false): string {
  // touch mode: the on-screen buttons carry their own icons, so key caps are omitted ('')
  if (!pad && input.aimMode !== 'pad' && touchUiActive()) return '';
  if (pad) return PAD_NAMES[action] ?? keyName(bindings[action]?.[0] ?? '?');
  const codes = bindings[action] ?? [];
  const kb = codes.find((c) => !c.startsWith('Mouse')) ?? codes[0];
  return kb ? keyName(kb) : '?';
}

/** All display names for an action (deduplicated), e.g. ["Space", "Shift", "우클릭"]. */
export function actionLabels(bindings: Record<Action, string[]>, action: Action): string[] {
  const out: string[] = [];
  for (const c of bindings[action] ?? []) {
    const n = keyName(c);
    if (!out.includes(n)) out.push(n);
  }
  return out;
}

/** Controls reference rows: [action label (Korean), actions...]. */
export const CONTROL_ROWS: { label: string; actions: Action[]; padLabel?: string }[] = [
  { label: '이동', actions: ['up', 'left', 'down', 'right'], padLabel: 'L스틱' },
  { label: '공격 (조준)', actions: ['shootUp', 'shootLeft', 'shootDown', 'shootRight', 'fire'], padLabel: 'R스틱 / RT' },
  { label: '대시', actions: ['dash'] },
  { label: '액티브 아이템', actions: ['active'] },
  { label: '물약 마시기', actions: ['consumable'] },
  { label: '등불 해방', actions: ['special'] },
  { label: '무기 교체', actions: ['swap'] },
  { label: '줍기 · 구매 · 불 붙이기', actions: ['interact'] },
  { label: '소지품', actions: ['inventory'] },
  { label: '지도', actions: ['map'] },
  { label: '일시정지', actions: ['pause'] },
];

/** Touch controls reference ('twin' scheme): [icon sprite or '', name, description]. */
export const TOUCH_CONTROL_ROWS: [string, string, string][] = [
  ['', '왼쪽 조이스틱', '기울여 이동'],
  ['', '오른쪽 화면', '끌어서 조준 · 자동 공격'],
  ['tc_dash', '대시', '이동 방향으로 돌진'],
  ['ui_flame', '등불 해방', '게이지가 차면 사용'],
  ['ui_gem', '아이템 · 물약', '가지고 있을 때 나타남'],
  ['tc_swap', '무기 교체', '무기를 두 개 들면 나타남'],
  ['tc_pick', '줍기 · 불 붙이기', '아이템이나 불 붙일 곳 곁에 서면 나타남'],
  ['tc_pause', '일시정지', ''],
  ['tc_map', '지도', ''],
  ['tc_bag', '소지품', ''],
];

/** Touch controls reference for the current scheme (설정 > 터치 조작 방식). */
export function touchControlRows(): [string, string, string][] {
  if (save.settings.touchScheme === 'twin') return TOUCH_CONTROL_ROWS;
  return [
    ['', '왼쪽 조이스틱', '기울여 이동'],
    ['tc_attack', '공격', '누르면 자동 조준 · 끌면 직접 조준'],
    ...TOUCH_CONTROL_ROWS.slice(2),
  ];
}

/** Compact key text for a controls row (e.g. "WASD", "↑←↓→ / 좌클릭"). */
export function controlKeys(bindings: Record<Action, string[]>, actions: Action[]): string {
  if (actions.length === 4 && actions[0] === 'up') {
    return actions.map((a) => keyName(bindings[a]?.[0] ?? '?')).join('');
  }
  if (actions[0] === 'shootUp') {
    const arrows = actions.slice(0, 4).map((a) => keyName(bindings[a]?.[0] ?? '?')).join('');
    const rest = actions.slice(4).flatMap((a) => actionLabels(bindings, a));
    return [arrows, ...rest].join(' / ');
  }
  return actions.flatMap((a) => actionLabels(bindings, a)).filter((v, i, arr) => arr.indexOf(v) === i).join(' / ');
}
