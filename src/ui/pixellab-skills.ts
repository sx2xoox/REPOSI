import { defineCanvasSprite } from '../engine/sprites';
import { Characters } from '../game/defs';

const urls = import.meta.glob('../assets/pixellab/skills/icon_*.png', {
  eager: true, query: '?url', import: 'default',
}) as Record<string, string>;

/** Native tiny PixelLab icons replace the fallback glyphs after content loads. */
export async function loadPixelLabSkills(): Promise<void> {
  if (typeof Image === 'undefined') return;
  await Promise.all(Object.entries(urls).map(async ([path, url]) => {
    const image = new Image(); image.src = url;
    try { await image.decode(); }
    catch { console.warn('PixelLab skill asset unavailable:', path); return; }
    const id = path.split('/').pop()!.replace('.png', '');
    defineCanvasSprite(id, image.naturalWidth, image.naturalHeight, c => {
      c.imageSmoothingEnabled = false; c.drawImage(image, 0, 0);
    }, { anchor: 'center' });
    const match = /^icon_(tove|luen|ves|ort|mira)_(passive|dash|release)$/.exec(id);
    if (!match) return;
    const keeper = Characters.get(match[1]);
    if (!keeper) return;
    if (match[2] === 'release') keeper.releaseIcon = id;
    else if (match[2] === 'passive' && keeper.passive) keeper.passive.icon = id;
    else if (match[2] === 'dash' && keeper.dash) keeper.dash.icon = id;
  }));
}
