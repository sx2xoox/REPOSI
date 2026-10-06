// Entry point: load fonts & content, start the fixed-timestep loop.

// first: deterministic Math.sin/pow/... for every mode (must precede all game modules)
import './engine/dmath-boot';
import './style.css';
import { installOrientationPrompt } from './ui/orientation';
import { app } from './game/app';
import { input } from './engine/input';
import { audio } from './audio/audio';
import { warmAllSprites } from './engine/sprites';
import { FIXED_DT } from './game/constants';
import { FramePacer } from './engine/pacing';
import { loadContent } from './content';
import { TitleScene, CharacterSelectScene } from './ui/title';
import { GameScene } from './ui/game-scene';
import { TownScene } from './ui/town';
import { installDebug } from './debug';
import { touch } from './ui/touch';
import { applyGraphics } from './ui/quality';
import { installServiceWorker } from './net/build';
import { perfmon } from './engine/perfmon';
import { effectiveMaxFps, save } from './engine/save';
import { loadPixelLabArt } from './ui/pixellab-art';
import { loadPixelLabWeapons } from './ui/pixellab-weapons';
import { loadPixelLabScenery } from './ui/pixellab-scenery';
import { loadPixelLabBosses } from './ui/pixellab-bosses';

async function boot(): Promise<void> {
  installOrientationPrompt();
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  loadContent();
  app.init(canvas);
  input.attach(canvas);
  touch.attach(canvas);
  applyGraphics();
  app.factories.title = () => new TitleScene();
  app.factories.town = () => new TownScene();
  app.factories.characterSelect = () => new CharacterSelectScene();
  app.factories.game = (seed, ch, seeded) => new GameScene(seed, ch, seeded);
  app.factories.coop = (session, start) => new GameScene(start.seed, '', false, { session, start });

  try {
    await Promise.race([
      Promise.all([
        document.fonts.load("12px 'Galmuri11'"),
        document.fonts.load("bold 12px 'Galmuri11'"),
        document.fonts.load("10px 'Galmuri9'"),
      ]),
      new Promise((r) => setTimeout(r, 2500)),
    ]);
  } catch {
    // fonts are optional
  }
  await Promise.all([loadPixelLabArt(), loadPixelLabWeapons(), loadPixelLabScenery(), loadPixelLabBosses()]);
  warmAllSprites();

  // resize / rotation (mobile browsers report the new size a little late)
  const resize = () => app.renderer.resize();
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => {
    resize();
    setTimeout(resize, 120);
    setTimeout(resize, 500);
  });
  window.visualViewport?.addEventListener('resize', resize);
  // audio: unlock on the first gesture; iOS only accepts touchend / pointerup,
  // and suspends ("interrupted") the context when the app goes to background
  const unlock = () => {
    audio.unlock();
    const ctx = audio.ctx;
    if (ctx && ctx.state !== 'running' && ctx.state !== 'closed') void ctx.resume().catch(() => undefined);
  };
  for (const ev of ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown']) window.addEventListener(ev, unlock, { passive: true });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') unlock();
  });
  // no long-press menus / text selection / drag ghosts anywhere
  for (const ev of ['contextmenu', 'selectstart', 'dragstart']) {
    document.addEventListener(ev, (e) => {
      if (!(e.target instanceof HTMLInputElement)) e.preventDefault();
    });
  }
  canvas.focus();

  installDebug();
  app.goTitle();
  const bootEl = document.getElementById('boot');
  if (bootEl) {
    bootEl.style.opacity = '0';
    setTimeout(() => bootEl.remove(), 450);
  }

  // fixed 60 Hz simulation steps (exactly FIXED_DT each, whatever the display
  // rate); frames are drawn at the display rate up to the 최대 프레임 cap with the
  // world interpolated between the last two steps (see engine/pacing.ts)
  const pacer = new FramePacer(FIXED_DT);
  pacer.reset(performance.now());
  let fpsT = performance.now();
  let fpsFrames = 0;
  let lastDrawAt = -1;
  (window as unknown as { __lkPerf: typeof perfmon }).__lkPerf = perfmon;
  (window as unknown as { __lkApp: typeof app }).__lkApp = app;
  const r = app.renderer;
  const frame = (now: number): void => {
    pacer.maxFps = effectiveMaxFps(save.settings);
    touch.frame();
    const steps = pacer.tick(now);
    const t0 = perfmon.on ? performance.now() : 0;
    for (let i = 0; i < steps; i++) {
      input.update();
      r.simStep++;
      app.scenes.update(FIXED_DT);
    }
    const t1 = perfmon.on ? performance.now() : 0;
    if (pacer.draw) {
      r.alpha = pacer.alpha;
      app.scenes.draw();
      touch.draw(r);
      r.alpha = 1;
      fpsFrames++;
      if (perfmon.on) {
        const t2 = performance.now();
        if (perfmon.flush) r.dctx.getImageData(0, 0, 1, 1);
        const t3 = perfmon.flush ? performance.now() : t2;
        perfmon.record(lastDrawAt < 0 ? 0 : now - lastDrawAt, t1 - t0, t2 - t1, t3 - t2, steps);
      }
      lastDrawAt = now;
    } else if (perfmon.on && steps > 0) perfmon.addUpdate(t1 - t0, steps);
    if (now - fpsT >= 500) {
      app.fps = (fpsFrames * 1000) / (now - fpsT);
      fpsT = now;
      fpsFrames = 0;
    }
    input.endFrame();
  };
  // `__lkLoop.manual = true` stops the rAF driver so tools can run frames at
  // synthetic timestamps (`__lkLoop.frame(ms)`), e.g. a 120 Hz display in tests
  const loop = { manual: false, frame, pacer };
  (window as unknown as { __lkLoop: typeof loop }).__lkLoop = loop;
  const raf = (now: number) => {
    if (!loop.manual) frame(now);
    requestAnimationFrame(raf);
  };
  requestAnimationFrame(raf);
}

// offline play: register the service worker in production web builds only
// (not in dev, and not in the single-file build which has no sw.js); a newer
// deploy reloads the page while the player is on the title screen
if (import.meta.env.PROD && import.meta.env.MODE !== 'single' && 'serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
  installServiceWorker(() => app.scenes?.top instanceof TitleScene);
}

boot().catch((e) => {
  console.error(e);
  const el = document.getElementById('boot');
  if (el) el.textContent = `오류: ${e?.message ?? e}`;
});
