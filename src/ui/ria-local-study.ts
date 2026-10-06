import design from '../assets/local-studies/ria-16x20.json';

// Explicitly approved hand-authored local study. Production retains PixelLab Ria.
export function installRiaLocalStudy(art: Map<string, HTMLCanvasElement>): void {
  const palette: Record<string, string> = design.palette;
  const directions = ['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east'];
  function render(direction: string, frame?: number): HTMLCanvasElement {
    const side = direction.includes('east') || direction.includes('west');
    const rows = (side ? design.side : direction === 'north' ? design.back : design.front).map(row => [...row]);
    if (frame === 1 || frame === 3) {
      const columns = side ? (frame === 1 ? [4, 5] : [8, 9]) : (frame === 1 ? [4, 5, 6] : [9, 10, 11]);
      for (const x of columns) { rows[17][x] = rows[18][x]; rows[18][x] = rows[19][x]; rows[19][x] = '.'; }
    }
    const canvas = document.createElement('canvas'); canvas.width = 16; canvas.height = 20;
    const ctx = canvas.getContext('2d')!;
    rows.forEach((row, y) => row.forEach((pixel, x) => {
      if (palette[pixel]) { ctx.fillStyle = palette[pixel]; ctx.fillRect(direction.includes('west') ? 15 - x : x, y, 1, 1); }
    }));
    return canvas;
  }
  for (const direction of directions) art.set(`ria/${direction}`, render(direction));
  for (const direction of ['east', 'west', 'north', 'south'])
    for (let frame = 0; frame < 4; frame++) art.set(`ria/walk-${direction}-${frame}`, render(direction, frame));
}
