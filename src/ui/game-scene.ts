// Gameplay scene: owns the World, draws HUD, and opens overlays
// (pause, collection/status, full map, game over).

import type { Scene } from './scene';
import type { Renderer } from '../engine/renderer';
import { World, type GameOverInfo, type WorldHost } from '../game/world';
import { RunState } from '../game/run';
import { app } from '../game/app';
import { input } from '../engine/input';
import { drawHud } from './hud';
import { PauseOverlay } from './pause';
import { StatusOverlay } from './status';
import { MapOverlay } from './map-overlay';
import { GameOverOverlay } from './gameover';
import { audio } from '../audio/audio';
import { save } from '../engine/save';

export class GameScene implements Scene, WorldHost {
  world: World;
  run: RunState;
  private overlayOpen: Scene | null = null;

  constructor(seed: string, character: string, seeded: boolean) {
    this.run = new RunState(seed, character);
    this.run.seeded = seeded;
    this.world = new World(app.renderer, this.run, this);
  }

  enter(): void {
    save.progress.runs++;
    save.saveProgress();
    this.world.start();
    (window as unknown as { __world?: World }).__world = this.world;
  }

  exit(): void {
    audio.stopMusic(0.5);
  }

  openOverlay(s: Scene): void {
    this.overlayOpen = s;
    this.world.paused = true;
    input.releaseAll();
    app.scenes.push(s);
  }

  /** Called by overlays when they close. */
  closeOverlay(s: Scene): void {
    app.scenes.remove(s);
    if (this.overlayOpen === s) this.overlayOpen = null;
    if (!this.world.gameOver) this.world.paused = false;
    input.releaseAll();
  }

  // WorldHost
  openInventory(): void {
    if (!this.overlayOpen) this.openOverlay(new StatusOverlay(this));
  }

  onGameOver(info: GameOverInfo): void {
    const p = save.progress;
    if (info.won) {
      p.wins++;
      if (!p.bestTimeSec || this.run.stats.timeSec < p.bestTimeSec) p.bestTimeSec = Math.round(this.run.stats.timeSec);
    } else p.deaths++;
    save.saveProgress();
    save.addRun({
      date: new Date().toISOString(), character: this.run.characterId, seed: this.run.seed, floor: this.run.floor,
      won: info.won, timeSec: Math.round(this.run.stats.timeSec), kills: this.run.stats.kills, killedBy: info.won ? undefined : info.source,
    });
    if (!info.won) audio.playMusic('gameover');
    this.overlayOpen = null;
    this.world.paused = true;
    app.scenes.push(new GameOverOverlay(this, info));
  }

  update(dt: number): void {
    const w = this.world;
    if (!w.gameOver && !w.transitioning) {
      if (input.pressed('pause')) {
        this.openOverlay(new PauseOverlay(this));
        return;
      }
      if (input.pressed('inventory')) {
        this.openOverlay(new StatusOverlay(this));
        return;
      }
      if (input.pressed('map')) {
        this.openOverlay(new MapOverlay(this));
        return;
      }
    }
    w.update(dt);
  }

  draw(r: Renderer): void {
    this.world.draw();
    r.presentWorld();
    drawHud(r, this.world, app.fps);
  }
}
