// "함께하기" — online co-op lobby. Main screen (nickname, 방 만들기, 코드로 참가),
// a 4-character code box, connecting / error panels, and the room: the code
// shown large with copy / share, four roster cards (name, animated keeper,
// ping, ready), character pick (←→ / tap / pad), ready toggle, host-only 시작,
// leave. Networking lives in src/net; when the host starts, every peer calls
// `startNetRun(session, start)` (src/net/session.ts).
// Keyboard, gamepad, mouse and touch; phone sizes via the centered 768 layout.

import type { Scene, TouchButtonSpec } from './scene';
import type { Renderer } from '../engine/renderer';
import { UI_H, UI_W, UI_W_BASE, uiCenterX } from '../engine/renderer';
import { app } from '../game/app';
import { input } from '../engine/input';
import { audio, sfx } from '../audio/audio';
import { save } from '../engine/save';
import { randomSeedString } from '../engine/rng';
import { animFrame, definePixelSprite, hasAnim } from '../engine/sprites';
import { clamp, ease } from '../engine/math';
import { Characters, type CharacterDef } from '../game/defs';
import { backdrop } from './backdrop';
import { Menu } from './widgets';
import { Repeater, appear } from './anim';
import { C } from './theme';
import { divider, frame, glow, keyHintRow } from './frame';
import { characterOrder, isUnlocked } from './logic';
import { softKeyboard, touchUiActive } from './touch-mode';
import { currentNetConfig, type NetConfig } from '../net/config';
import {
  applyTypedCode, defaultNickname, finalNickname, isValidRoomCode, normalizeRoomCode, roomFromSearch, sanitizeNickname,
  searchWithoutRoom, shareLink, ROOM_CODE_LENGTH,
} from '../net/code';
import { NetError, hostRoom, netErrorText, transportFactory, type NetErrorCode } from '../net/transport';
import { Lobby, MAX_PLAYERS, type LobbyPlayer, type StartInfo } from '../net/lobby';
import { BUILD_ID, checkForUpdate } from '../net/build';
import { activeSession, createNetSession, probeLockstep, startNetRun, type NetSession, type ProbeResult } from '../net/session';

// ---------------------------------------------------------------- icons
const O = '#0c0810';
definePixelSprite('net_copy', { w: '#f4ead8', d: '#b4a8c0', s: '#5a4e6c' }, [
  '..wwwww',
  '..wdddw',
  'wwwwd.w',
  'wdddwdw',
  'wd.dwww',
  'wd..d..',
  'wddddw.',
  'wwwwww.',
], { outline: O });
definePixelSprite('net_share', { w: '#f4ead8', g: '#ffe09a', d: '#b4a8c0' }, [
  '...g...',
  '..ggg..',
  '.g.g.g.',
  '...g...',
  'w..g..w',
  'w..d..w',
  'w.....w',
  'wwwwwww',
], { outline: O });
definePixelSprite('net_pen', { w: '#f4ead8', y: '#e0a848', d: '#7a4e1c', p: '#ff9a9a' }, [
  '.....pp',
  '....yyp',
  '...yyd.',
  '..yyd..',
  '.yyd...',
  'wyd....',
  'ww.....',
], { outline: O });

// ---------------------------------------------------------------- helpers
type Screen = 'main' | 'connecting' | 'room' | 'error' | 'starting';
type Modal = null | 'code' | 'name' | 'leave';

interface Btn {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  icon?: string;
  primary?: boolean;
  disabled?: boolean;
  /** handled by a DOM pointerup (needs a user gesture: clipboard / share) */
  gesture?: boolean;
}

/** Characters this player may pick (unlocked, select order). */
function unlockedCharacters(): CharacterDef[] {
  return characterOrder(save.progress.flags).filter((c) => isUnlocked(c, save.progress.flags));
}

function errorCode(e: unknown): NetErrorCode {
  return e instanceof NetError ? e.code : 'error';
}

