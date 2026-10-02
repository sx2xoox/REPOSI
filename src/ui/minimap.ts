// Minimap: shows discovered rooms around the current room with special-room icons.

import type { Renderer } from '../engine/renderer';
import type { World } from '../game/world';
import { MAP_H, MAP_W } from '../game/constants';

const ICONS: Partial<Record<string, string>> = {
  boss: 'map_boss',
  treasure: 'map_treasure',
  shop: 'map_shop',
  secret: 'map_secret',
  challenge: 'map_challenge',
  shrine: 'map_shrine',
  curse: 'map_curse',
};

/** Draw the minimap into the rect (x,y,w,h) in UI space. `full` draws the whole floor. */
export function drawMinimap(r: Renderer, w: World, x: number, y: number, mw: number, mh: number, full = false): void {
  const cell = full ? 22 : 13;
  const gap = 2;
  const d = r.dctx;
  r.uiPanel(x, y, mw, mh, { alpha: 0.6, fill: '#100c16' });
  d.save();
  d.beginPath();
  d.rect(x + 3, y + 3, mw - 6, mh - 6);
  d.clip();
  const cur = w.node;
  const ccx = cur.gx + cur.cw / 2;
  const ccy = cur.gy + cur.ch / 2;
  const ox = full ? x + mw / 2 - (MAP_W / 2) * cell : x + mw / 2 - ccx * cell;
  const oy = full ? y + mh / 2 - (MAP_H / 2) * cell : y + mh / 2 - ccy * cell;
  for (const n of w.map.nodes) {
    if (!n.discovered) continue;
    if (n.kind === 'secret' && !n.visited && !w.flags.has('mapRevealSecret')) {
      // secret rooms only show once a door to them was found
      const found = w.map.nodes.some((o) => o.doors.some((dd) => dd.to === n.id && (dd as { revealed?: boolean }).revealed));
      if (!found) continue;
    }
    const rx = ox + n.gx * cell + gap / 2;
    const ry = oy + n.gy * cell + gap / 2;
    const rw = n.cw * cell - gap;
    const rh = n.ch * cell - gap;
    const isCur = n === cur;
    const col = isCur ? '#f4ecdc' : n.visited ? '#8a7f9a' : '#3a3346';
    d.fillStyle = '#05030a';
    d.fillRect(rx - 1, ry - 1, rw + 2, rh + 2);
    d.fillStyle = col;
    d.fillRect(rx, ry, rw, rh);
    const icon = ICONS[n.kind];
    if (icon) r.uiSprite(icon, rx + rw / 2, ry + rh / 2, full ? 2 : 1);
  }
  d.restore();
}
