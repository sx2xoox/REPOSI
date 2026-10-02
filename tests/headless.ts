// Minimal browser stand-ins so the real World / Renderer run (and draw) under
// node: canvases whose 2D context accepts every call and draws nothing, a
// `document` that creates them, and a `window` with the bits the renderer
// reads. Import this FIRST in a test file (before any game module).

type Ctx = Record<string | symbol, unknown>;

const noop = (): void => undefined;

function imageData(w: number | { width: number; height: number }, h?: number): { data: Uint8ClampedArray; width: number; height: number } {
  const width = typeof w === 'number' ? Math.max(1, Math.floor(w)) : w.width;
  const height = typeof w === 'number' ? Math.max(1, Math.floor(h ?? 1)) : w.height;
  return { data: new Uint8ClampedArray(width * height * 4), width, height };
}

const gradient = { addColorStop: noop };

function fakeContext(canvas: FakeCanvas): Ctx {
  const state: Ctx = {
    canvas,
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    fillStyle: '#000000',
    strokeStyle: '#000000',
    lineWidth: 1,
    font: '10px sans-serif',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    imageSmoothingEnabled: false,
    filter: 'none',
    shadowBlur: 0,
    shadowColor: 'transparent',
    lineCap: 'butt',
    lineJoin: 'miter',
  };
  const special: Ctx = {
    getImageData: (_x: number, _y: number, w: number, h: number) => imageData(w, h),
    createImageData: (w: number | { width: number; height: number }, h?: number) => imageData(w, h),
    measureText: (s: string) => ({ width: String(s).length * 6, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2, actualBoundingBoxLeft: 0, actualBoundingBoxRight: String(s).length * 6 }),
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
    createConicGradient: () => gradient,
    createPattern: () => ({ setTransform: noop }),
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
    isPointInPath: () => false,
    getLineDash: () => [],
  };
  return new Proxy(state, {
    get(t, k) {
      if (k in special) return special[k as string];
      if (k in t) return t[k];
      return noop;
    },
    set(t, k, v) {
      t[k] = v;
      return true;
    },
  });
}

class FakeCanvas {
  width = 300;
  height = 150;
  style: Record<string, string> = {};
  private ctx: Ctx | null = null;
  /** CSS size reported by getBoundingClientRect (drives the renderer's view width) */
  static cssW = 1280;
  static cssH = 720;
  getContext(): Ctx {
    return (this.ctx ??= fakeContext(this));
  }
  getBoundingClientRect(): { left: number; top: number; width: number; height: number } {
    return { left: 0, top: 0, width: FakeCanvas.cssW, height: FakeCanvas.cssH };
  }
  toDataURL(): string {
    return '';
  }
  addEventListener(): void {}
  removeEventListener(): void {}
}

const g = globalThis as unknown as Record<string, unknown>;
if (typeof g.ImageData === 'undefined') {
  g.ImageData = class {
    data: Uint8ClampedArray;
    width: number;
    height: number;
    constructor(a: Uint8ClampedArray | number, b: number, c?: number) {
      if (typeof a === 'number') {
        this.width = a;
        this.height = b;
        this.data = new Uint8ClampedArray(a * b * 4);
      } else {
        this.data = a;
        this.width = b;
        this.height = c ?? a.length / 4 / b;
      }
    }
  };
}
if (typeof g.document === 'undefined') {
  g.document = {
    createElement: () => new FakeCanvas(),
    body: null,
    fonts: undefined,
    addEventListener: noop,
  };
}
if (typeof g.window === 'undefined') {
  g.window = {
    devicePixelRatio: 1,
    __lkSafeOverride: { l: 0, r: 0, t: 0, b: 0 },
    addEventListener: noop,
    removeEventListener: noop,
  };
}

/** A canvas for `new Renderer(...)`; `cssW` x `cssH` CSS px sets the adaptive view width. */
export function fakeDisplay(cssW = 1280, cssH = 720): HTMLCanvasElement {
  FakeCanvas.cssW = cssW;
  FakeCanvas.cssH = cssH;
  return new FakeCanvas() as unknown as HTMLCanvasElement;
}

/** Change the CSS size the fake display reports (call `renderer.resize()` after). */
export function setDisplaySize(cssW: number, cssH: number): void {
  FakeCanvas.cssW = cssW;
  FakeCanvas.cssH = cssH;
}
