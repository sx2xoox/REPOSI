import { defineCanvasSprite } from '../engine/sprites';
import { Weapons } from '../game/defs';
import { PIXELLAB_WEAPON_LAYOUT } from './pixellab-weapon-layout';

const urls = import.meta.glob('../assets/pixellab/weapons/*.png', {
  eager: true, query: '?url', import: 'default',
}) as Record<string, string>;

/** Bundle native held art and separately authored tiny icons; no runtime image service. */
export async function loadPixelLabWeapons(): Promise<void> {
  if (typeof Image === 'undefined') return;
  const images = new Map<string, HTMLImageElement>();
  await Promise.all(Object.entries(urls).map(async ([path, url]) => {
    const image = new Image(); image.src = url;
    try { await image.decode(); }
    catch { console.warn('PixelLab weapon asset unavailable:', path); return; }
    images.set(path.split('/').pop()!.replace('.png', ''), image);
  }));
  for (const [id, layout] of Object.entries(PIXELLAB_WEAPON_LAYOUT)) {
    const weapon = Weapons.get(id), held = images.get(`held-${id}`), icon = images.get(`icon-${id}`);
    if (!weapon || !held || !icon) continue;
    const heldName = `pl_w_${id}`, iconName = `pl_icon_${id}`;
    defineCanvasSprite(heldName, held.naturalWidth, held.naturalHeight, c => {
      c.imageSmoothingEnabled = false; c.drawImage(held, 0, 0);
    }, { origin: layout.grip });
    defineCanvasSprite(iconName, icon.naturalWidth, icon.naturalHeight, c => {
      c.imageSmoothingEnabled = false; c.drawImage(icon, 0, 0);
    }, { anchor: 'center' });
    weapon.heldSprite = heldName;
    weapon.icon = iconName;
  }
}