/** Copy text to the clipboard (async API, falling back to execCommand on http / old browsers). */
async function copyText(s: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(s);
      return true;
    }
  } catch {
    // fall through
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = s;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

/** Room code from a share link (`?room=`), consumed once (removed from the address bar). */
export function consumeRoomLink(): string {
  if (typeof location === 'undefined') return '';
  const code = roomFromSearch(location.search);
  if (!code) return '';
  try {
    history.replaceState(history.state, '', `${location.pathname}${searchWithoutRoom(location.search)}${location.hash}`);
  } catch {
    // ignore
  }
  return code;
}

const NAME_PLATE = { x: UI_W_BASE / 2 - 150, y: 100, w: 300, h: 64 };
const CONNECT_W = 320;
const CONNECT_H = 140;
const ERROR_W = 460;
const ERROR_H = 164;

/** Icon next to an error title. */
const ERROR_ICON: Partial<Record<NetErrorCode, string>> = {
  'not-found': 'ui_question',
  full: 'ui_lock',
  started: 'ui_door',
  version: 'ui_gem',
  stale: 'ui_gem',
  timeout: 'ui_hourglass',
  network: 'ui_hourglass',
  closed: 'ui_door',
  'host-lost': 'ui_skull',
  kicked: 'ui_skull',
};

/** A centered panel rect in layout space (before its entrance offset). */
function panelRect(w: number, h: number): { x: number; y: number; w: number; h: number } {
  return { x: UI_W_BASE / 2 - w / 2, y: Math.round(UI_H / 2 - h / 2 - 10), w, h };
}

/** Fill the whole screen (the layout is translated by uiCenterX). */
function dimAll(r: Renderer, color: string, alpha: number): void {
  const cx = uiCenterX();
  r.uiRect(-cx, 0, UI_W + cx * 2, UI_H, color, alpha);
}

function pingColor(ms: number): string {
  if (ms < 0) return C.bad;
  if (ms === 0) return C.textFaint;
  if (ms < 90) return C.good;
  if (ms < 180) return '#ffd060';
  return C.bad;
}

// ---------------------------------------------------------------- scene
export interface LobbySceneOptions {
  /** open the join box with this code (share link) */
  join?: string;
}

export class LobbyScene implements Scene {
  private t = 0;
  private screenT = 0;
  private screen: Screen = 'main';
  private modal: Modal = null;
  private modalT = 0;
  private menu: Menu;
  private cfg: NetConfig = currentNetConfig();
  private name: string;
  private nameEdit = '';
  private codeEdit = '';
  private lobby: Lobby | null = null;
  private op = 0;
  private connectMsg = '';
  private connectCode = '';
  private error: { code: NetErrorCode; title: string; hint: string } | null = null;
  private toast = '';
  private toastT = 0;
  private chars: CharacterDef[] = unlockedCharacters();
  private pickT = new Map<number, number>();
  private lastChars = new Map<number, string>();
  private rl = new Repeater(0.35, 0.16);
  private rr = new Repeater(0.35, 0.16);
  private hover = '';
  private startInfo: StartInfo | null = null;
  private session: NetSession | null = null;
  private handedOff = false;
  private shake = 0;
  private onKey = (e: KeyboardEvent) => this.keydown(e);
  private onPaste = (e: ClipboardEvent) => this.paste(e);
  private onPointerUp = (e: PointerEvent) => this.pointerUp(e);

  constructor(o: LobbySceneOptions = {}) {
    let nick = save.settings.nickname ? finalNickname(save.settings.nickname, '') : '';
    if (!nick) {
      nick = defaultNickname();
      save.settings.nickname = nick;
      save.saveSettings();
    }
    this.name = nick;
    // a finished co-op run left its session open (the default startNetRun keeps it for debugging)
    activeSession()?.close();
    this.menu = new Menu([
      { label: '방 만들기', action: () => void this.createRoom(), hint: '새 방을 열고 코드를 친구에게 알려 주세요.' },
      { label: '코드로 참가', action: () => this.openCode(''), hint: '친구에게 받은 4자리 방 코드를 입력합니다.' },
      { label: '이름 바꾸기', action: () => this.openName(), hint: '함께하는 친구들에게 보이는 이름입니다.' },
      { label: '돌아가기', action: () => this.back(), hint: '타이틀 화면으로 돌아갑니다.' },
    ], UI_W_BASE / 2, 214, { width: 220, size: 14, lineH: 30, hintY: 344 });
    if (o.join) this.openCode(o.join);
    activeLobbyScene = this;
  }

  // ------------------------------------------------------------ lifecycle
  enter(): void {
    audio.playMusic('title');
    backdrop().setDim(0.6);
    backdrop().showKeeper = false;
    checkForUpdate();
    if (this.cfg.kind === 'peerjs') void import('../net/transport-peerjs').then((m) => m.preloadPeerJs()).catch(() => undefined);
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', this.onKey);
      window.addEventListener('paste', this.onPaste);
      window.addEventListener('pointerup', this.onPointerUp);
    }
  }

  exit(): void {
    backdrop().showKeeper = true;
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', this.onKey);
      window.removeEventListener('paste', this.onPaste);
      window.removeEventListener('pointerup', this.onPointerUp);
    }
    this.closeText();
    if (!this.handedOff) this.lobby?.leave();
    if (activeLobbyScene === this) activeLobbyScene = null;
  }

  private setScreen(s: Screen): void {
    this.screen = s;
    this.screenT = 0;
  }

  private back(): void {
    sfx('ui_back');
    app.goTitle();
  }

  private say(msg: string): void {
    this.toast = msg;
    this.toastT = 2.2;
  }

  // ------------------------------------------------------------ text entry
  private openCode(initial: string): void {
    this.modal = 'code';
    this.modalT = 0;
    this.codeEdit = normalizeRoomCode(initial);
    input.textCapture = true;
    input.releaseAll();
    sfx('ui_open');
    if (touchUiActive()) {
      softKeyboard.open(this.codeEdit, (v) => { this.codeEdit = v; }, {
        sanitize: normalizeRoomCode, maxLength: 64, label: '방 코드', capitalize: 'characters',
      });
    }
  }

  private openName(): void {
    this.modal = 'name';
    this.modalT = 0;
    this.nameEdit = this.name;
    input.textCapture = true;
    input.releaseAll();
    sfx('ui_open');
    this.focusName();
  }

  /** The DOM text field takes the name (IME / Hangul composition works there, also on desktop). */
  private focusName(): void {
    softKeyboard.open(this.nameEdit, (v) => { this.nameEdit = v; }, {
      sanitize: sanitizeNickname, maxLength: 24, label: '이름', capitalize: 'off',
    });
  }

  private closeText(): void {
    if (this.modal === 'code' || this.modal === 'name') {
      softKeyboard.close();
      input.textCapture = false;
      input.releaseAll();
    }
    this.modal = null;
  }

  private confirmCode(): void {
    const code = normalizeRoomCode(this.codeEdit);
    if (!isValidRoomCode(code)) {
      sfx('ui_error');
      this.shake = 0.35;
      return;
    }
    sfx('ui_select');
    this.closeText();
    void this.joinRoom(code);
  }

  private confirmName(): void {
    this.name = finalNickname(this.nameEdit, this.name);
    save.settings.nickname = this.name;
    save.saveSettings();
    sfx('ui_select');
    this.closeText();
  }

  private paste(e: ClipboardEvent): void {
    if (this.modal !== 'code') return;
    const text = e.clipboardData?.getData('text') ?? '';
    const code = normalizeRoomCode(text);
    if (code) {
      this.codeEdit = code;
      e.preventDefault();
      sfx('ui_move');
    }
  }

  // ------------------------------------------------------------ networking
  private lobbyOpts() {
    const chars = this.chars.length ? this.chars : Characters.all().slice(0, 1);
    const last = save.history[0]?.character;
    const pick = chars.find((c) => c.id === last) ?? chars[0];
    return { name: this.name, buildId: BUILD_ID, unlocked: chars.map((c) => c.id), characterId: pick?.id ?? '' };
  }

  async createRoom(): Promise<string> {
    const token = ++this.op;
    this.connectMsg = '방을 만드는 중…';
    this.connectCode = '';
    this.setScreen('connecting');
    try {
      const factory = await transportFactory(this.cfg);
      const t = await hostRoom(factory);
      if (token !== this.op) {
        t.close();
        return '';
      }
      this.attach(Lobby.host(t, this.lobbyOpts()));
      this.setScreen('room');
      sfx('door_open', { vol: 0.6 });
      return t.code;
    } catch (e) {
      if (token === this.op) this.fail(errorCode(e));
      return '';
    }
  }

  async joinRoom(code: string): Promise<void> {
    const token = ++this.op;
    this.connectMsg = '연결 중…';
    this.connectCode = code;
    this.setScreen('connecting');
    try {
      const factory = await transportFactory(this.cfg);
      const t = await factory.join(code);
      if (token !== this.op) {
        t.close();
        return;
      }
      this.connectMsg = '방에 들어가는 중…';
      this.attach(Lobby.join(t, this.lobbyOpts()));
    } catch (e) {
      if (token === this.op) this.fail(errorCode(e));
    }
  }

  private attach(l: Lobby): void {
    this.lobby = l;
    l.onChange = () => {
      if (this.lobby !== l) return;
      if (l.role === 'client' && l.state === 'open' && this.screen === 'connecting') {
        this.setScreen('room');
        sfx('door_open', { vol: 0.6 });
      }
    };
    l.onClosed = (reason) => {
      if (this.lobby !== l) return;
      this.lobby = null;
      this.fail(reason);
    };
    l.onStart = (info) => this.begin(l, info);
  }

  private cancelConnect(): void {
    this.op++;
    this.lobby?.leave();
    this.lobby = null;
    sfx('ui_back');
    this.setScreen('main');
  }

  private fail(code: NetErrorCode): void {
    this.op++;
    this.modal = null;
    const txt = netErrorText(code);
    this.error = { code, ...txt };
    sfx('ui_error');
    this.setScreen('error');
  }

  private leaveRoom(): void {
    this.lobby?.leave();
    this.lobby = null;
    this.modal = null;
    sfx('ui_back');
    this.setScreen('main');
  }

  private begin(l: Lobby, info: StartInfo): void {
    this.startInfo = info;
    lastStart = info;
    this.session = createNetSession(l, info);
    this.setScreen('starting');
    this.modal = null;
    softKeyboard.close();
    input.textCapture = false;
    sfx('floor_start', { vol: 0.6 });
  }

  /** Host: start when everyone is ready. */
  startRun(): boolean {
    const l = this.lobby;
    if (!l || l.role !== 'host') return false;
    if (!l.canStart()) {
      sfx('ui_error');
      this.say('모두 준비해야 시작할 수 있어요');
      return false;
    }
    sfx('ui_select');
    l.start(randomSeedString());
    return true;
  }

  pickCharacter(dir: number): void {
    const l = this.lobby;
    const me = l?.me;
    if (!l || !me || !this.chars.length) return;
    const i = this.chars.findIndex((c) => c.id === me.characterId);
    const n = this.chars.length;
    const next = this.chars[(((i < 0 ? 0 : i) + dir) % n + n) % n];
    if (next && next.id !== me.characterId) {
      l.pick(next.id);
      sfx('ui_move');
    }
  }

  toggleReady(): void {
    const l = this.lobby;
    const me = l?.me;
    if (!l || !me || l.role === 'host') return;
    l.setReady(!me.ready);
    sfx(me.ready ? 'ui_select' : 'ui_back', { vol: 0.8 });
  }

  private link(): string {
    const code = this.lobby?.code ?? '';
    return shareLink(code, typeof location !== 'undefined' ? location.href : '');
  }

  private copyCode(): void {
    const code = this.lobby?.code;
    if (!code) return;
    void copyText(code).then((ok) => {
      this.say(ok ? `코드 ${code}를 복사했어요` : '복사하지 못했어요 — 코드를 직접 알려 주세요');
      sfx(ok ? 'coin' : 'ui_error', { vol: 0.5 });
    });
  }

  private shareRoom(): void {
    const code = this.lobby?.code;
    if (!code) return;
    const url = this.link();
    const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
    if (typeof nav.share === 'function') {
      nav.share({ title: '등불지기 — 함께 하강해요', text: `등불지기 방 코드: ${code}`, url }).catch((e: unknown) => {
        if ((e as { name?: string })?.name === 'AbortError') return;
        void copyText(url).then((ok) => this.say(ok ? '초대 링크를 복사했어요' : '공유하지 못했어요'));
      });
      return;
    }
    void copyText(url).then((ok) => {
      this.say(ok ? '초대 링크를 복사했어요' : '복사하지 못했어요 — 코드를 직접 알려 주세요');
      sfx(ok ? 'coin' : 'ui_error', { vol: 0.5 });
    });
  }

  // ------------------------------------------------------------ DOM events (user gestures)
  private keydown(e: KeyboardEvent): void {
    if (e.repeat || this.screen !== 'room' || this.modal || app.scenes.top !== this) return;
    if (e.code === 'KeyC' && !e.ctrlKey && !e.metaKey) this.copyCode();
  }

  private pointerUp(e: PointerEvent): void {
    if (app.scenes.top !== this || this.screen !== 'room' || this.modal) return;
    const canvas = app.renderer?.display;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const cx = ((e.clientX - rect.left) / rect.width) * canvas.width;
    const cy = ((e.clientY - rect.top) / rect.height) * canvas.height;
    const m = app.renderer.displayToUI(cx, cy);
    const x = m.x - uiCenterX();
    for (const b of this.roomButtons()) {
      if (!b.gesture || b.disabled) continue;
      if (x >= b.x && x <= b.x + b.w && m.y >= b.y && m.y <= b.y + b.h) {
        if (b.id === 'copy') this.copyCode();
        if (b.id === 'share') this.shareRoom();
        return;
      }
    }
  }

  // ------------------------------------------------------------ touch chrome
  get touchBack(): 'close' | 'back' | false {
    if (this.screen === 'starting' || this.screen === 'connecting' || this.screen === 'error') return false;
    if (this.modal) return 'close';
    return 'back';
  }

  touchBackAt = 'left' as const;

  touchButtons(): TouchButtonSpec[] {
    const ox = uiCenterX();
    if (this.modal === 'code' || this.modal === 'name') {
      const box = this.modalBox();
      // tapping the text box (re)opens the phone keyboard
      return [{ x: ox + box.x + 30, y: box.y + 40, w: box.w - 60, h: 52, tap: () => softKeyboard.request(), ghost: true }];
    }
    return [];
  }

  // ------------------------------------------------------------ layout
  private modalBox(): { x: number; y: number; w: number; h: number } {
    const w = this.modal === 'leave' ? 340 : 330;
    const h = this.modal === 'leave' ? 136 : 170;
    return { x: UI_W_BASE / 2 - w / 2, y: UI_H / 2 - h / 2 - 10, w, h };
  }

  private modalButtons(): Btn[] {
    const b = this.modalBox();
    const by = b.y + b.h - 46;
    if (this.modal === 'leave') {
      const host = this.lobby?.role === 'host';
      return [
        { id: 'm-cancel', x: b.x + 24, y: by, w: 130, h: 34, label: '취소' },
        { id: 'm-ok', x: b.x + b.w - 154, y: by, w: 130, h: 34, label: host ? '방 닫기' : '나가기', primary: true },
      ];
    }
    const ok = this.modal === 'code' ? isValidRoomCode(this.codeEdit) : true;
    return [
      { id: 'm-cancel', x: b.x + 24, y: by, w: 130, h: 34, label: '취소' },
      { id: 'm-ok', x: b.x + b.w - 154, y: by, w: 130, h: 34, label: this.modal === 'code' ? '참가' : '확인', primary: true, disabled: !ok },
    ];
  }

  private errorButtons(): Btn[] {
    const p = panelRect(ERROR_W, ERROR_H);
    const y = p.y + p.h - 50;
    const reload = this.error?.code === 'version' || this.error?.code === 'stale';
    if (reload) {
      return [
        { id: 'e-ok', x: UI_W_BASE / 2 - 150, y, w: 140, h: 36, label: '닫기' },
        { id: 'e-reload', x: UI_W_BASE / 2 + 10, y, w: 140, h: 36, label: '새로고침', primary: true },
      ];
    }
    return [{ id: 'e-ok', x: UI_W_BASE / 2 - 70, y, w: 140, h: 36, label: '확인', primary: true }];
  }

  private connectButtons(): Btn[] {
    const p = panelRect(CONNECT_W, CONNECT_H);
    return [{ id: 'c-cancel', x: UI_W_BASE / 2 - 70, y: p.y + p.h - 48, w: 140, h: 34, label: '취소' }];
  }

  private roomButtons(): Btn[] {
    const l = this.lobby;
    if (!l) return [];
    const host = l.role === 'host';
    const me = l.me;
    const out: Btn[] = [
      { id: 'copy', x: 500, y: 24, w: 86, h: 26, label: '복사', icon: 'net_copy', gesture: true },
      { id: 'share', x: 500, y: 54, w: 86, h: 26, label: '공유', icon: 'net_share', gesture: true },
      { id: 'leave', x: 26, y: 352, w: 132, h: 44, label: host ? '방 닫기' : '나가기' },
    ];
    if (host) out.push({ id: 'start', x: UI_W_BASE / 2 - 110, y: 352, w: 220, h: 44, label: '하강 시작', primary: true, disabled: !l.canStart() });
    else out.push({ id: 'ready', x: UI_W_BASE / 2 - 110, y: 352, w: 220, h: 44, label: me?.ready ? '준비 취소' : '준비 완료', primary: !me?.ready });
    // character arrows around the local card
    const card = this.cardRect(l.localSlot);
    if (card && this.chars.length > 1) {
      out.push({ id: 'prev', x: card.x + 4, y: card.y + 58, w: 34, h: 56, label: '' });
      out.push({ id: 'next', x: card.x + card.w - 38, y: card.y + 58, w: 34, h: 56, label: '' });
    }
    return out;
  }

  private cardRect(slot: number): { x: number; y: number; w: number; h: number } | null {
    if (slot < 0 || slot >= MAX_PLAYERS) return null;
    const w = 170;
    const gap = 12;
    const x0 = (UI_W_BASE - (w * MAX_PLAYERS + gap * (MAX_PLAYERS - 1))) / 2;
    return { x: x0 + slot * (w + gap), y: 96, w, h: 206 };
  }

  private activeButtons(): Btn[] {
    if (this.modal) return this.modalButtons();
    if (this.screen === 'room') return this.roomButtons();
    if (this.screen === 'error') return this.errorButtons();
    if (this.screen === 'connecting') return this.connectButtons();
    if (this.screen === 'main') return [{ id: 'name', ...NAME_PLATE, label: '' }];
    return [];
  }

  private mouse(): { x: number; y: number } {
    const m = app.renderer.displayToUI(input.mouseX, input.mouseY);
    return { x: m.x - uiCenterX(), y: m.y };
  }

  /** Button under the pointer this step (hover + clicks / taps). */
  private hitButton(): Btn | null {
    const m = this.mouse();
    for (const b of this.activeButtons()) {
      if (m.x >= b.x && m.x <= b.x + b.w && m.y >= b.y && m.y <= b.y + b.h) return b;
    }
    return null;
  }

  private press(id: string): void {
    switch (id) {
      case 'm-cancel':
        sfx('ui_back');
        this.closeText();
        return;
      case 'm-ok':
        if (this.modal === 'code') this.confirmCode();
        else if (this.modal === 'name') this.confirmName();
        else if (this.modal === 'leave') this.leaveRoom();
        return;
      case 'e-ok':
        sfx('ui_select');
        this.error = null;
        this.setScreen('main');
        return;
      case 'e-reload':
        location.reload();
        return;
      case 'c-cancel':
        this.cancelConnect();
        return;
      case 'name':
        sfx('ui_select');
        this.openName();
        return;
      case 'leave':
        this.askLeave();
        return;
      case 'start':
        this.startRun();
        return;
      case 'ready':
        this.toggleReady();
        return;
      case 'prev':
        this.pickCharacter(-1);
        return;
      case 'next':
        this.pickCharacter(1);
        return;
      default:
        return; // copy / share: DOM pointerup (user gesture)
    }
  }

  private askLeave(): void {
    this.modal = 'leave';
    this.modalT = 0;
    sfx('ui_open');
  }

  // ------------------------------------------------------------ update
  update(dt: number): void {
    this.t += dt;
    this.screenT += dt;
    this.modalT += dt;
    this.toastT = Math.max(0, this.toastT - dt);
    this.shake = Math.max(0, this.shake - dt);
    backdrop().update(dt);
    this.lobby?.update();
    this.trackPicks();
    if (app.scenes.top !== this) return;

    if (this.screen === 'starting') {
      if (this.screenT > 0.9 && this.session && this.startInfo && !this.handedOff) {
        this.handedOff = true;
        startNetRun(this.session, this.startInfo);
      }
      return;
    }

    const hit = this.hitButton();
    this.hover = hit && !hit.disabled ? hit.id : '';
    if (hit && input.pressed('fire')) {
      if (hit.disabled) sfx('ui_error');
      else this.press(hit.id);
      return;
    }

    if (this.modal) {
      this.updateModal();
      return;
    }
    switch (this.screen) {
      case 'main':
        this.menu.update(app.renderer, dt);
        if (input.pressed('cancel')) this.back();
        return;
      case 'connecting':
        if (input.pressed('cancel')) this.cancelConnect();
        return;
      case 'error':
        if (input.pressed('confirm') || input.pressed('cancel')) this.press('e-ok');
        return;
      case 'room':
        this.updateRoom(dt);
        return;
      default:
        return;
    }
  }

  private updateModal(): void {
    if (this.modal === 'leave') {
      if (input.pressed('confirm')) this.leaveRoom();
      else if (input.pressed('cancel')) {
        sfx('ui_back');
        this.modal = null;
      }
      return;
    }
    const typed = input.typed;
    if (this.modal === 'code' && !softKeyboard.active) {
      // desktop: typed keys (paste arrives through the paste event)
      const before = this.codeEdit;
      this.codeEdit = applyTypedCode(this.codeEdit, typed);
      if (this.codeEdit !== before) sfx('ui_move', { vol: 0.5, pitch: 1.2 });
    }
    if (this.modal === 'name' && !touchUiActive() && typeof document !== 'undefined' && document.activeElement?.id !== 'lk-text') {
      // desktop: keep the hidden text field focused (a click elsewhere blurs it)
      this.focusName();
    }
    if (input.pressed('cancel') && !typed.includes('\b')) {
      sfx('ui_back');
      this.closeText();
      return;
    }
    if (input.pressed('confirm') && !typed.includes(' ')) {
      if (this.modal === 'code') this.confirmCode();
      else this.confirmName();
    }
  }

  private updateRoom(dt: number): void {
    const l = this.lobby;
    if (!l) {
      this.setScreen('main');
      return;
    }
    if (this.rr.update(input.held('uiRight'), dt)) this.pickCharacter(1);
    if (this.rl.update(input.held('uiLeft'), dt)) this.pickCharacter(-1);
    if (input.pressed('confirm')) {
      if (l.role === 'host') this.startRun();
      else this.toggleReady();
    }
    if (input.pressed('discard')) this.copyCode(); // pad X
    if (input.pressed('cancel')) this.askLeave();
  }

  /** Remember when each slot changed character (hop + walk animation). */
  private trackPicks(): void {
    const l = this.lobby;
    if (!l) return;
    for (const p of l.roster) {
      if (this.lastChars.get(p.slot) !== p.characterId) {
        this.lastChars.set(p.slot, p.characterId);
        this.pickT.set(p.slot, this.t);
      }
    }
  }

  // ------------------------------------------------------------ draw
  draw(r: Renderer): void {
    r.beginWorld('#05030a');
    backdrop().draw(r);
    r.presentWorld();
    r.beginUI();
    r.dctx.translate(uiCenterX(), 0);
    const A = appear(this.t, 0.4);
    if (this.screen === 'room' || this.screen === 'starting') this.drawRoom(r, A);
    else this.drawMain(r, A * (this.screen === 'main' ? 1 : 0.35));
    if (this.screen === 'connecting') this.drawConnecting(r);
    if (this.screen === 'error') this.drawError(r);
    if (this.modal) this.drawModal(r);
    this.drawToast(r);
    if (this.screen === 'starting') {
      const k = clamp(this.screenT / 0.85, 0, 1);
      dimAll(r, '#000000', ease.inQuad(k) * 0.92);
      r.uiText('하강 준비…', UI_W_BASE / 2, UI_H / 2 - 8, { size: 16, bold: true, align: 'center', color: C.goldHi, alpha: Math.sin(k * Math.PI) });
    }
  }

  private drawButton(r: Renderer, b: Btn, alpha = 1): void {
    const hot = this.hover === b.id;
    const style = b.disabled ? 'button' : hot || b.primary ? 'buttonHi' : 'button';
    const a = alpha * (b.disabled ? 0.8 : 1);
    if (b.primary && !b.disabled) glow(r, b.x + b.w / 2, b.y + b.h / 2, b.w * 0.6, '#ff9a3a', 0.08 + (hot ? 0.06 : 0));
    frame(r, b.x, b.y, b.w, b.h, style, { alpha: a });
    if (hot && !b.disabled) r.uiRect(b.x + 4, b.y + 4, b.w - 8, b.h - 8, '#ffe8b0', 0.08 * alpha);
    const color = b.disabled ? C.textFaint : b.primary ? C.goldHi : hot ? '#fff4d8' : C.text;
    const size = b.h >= 40 ? 14 : 12;
    const tw = b.label ? r.measureText(b.label, size, !!b.primary) : 0;
    const iw = b.icon ? 18 : 0;
    const x0 = b.x + b.w / 2 - (tw + iw) / 2;
    if (b.icon) r.uiSprite(b.icon, x0 + 6, b.y + b.h / 2 + 1, 2, { alpha: a });
    if (b.label) r.uiText(b.label, x0 + iw, b.y + b.h / 2 - size / 2 - 1, { size, bold: !!b.primary, color, alpha: a });
  }

  private drawMain(r: Renderer, A: number): void {
    r.uiText('함께하기', UI_W_BASE / 2, 22, { size: 24, bold: true, align: 'center', color: C.text, outline: C.ink, alpha: A });
    divider(r, UI_W_BASE / 2, 54, 240, C.goldDark, A);
    r.uiText('방 코드로 친구와 최대 4명까지 함께 하강합니다.', UI_W_BASE / 2, 66, { size: 12, align: 'center', color: C.textDim, alpha: A });
    // name plate
    const { x, y, w, h } = NAME_PLATE;
    const hot = this.hover === 'name';
    frame(r, x, y, w, h, hot ? 'panelHi' : 'panel', { alpha: A * 0.95 });
    const ch = this.chars.find((c) => c.id === save.history[0]?.character) ?? this.chars[0];
    if (ch) {
      glow(r, x + 36, y + 34, 34, ch.color, 0.18 * A);
      const anim = `${ch.spritePrefix}_idle_down`;
      r.uiSprite(hasAnim(anim) ? animFrame(anim, this.t) : ch.portrait, x + 36, y + 52, 2, { alpha: A });
    }
    r.uiText('내 이름', x + 66, y + 13, { size: 10, font: 'small', color: C.gold, alpha: A });
    r.uiText(this.name, x + 66, y + 29, { size: 16, bold: true, color: C.text, alpha: A });
    r.uiSprite('net_pen', x + w - 24, y + 33, 2, { alpha: A * (hot ? 1 : 0.7) });
    // menu
    const mA = A * appear(this.t, 0.4, 0.15);
    const d = r.dctx;
    d.save();
    const grd = d.createRadialGradient(UI_W_BASE / 2, 260, 10, UI_W_BASE / 2, 260, 150);
    grd.addColorStop(0, 'rgba(5,3,10,0.75)');
    grd.addColorStop(1, 'rgba(5,3,10,0)');
    d.globalAlpha = mA;
    d.fillStyle = grd;
    d.fillRect(UI_W_BASE / 2 - 200, 150, 400, 240);
    d.restore();
    this.menu.draw(r, mA);
    // footer
    const sa = r.uiSafe;
    const note = this.cfg.kind === 'bc'
      ? '개발 모드 · 같은 브라우저의 탭끼리 연결 (BroadcastChannel)'
      : '서버 없이 기기끼리 직접 연결돼요 · 인터넷 연결이 필요해요';
    r.uiText(note, UI_W_BASE / 2, 370, { size: 10, font: 'small', align: 'center', color: C.textFaint, alpha: A });
    if (!touchUiActive()) keyHintRow(r, [['↑↓', '선택'], ['Enter', '결정'], ['Esc', '뒤로']], UI_W_BASE / 2, UI_H - 12 - sa.b, { alpha: A * 0.8, pad: input.aimMode === 'pad' });
  }

  private drawPanel(r: Renderer, w: number, h: number, k: number): { x: number; y: number } {
    const p = panelRect(w, h);
    const y = p.y + (1 - k) * 14;
    dimAll(r, C.void, 0.55 * clamp(this.screenT / 0.2, 0, 1));
    frame(r, p.x, y, w, h, 'ornate', { alpha: clamp(k, 0, 1) });
    return { x: p.x, y };
  }

  private drawConnecting(r: Renderer): void {
    const k = appear(this.screenT, 0.25, 0, ease.outBack);
    const { y } = this.drawPanel(r, CONNECT_W, CONNECT_H, k);
    const fl = 0.85 + 0.15 * Math.sin(this.t * 9);
    glow(r, UI_W_BASE / 2, y + 30, 46, '#ff9a3a', 0.25 * fl);
    r.uiSprite('ui_flame', UI_W_BASE / 2, y + 34 + Math.sin(this.t * 4) * 2, 3);
    const dots = '.'.repeat(1 + (Math.floor(this.t * 3) % 3));
    const msg = this.connectMsg.replace(/…$/, '');
    const mw = r.measureText(msg, 16, true);
    r.uiText(msg + dots, UI_W_BASE / 2 - mw / 2, y + 50, { size: 16, bold: true, color: C.goldHi });
    const sub = this.screenT > 6 ? '연결이 오래 걸리고 있어요…' : this.connectCode ? `방 코드 ${this.connectCode}` : '잠시만 기다려 주세요';
    r.uiText(sub, UI_W_BASE / 2, y + 74, { size: 10, font: 'small', align: 'center', color: this.screenT > 6 ? C.textFaint : C.textDim });
    for (const b of this.connectButtons()) this.drawButton(r, { ...b, y: b.y + (y - panelRect(CONNECT_W, CONNECT_H).y) }, clamp(k, 0, 1));
  }

  private drawError(r: Renderer): void {
    const e = this.error;
    if (!e) return;
    const k = appear(this.screenT, 0.25, 0, ease.outBack);
    const { y } = this.drawPanel(r, ERROR_W, ERROR_H, k);
    const icon = ERROR_ICON[e.code] ?? 'ui_skull';
    const tw = r.measureText(e.title, 16, true);
    r.uiSprite(icon, UI_W_BASE / 2 - tw / 2 - 18, y + 30, 2, { alpha: 0.95 });
    r.uiText(e.title, UI_W_BASE / 2 + 4, y + 22, { size: 16, bold: true, align: 'center', color: '#ffb0a0' });
    const lines = r.wrapText(e.hint, ERROR_W - 60, 12);
    lines.slice(0, 3).forEach((ln, i) => r.uiText(ln, UI_W_BASE / 2, y + 52 + i * 18, { size: 12, align: 'center', color: C.textDim }));
    const dy = y - panelRect(ERROR_W, ERROR_H).y;
    for (const b of this.errorButtons()) this.drawButton(r, { ...b, y: b.y + dy }, clamp(k, 0, 1));
  }

  private drawModal(r: Renderer): void {
    const k = appear(this.modalT, 0.25, 0, ease.outBack);
    const b = this.modalBox();
    dimAll(r, C.void, 0.55 * clamp(this.modalT / 0.2, 0, 1));
    const y = b.y + (1 - k) * 14;
    frame(r, b.x, y, b.w, b.h, 'ornate', { alpha: clamp(k, 0, 1) });
    const touchUi = touchUiActive();
    if (this.modal === 'leave') {
      const host = this.lobby?.role === 'host';
      r.uiText(host ? '방을 닫을까요?' : '방에서 나갈까요?', UI_W_BASE / 2, y + 22, { size: 16, bold: true, align: 'center', color: C.goldHi });
      r.uiText(host ? '친구들도 모두 방에서 나가게 돼요.' : '다시 들어오려면 코드를 입력해야 해요.', UI_W_BASE / 2, y + 50, { size: 12, align: 'center', color: C.textDim });
    } else if (this.modal === 'code') {
      r.uiText('방 코드 입력', UI_W_BASE / 2, y + 14, { size: 16, bold: true, align: 'center', color: C.goldHi });
      const sx = this.shake > 0 ? Math.sin(this.shake * 60) * 4 * (this.shake / 0.35) : 0;
      const tw = 46;
      const gap = 10;
      const x0 = UI_W_BASE / 2 - (tw * ROOM_CODE_LENGTH + gap * (ROOM_CODE_LENGTH - 1)) / 2 + sx;
      for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
        const tx = x0 + i * (tw + gap);
        const cur = i === this.codeEdit.length;
        frame(r, tx, y + 42, tw, 52, cur ? 'slotHi' : 'inset');
        const ch = this.codeEdit[i];
        if (ch) r.uiText(ch, tx + tw / 2, y + 52, { size: 24, bold: true, align: 'center', color: C.text });
        else if (cur && Math.floor(this.modalT * 2.2) % 2 === 0) r.uiRect(tx + tw / 2 - 8, y + 80, 16, 3, C.goldHi);
      }
      const hint = touchUi ? '칸을 눌러 입력 · 초대 링크도 붙여넣을 수 있어요' : '친구에게 받은 4자리 코드 · Ctrl+V로 붙여넣기';
      r.uiText(hint, UI_W_BASE / 2, y + 102, { size: 10, font: 'small', align: 'center', color: C.textFaint });
    } else if (this.modal === 'name') {
      r.uiText('이름 바꾸기', UI_W_BASE / 2, y + 14, { size: 16, bold: true, align: 'center', color: C.goldHi });
      const bx = b.x + 34;
      const bw = b.w - 68;
      frame(r, bx, y + 46, bw, 34, 'inset');
      const shown = this.nameEdit;
      r.uiText(shown, UI_W_BASE / 2, y + 55, { size: 16, align: 'center', color: C.text });
      if (!shown) r.uiText(touchUi ? '눌러서 입력' : '이름을 입력하세요', UI_W_BASE / 2, y + 57, { size: 12, align: 'center', color: C.textMute });
      const caretX = UI_W_BASE / 2 + r.measureText(shown, 16) / 2 + 2;
      if (Math.floor(this.modalT * 2.2) % 2 === 0 && shown) r.uiRect(caretX, y + 54, 2, 18, C.goldHi);
      r.uiText(`최대 10자 · 친구들에게 보이는 이름이에요`, UI_W_BASE / 2, y + 92, { size: 10, font: 'small', align: 'center', color: C.textFaint });
    }
    for (const bt of this.modalButtons()) this.drawButton(r, { ...bt, y: bt.y + (1 - k) * 14 }, clamp(k, 0, 1));
  }

  private drawToast(r: Renderer): void {
    if (this.toastT <= 0 || !this.toast) return;
    const a = clamp(this.toastT / 0.4, 0, 1) * appear(2.2 - this.toastT, 0.15);
    const w = r.measureText(this.toast, 12) + 32;
    const y = this.screen === 'room' ? 318 : 396;
    frame(r, UI_W_BASE / 2 - w / 2, y, w, 26, 'tooltip', { alpha: a, color: C.gold });
    r.uiText(this.toast, UI_W_BASE / 2, y + 6, { size: 12, align: 'center', color: C.goldHi, alpha: a });
  }

  private drawRoom(r: Renderer, A: number): void {
    const l = this.lobby;
    const roster = l?.roster ?? this.startInfo?.roster ?? [];
    const code = l?.code ?? this.session?.code ?? '';
    const host = (l?.role ?? this.session?.role) === 'host';
    // code header
    r.uiText('방 코드', UI_W_BASE / 2, 8, { size: 10, font: 'small', align: 'center', color: C.gold, alpha: A });
    const tw = 44;
    const gap = 8;
    const x0 = UI_W_BASE / 2 - (tw * 4 + gap * 3) / 2;
    glow(r, UI_W_BASE / 2, 52, 110, '#ffb050', 0.07 * A);
    for (let i = 0; i < 4; i++) {
      const tx = x0 + i * (tw + gap);
      const bob = Math.sin(this.t * 2.2 + i * 0.7) * 1.2;
      frame(r, tx, 24 + bob, tw, 54, 'slotHi', { alpha: A });
      r.uiText(code[i] ?? '', tx + tw / 2, 33 + bob, { size: 32, bold: true, align: 'center', color: C.goldHi, outline: C.ink, alpha: A });
    }
    // left of the code: who / how many
    const count = roster.length;
    r.uiText(host ? '내가 방장' : '참가 중', 120, 30, { size: 12, bold: true, color: C.text, alpha: A });
    r.uiText(`인원 ${count}/${MAX_PLAYERS}`, 120, 48, { size: 10, font: 'small', color: C.textDim, alpha: A });
    if (!host && l) {
      const rtt = Math.round(l.rtt());
      r.uiText(rtt ? `핑 ${rtt}ms` : '핑 측정 중', 120, 62, { size: 10, font: 'small', color: pingColor(rtt), alpha: A });
    }
    if (this.cfg.kind === 'bc') r.uiText('개발 모드 (탭 간)', 120, 76, { size: 10, font: 'small', color: C.textFaint, alpha: A });
    // roster cards
    for (let s = 0; s < MAX_PLAYERS; s++) {
      const p = roster.find((q) => q.slot === s);
      this.drawCard(r, s, p, A, l?.localSlot ?? this.session?.localSlot ?? -1);
    }
    // status line
    let status = '';
    if (l) {
      const others = roster.filter((p) => !p.host);
      const readyN = others.filter((p) => p.ready).length;
      if (host) status = others.length === 0 ? '친구를 기다리는 중… 혼자서도 시작할 수 있어요' : readyN === others.length ? '모두 준비됐어요!' : `친구들이 준비하기를 기다리는 중… (${readyN}/${others.length})`;
      else status = l.me?.ready ? '방장이 시작하기를 기다리는 중…' : '캐릭터를 고르고 준비 완료를 눌러 주세요';
    }
    if (this.screen === 'starting') status = '하강을 시작합니다!';
    if (status && this.toastT <= 0) r.uiText(status, UI_W_BASE / 2, 322, { size: 12, align: 'center', color: this.screen === 'starting' ? C.goldHi : C.textDim, alpha: A });
    if (this.screen === 'starting') return;
    // buttons
    for (const b of this.roomButtons()) {
      if (b.id === 'prev' || b.id === 'next') continue;
      this.drawButton(r, b, A);
    }
    const sa = r.uiSafe;
    if (!touchUiActive() && this.screen === 'room') {
      keyHintRow(r, [['←→', '캐릭터'], ['Enter', host ? '시작' : '준비'], ['C', '코드 복사'], ['Esc', host ? '방 닫기' : '나가기']], UI_W_BASE / 2, UI_H - 12 - sa.b, { alpha: A * 0.8, pad: input.aimMode === 'pad' });
    }
  }

  private drawCard(r: Renderer, slot: number, p: LobbyPlayer | undefined, A: number, localSlot: number): void {
    const rc = this.cardRect(slot)!;
    const { x, y, w, h } = rc;
    const k = appear(this.screenT, 0.35, 0.05 * slot);
    const yy = y + (1 - k) * 12;
    const a = A * k;
    if (!p) {
      frame(r, x, yy, w, h, 'inset', { alpha: a * 0.8 });
      r.uiText(`${slot + 1}P`, x + 12, yy + 10, { size: 10, font: 'small', color: C.textMute, alpha: a });
      r.uiSprite('ui_question', x + w / 2, yy + 92, 4, { alpha: a * 0.35 });
      r.uiText('빈 자리', x + w / 2, yy + 126, { size: 12, align: 'center', color: C.textFaint, alpha: a });
      r.uiText('코드를 알려 친구를 부르세요', x + w / 2, yy + 146, { size: 10, font: 'small', align: 'center', color: C.textMute, alpha: a });
      return;
    }
    const mine = p.slot === localSlot;
    const ch = Characters.get(p.characterId);
    frame(r, x, yy, w, h, mine ? 'panelHi' : 'panel', { alpha: a });
    if (mine) frame(r, x - 2, yy - 2, w + 4, h + 4, 'tooltip', { alpha: a * (0.6 + 0.2 * Math.sin(this.t * 3)), color: C.gold });
    // header: slot + name
    r.uiText(`${slot + 1}P`, x + 12, yy + 10, { size: 10, font: 'small', color: mine ? C.goldHi : C.textFaint, alpha: a });
    if (p.host) r.uiSprite('ui_crown', x + w - 16, yy + 16, 2, { alpha: a });
    const name = p.name + (mine ? ' (나)' : '');
    r.uiText(name, x + w / 2, yy + 24, { size: 12, bold: true, align: 'center', color: mine ? C.goldHi : C.text, alpha: a });
    // keeper on a pedestal
    const baseY = yy + 132;
    const d = r.dctx;
    d.globalAlpha = a;
    d.fillStyle = '#0c0810';
    d.beginPath();
    d.ellipse(x + w / 2, baseY + 2, 40, 12, 0, 0, Math.PI * 2);
    d.fill();
    d.fillStyle = '#2a2236';
    d.beginPath();
    d.ellipse(x + w / 2, baseY, 36, 10, 0, 0, Math.PI * 2);
    d.fill();
    d.fillStyle = '#3e3450';
    d.beginPath();
    d.ellipse(x + w / 2, baseY - 2, 32, 7, 0, 0, Math.PI * 2);
    d.fill();
    d.globalAlpha = 1;
    if (ch) {
      const fl = 0.85 + 0.15 * Math.sin(this.t * 7.3 + slot);
      glow(r, x + w / 2, baseY - 36, 58, ch.color, (p.ready || p.host ? 0.26 : 0.14) * a * fl);
      const since = this.t - (this.pickT.get(slot) ?? -9);
      const pre = ch.spritePrefix;
      let anim = `${pre}_idle_down`;
      if (since < 0.8 && hasAnim(`${pre}_walk_down`)) anim = `${pre}_walk_down`;
      const frameName = hasAnim(anim) ? animFrame(anim, this.t + slot * 0.37) : ch.portrait;
      const hop = Math.max(0, Math.sin(clamp(since / 0.3, 0, 1) * Math.PI)) * 8;
      r.uiSprite(frameName, x + w / 2, baseY - 2 - hop, 4, { alpha: a });
      r.uiText(ch.name, x + w / 2, baseY + 14, { size: 12, bold: true, align: 'center', color: ch.color, outline: C.ink, alpha: a });
      r.uiText(ch.title, x + w / 2, baseY + 32, { size: 10, font: 'small', align: 'center', color: C.textDim, alpha: a });
    }
    // character arrows (local card)
    if (mine && this.chars.length > 1 && this.screen === 'room') {
      const bob = Math.sin(this.t * 4) * 2;
      const ha = this.hover === 'prev' ? 1 : 0.75;
      const hb = this.hover === 'next' ? 1 : 0.75;
      r.uiSprite('ui_arrow_l', x + 20 - bob, yy + 88, 3, { alpha: a * ha });
      r.uiSprite('ui_arrow_r', x + w - 20 + bob, yy + 88, 3, { alpha: a * hb });
    }
    // footer: ready / host, ping
    const fy = yy + h - 26;
    r.uiRect(x + 8, fy - 4, w - 16, 2, C.rimDark, a);
    if (p.host) {
      r.uiText('방장', x + 14, fy + 2, { size: 12, bold: true, color: C.gold, alpha: a });
    } else if (p.ready) {
      r.uiSprite('ui_check', x + 20, fy + 9, 2, { alpha: a });
      r.uiText('준비 완료', x + 32, fy + 2, { size: 12, bold: true, color: C.good, alpha: a });
    } else {
      const dots = '.'.repeat(1 + (Math.floor(this.t * 2 + slot) % 3));
      r.uiText(`준비 중${dots}`, x + 14, fy + 2, { size: 12, color: C.textFaint, alpha: a });
    }
    const ping = mine && this.lobby?.role === 'client' ? Math.round(this.lobby.rtt()) : p.ping;
    if (!p.host) {
      const col = pingColor(ping);
      const bars = ping <= 0 ? 0 : ping < 90 ? 3 : ping < 180 ? 2 : 1;
      for (let i = 0; i < 3; i++) r.uiRect(x + w - 40 + i * 6, fy + 12 - i * 4, 4, 4 + i * 4, i < bars ? col : C.rimDark, a);
      const label = ping > 0 ? `${ping}ms` : ping < 0 ? '응답 없음' : '–';
      r.uiText(label, x + w - 46, fy + 3, { size: 10, font: 'small', align: 'right', color: col, alpha: a });
    }
  }
}

