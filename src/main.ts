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

async function boot(): Promise<void> {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  loadContent();
  app.init(canvas);
  input.attach(canvas);
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

  window.addEventListener('resize', () => app.renderer.resize());
  const unlock = () => audio.unlock();
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
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
    let steps = 0;
    while (acc >= FIXED_DT && steps < 5) {
      input.update();
      app.scenes.update(FIXED_DT);
      acc -= FIXED_DT;
      steps++;
    }
    if (steps >= 5) acc = 0;
    app.scenes.draw();
    input.endFrame();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

boot().catch((e) => {
  console.error(e);
  const el = document.getElementById('boot');
  if (el) el.textContent = `오류: ${e?.message ?? e}`;
});
