// First-run contextual hints: small toasts with key caps that appear once per
// save the first time something becomes relevant (full ember gauge, ready
// active item, a potion in hand, first artifact, ...). Plus a compact menu-key
// overlay in the very first room of a player's first descent.

import type { Renderer } from '../engine/renderer';
import { UI_H, UI_W } from '../engine/renderer';
import type { World } from '../game/world';
import type { Action } from '../engine/input';
import { input } from '../engine/input';
import { save } from '../engine/save';
import { Actives } from '../game/defs';
import { EMBER_MAX } from '../game/player';
import { SealLamp } from '../game/seal-lamp';
import { StoneLantern } from '../game/stone-lantern';
import { ColdSconce } from '../game/cold-sconce';
import { clamp, ease } from '../engine/math';
import { frame, keycap } from './frame';
import { C } from './theme';
import { actionLabel } from './keys';
import { touchUiActive } from './touch-mode';
import { UiLayer } from './layer-cache';
import { sfx } from '../audio/audio';

interface HintDef {
  id: string;
  action: Action;
  text: string;
  /** condition to show */
  when(w: World, h: HintState): boolean;
  duration?: number;
}

interface HintState {
  roomsVisited: number;
  startArtifacts: number;
}

export const HINTS: HintDef[] = [
  {
    id: 'ember', action: 'special', text: '등불 해방 — 게이지가 가득 찼다!',
    when: (w) => w.player.ember >= EMBER_MAX,
  },
  {
    id: 'active', action: 'active', text: '액티브 아이템 사용 — 방을 정화하면 다시 충전된다',
    when: (w) => {
      const p = w.player;
      const d = p.activeId ? Actives.get(p.activeId) : undefined;
      return !!d && p.activeCharge >= d.charge;
    },
  },
  {
    id: 'potion', action: 'consumable', text: '물약 마시기 — 마셔 봐야 정체를 안다',
    when: (w) => !!w.player.potionId,
  },
  {
    id: 'artifact', action: 'inventory', text: '소지품 — 모은 유물과 등불 공명을 확인',
    when: (w, h) => w.player.inv.items.length > h.startArtifacts,
  },
  {
    id: 'map', action: 'map', text: '지도 펼치기',
    when: (_w, h) => h.roomsVisited >= 5,
  },
  {
    id: 'match', action: 'interact', text: '성냥 — 꺼진 등에 불을 붙여 보자',
    when: (w) => w.player.matches >= 1 && w.entities.some((e) => (e instanceof StoneLantern || e instanceof ColdSconce || e instanceof SealLamp) && !e.lit),
  },
];

export class HintSystem {
  private readonly lyHint = new UiLayer();
  private readonly lyMenu = new UiLayer();
  private menuKeysKey = '';
  private menuParts: { key: string; label: string }[] = [];
  private menuW = 0;
  private mDef: HintDef | null = null;
  private mKey = '';
  private mTw = 0;
  private mKw = 0;
  private queue: HintDef[] = [];
  private cur: { def: HintDef; t: number } | null = null;
  private visited = new Set<number>();
  private startArtifacts = -1;
  private menuKeysT = -1;
  private menuKeysDone = false;
  private cooldown = 2;

  /** Has this hint already been shown on this save? */
  static seen(id: string): boolean {
    return save.hasFlag(`hint:${id}`);
  }

  update(w: World, dt: number): void {
    if (this.startArtifacts < 0) this.startArtifacts = w.player.inv.items.length;
    this.visited.add(w.node.id);
    const st: HintState = { roomsVisited: this.visited.size, startArtifacts: this.startArtifacts };
    this.cooldown = Math.max(0, this.cooldown - dt);
    // first-room menu keys (first descent only)
    if (!this.menuKeysDone) {
      const firstRoom = w.run.floor === 1 && w.node.kind === 'start';
      if (this.menuKeysT < 0 && save.hasFlag('hint:menukeys')) this.menuKeysDone = true;
      else if (firstRoom) {
        this.menuKeysT = Math.max(0, this.menuKeysT) + dt;
        if (this.menuKeysT > 2.5) save.setFlag('hint:menukeys');
        if (this.menuKeysT > 14) this.menuKeysDone = true;
      } else if (this.menuKeysT >= 0) this.menuKeysDone = true;
    }
    for (const h of HINTS) {
      if (this.cur?.def === h || this.queue.includes(h) || HintSystem.seen(h.id)) continue;
      let ok = false;
      try {
        ok = h.when(w, st);
      } catch {
        ok = false;
      }
      if (ok) this.queue.push(h);
    }
    if (this.cur) {
      this.cur.t += dt;
      if (this.cur.t > (this.cur.def.duration ?? 5)) {
        this.cur = null;
        this.cooldown = 1.2;
      }
    } else if (this.queue.length && this.cooldown <= 0 && !w.bossIntro && !w.floorCard) {
      const def = this.queue.shift()!;
      this.cur = { def, t: 0 };
      save.setFlag(`hint:${def.id}`);
      sfx('ui_open', { vol: 0.35, pitch: 1.3 });
    }
  }

