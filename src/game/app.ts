// Application singleton: renderer, scene manager, settings application.
// Scenes/UI import `app` to switch scenes and start runs.

import { Renderer } from '../engine/renderer';
import { SceneManager } from '../ui/scene';
import { audio } from '../audio/audio';
import { save } from '../engine/save';

export class App {
  renderer!: Renderer;
  scenes!: SceneManager;
  fps = 60;
  /** factories registered by the UI layer to avoid import cycles */
  factories: {
    title?: () => import('../ui/scene').Scene;
    game?: (seed: string, character: string, seeded: boolean) => import('../ui/scene').Scene;
    characterSelect?: () => import('../ui/scene').Scene;
    /** online co-op run (net/session.ts startNetRun) */
    coop?: (session: import('../net/session').NetSession, start: import('../net/lobby').StartInfo) => import('../ui/scene').Scene;
  } = {};

  init(canvas: HTMLCanvasElement): void {
    this.renderer = new Renderer(canvas);
    this.scenes = new SceneManager(this.renderer);
    this.applySettings();
  }

  applySettings(): void {
    const s = save.settings;
    audio.volume.master = s.masterVolume;
    audio.volume.music = s.musicVolume;
    audio.volume.sfx = s.sfxVolume;
    audio.applyVolumes();
    if (this.renderer) {
      this.renderer.shakeIntensity = s.screenShake;
      this.renderer.flashIntensity = s.screenFlash ?? 1;
      this.renderer.pixelPerfect = s.pixelPerfect;
      this.renderer.resize();
    }
  }

  goTitle(): void {
    if (this.factories.title) this.scenes.set(this.factories.title());
  }

  goCharacterSelect(): void {
    if (this.factories.characterSelect) this.scenes.set(this.factories.characterSelect());
  }

  startRun(seed: string, character: string, seeded = false): void {
    if (this.factories.game) this.scenes.set(this.factories.game(seed, character, seeded));
  }
}

export const app = new App();
