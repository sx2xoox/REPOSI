// Generated (PixelLab) frames for the two HUD lanterns. Drop
// `src/assets/pixellab/hud/lantern_release.png` / `lantern_health.png` (native
// pixels, transparent background AND transparent glass window) together with
// `layout.json` — `{ "lantern_release": { "glass": [x, y, w, h] }, ... }`, the
// glass window in art pixels — and the HUD paints the ember / life layers in
// that window under the frame. Without them the procedural frames stay.

import { setLanternArt, type LanternKind } from './hud-gear';

const urls = import.meta.glob('../assets/pixellab/hud/*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const layouts = import.meta.glob('../assets/pixellab/hud/layout.json', { eager: true, import: 'default' }) as Record<string, Record<string, { glass: [number, number, number, number] }>>;

export async function loadPixelLabHud(): Promise<void> {
  if (typeof Image === 'undefined') return;
  const layout = Object.values(layouts)[0] ?? {};
  await Promise.all(Object.entries(urls).map(async ([path, url]) => {
    const id = path.split('/').pop()!.replace('.png', '');
    const kind: LanternKind | null = id === 'lantern_release' ? 'release' : id === 'lantern_health' ? 'health' : null;
    const glass = layout[id]?.glass;
    if (!kind || !glass) return;
    const image = new Image();
    image.src = url;
    try {
      await image.decode();
    } catch {
      console.warn('HUD lantern art unavailable:', path);
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(image, 0, 0);
    setLanternArt(kind, canvas, { x: glass[0], y: glass[1], w: glass[2], h: glass[3] });
  }));
}
