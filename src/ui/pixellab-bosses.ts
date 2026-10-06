import { replaceSpriteArt } from '../engine/sprites';
import manifest from '../assets/pixellab/bosses/manifest.json';

// Only packed atlases enter the bundle. Generated originals remain available for review.
const urls = import.meta.glob('../assets/pixellab/bosses/atlas-*.png', {
  eager: true, query: '?url', import: 'default',
}) as Record<string, string>;

/** Presentation only: existing frame names, timing, pivots and boss logic stay intact. */
export async function loadPixelLabBosses(): Promise<void> {
  if (typeof Image === 'undefined') return;
  await Promise.all(Object.entries(urls).map(async ([path, url]) => {
    const image = new Image();
    image.src = url;
    try { await image.decode(); }
    catch { console.warn('Boss artwork unavailable:', path); return; }
    const atlas = path.split('/').pop()!;
    for (const frame of manifest.frames) {
      if (frame.atlas !== atlas) continue;
      replaceSpriteArt(frame.name, frame.w, frame.h, (ctx) => {
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(image, frame.x, frame.y, frame.w, frame.h, 0, 0, frame.w, frame.h);
      });
    }
  }));
}