// ---------------------------------------------------------------- debug / automation (window.__lknet)
let activeLobbyScene: LobbyScene | null = null;
let lastStart: StartInfo | null = null;

export interface NetDebugApi {
  open(join?: string): void;
  host(): Promise<string>;
  join(code: string): Promise<void>;
  pick(dir: number): void;
  ready(): void;
  start(): boolean;
  state(): Record<string, unknown>;
  lastStart(): StartInfo | null;
  probe(ticks?: number): Promise<ProbeResult>;
}

function installNetDebug(): void {
  if (typeof window === 'undefined') return;
  const scene = () => activeLobbyScene;
  const api: NetDebugApi = {
    open: (join) => app.scenes.set(new LobbyScene({ join })),
    host: async () => (await scene()?.createRoom()) ?? '',
    join: async (code) => scene()?.joinRoom(normalizeRoomCode(code)),
    pick: (dir) => scene()?.pickCharacter(dir),
    ready: () => scene()?.toggleReady(),
    start: () => scene()?.startRun() ?? false,
    state: () => {
      const s = scene() as unknown as { screen: string; modal: string | null; lobby: Lobby | null; error: unknown; name: string } | null;
      const sess = activeSession();
      return {
        scene: s ? 'lobby' : app.scenes.top?.constructor?.name ?? 'none',
        screen: s?.screen ?? null,
        modal: s?.modal ?? null,
        name: s?.name ?? null,
        code: s?.lobby?.code ?? sess?.code ?? null,
        role: s?.lobby?.role ?? sess?.role ?? null,
        lobbyState: s?.lobby?.state ?? null,
        localSlot: s?.lobby?.localSlot ?? sess?.localSlot ?? null,
        roster: s?.lobby?.roster ?? sess?.roster ?? [],
        canStart: s?.lobby?.canStart() ?? false,
        error: s?.error ?? null,
        build: BUILD_ID,
      };
    },
    lastStart: () => lastStart,
    probe: (ticks = 180) => {
      const s = activeSession();
      return s ? probeLockstep(s, ticks) : Promise.reject(new Error('no active session'));
    },
  };
  (window as unknown as { __lknet: NetDebugApi }).__lknet = api;
}

installNetDebug();