  draw(r: Renderer, w: World, bottomY: number): void {
    const pad = input.aimMode === 'pad';
    if (this.cur) {
      const t = this.cur.t;
      const dur = this.cur.def.duration ?? 5;
      const a = clamp(Math.min(t / 0.25, (dur - t) / 0.4), 0, 1);
      const slide = (1 - ease.outBack(clamp(t / 0.35, 0, 1))) * 14;
      const key = actionLabel(input.bindings, this.cur.def.action, pad);
      if (this.cur.def !== this.mDef || key !== this.mKey) {
        // measured once per hint (not every frame)
        this.mDef = this.cur.def;
        this.mKey = key;
        this.mTw = r.measureText(this.cur.def.text, 12);
        this.mKw = key ? Math.max(16, r.measureText(key, 10, false, 'small') + 10) : 0;
      }
      const tw = this.mTw;
      const kw = this.mKw;
      const width = tw + kw + 34;
      const x = UI_W / 2 - width / 2;
      const menuKeys = this.menuKeysT >= 0 && !this.menuKeysDone && !touchUiActive();
      const y = bottomY - 30 + slide - (menuKeys ? 30 : 0);
      const text = this.cur.def.text;
      const paint = (al: number) => {
        frame(r, x, y, width, 28, 'ribbon', { color: C.gold, alpha: al * 0.95 });
        keycap(r, key, x + 12, y + 14, { align: 'left', alpha: al, pad });
        r.uiText(text, x + 18 + kw, y + 8, { size: 12, color: C.text, alpha: al });
      };
      // after the slide-in the ribbon is a cached bitmap (only its alpha changes)
      if (slide !== 0) paint(a);
      else this.lyHint.draw(r, `${text}|${key}|${x}|${y}`, 0, 0, x - 2, y - 2, width + 4, 32, a, () => paint(1));
      // pulse ring hint at the key
      if (kw) r.uiRect(x + 12, y + 6, kw, 16, '#ffe8a0', a * 0.25 * (0.5 + 0.5 * Math.sin(t * 8)));
    }
    if (this.menuKeysT >= 0 && !this.menuKeysDone && !touchUiActive()) {
      const t = this.menuKeysT;
      const a = clamp(Math.min((t - 0.8) / 0.4, (14 - t) / 0.6), 0, 1);
      if (a > 0) {
        const keys = `${actionLabel(input.bindings, 'inventory', pad)}|${actionLabel(input.bindings, 'map', pad)}|${actionLabel(input.bindings, 'pause', pad)}`;
        if (keys !== this.menuKeysKey) {
          // measured only when the bindings change
          this.menuKeysKey = keys;
          const items: [Action, string][] = [['inventory', '소지품'], ['map', '지도'], ['pause', '일시정지']];
          this.menuParts = items.map(([act, label]) => ({ key: actionLabel(input.bindings, act, pad), label }));
          let wd = 20;
          for (const p of this.menuParts) wd += Math.max(16, r.measureText(p.key, 10, false, 'small') + 10) + r.measureText(p.label, 10, false, 'small') + 20;
          this.menuW = wd;
        }
        const parts = this.menuParts;
        const width = this.menuW;
        const x = UI_W / 2 - width / 2;
        const y = UI_H - 36;
        this.lyMenu.draw(r, `${keys}|${x}`, 0, 0, x - 2, y - 2, width + 4, 28, a, () => {
          frame(r, x, y, width, 24, 'ribbon', { color: C.goldDark, alpha: 1 });
          let cx = x + 12;
          for (const p of parts) {
            const kw = keycap(r, p.key, cx, y + 12, { align: 'left', alpha: 1, pad });
            r.uiText(p.label, cx + kw + 4, y + 7, { size: 10, font: 'small', color: C.textDim, alpha: 1 });
            cx += kw + 4 + r.measureText(p.label, 10, false, 'small') + 16;
          }
        });
      }
    }
  }
}
