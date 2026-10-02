// Entry point: load fonts & content, start the fixed-timestep loop.

import './style.css';
import { app } from './game/app';
import { input } from './engine/input';
import { audio } from './audio/audio';
import { warmAllSprites } from './engine/sprites';
import { FIXED_DT } from './game/constants';
import { loadContent } from './content';
import { TitleScene, CharacterSelectScene } from './ui/title';
import { GameScene } from './ui/game-scene';
import { installDebug } from './debug';
import { touch } from './ui/touch';
import { applyGraphics } from './ui/quality';

async function boot(): Promise<void> {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  loadContent();
  app.init(canvas);
  input.attach(canvas);
  touch.attach(canvas);
  applyGraphics();
  app.factories.title = () => new TitleScene();
  app.factories.characterSelect = () => new CharacterSelectScene();
  app.factories.game = (seed, ch, seeded) => new GameScene(seed, ch, seeded);

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

  let last = performance.now();
  let acc = 0;
  let fpsAcc = 0;
  let fpsFrames = 0;
  const frame = (now: number) => {
    let delta = (now - last) / 1000;
    last = now;
    if (delta > 0.25) delta = 0.25; // tab was hidden
    acc += delta;
    fpsAcc += delta;
    fpsFrames++;
    if (fpsAcc >= 0.5) {
      app.fps = fpsFrames / fpsAcc;
      fpsAcc = 0;
      fpsFrames = 0;
    }
    touch.frame();
    let steps = 0;
    while (acc >= FIXED_DT && steps < 5) {
      input.update();
      app.scenes.update(FIXED_DT);
      acc -= FIXED_DT;
      steps++;
    }
    if (steps >= 5) acc = 0;
    app.scenes.draw();
    touch.draw(app.renderer);
    input.endFrame();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

// offline play: register the service worker in production web builds only
// (not in dev, and not in the single-file build which has no sw.js)
if (import.meta.env.PROD && import.meta.env.MODE !== 'single' && 'serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('service worker registration failed', e));
  });
}

boot().catch((e) => {
  console.error(e);
  const el = document.getElementById('boot');
  if (el) el.textContent = `오류: ${e?.message ?? e}`;
});
