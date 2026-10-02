// Gameplay scene: owns the World and the HUD, and opens overlays
// (pause, status (Tab), full map (M), game over / victory).

import type { Scene } from './scene';
import type { Renderer } from '../engine/renderer';
import { World, type GameOverInfo, type WorldHost } from '../game/world';
import { RunState } from '../game/run';
import { app } from '../game/app';
import { input } from '../engine/input';
import { Hud } from './hud';
import { PauseOverlay } from './pause';
import { StatusOverlay } from './status';
import { MapOverlay } from './map-overlay';
import { GameOverOverlay } from './gameover';
import { audio } from '../audio/audio';
import { save } from '../engine/save';
import { applyGraphics } from './quality';
import { BlessingOverlay } from './blessing';
import { applyBlessing, autoBlessEnabled, blessingChoices, blessingDue, markBlessed } from '../game/blessings';

export class GameScene implements Scene, WorldHost {
  world: World;
  run: RunState;
  hud = new Hud();
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
    applyGraphics(this.world);
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
    if (this.overlayOpen) app.scenes.remove(this.overlayOpen);
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
    this.hud.update(w, dt);
    if (!this.overlayOpen && blessingDue(w)) this.offerBlessing();
  }

  /** "등불의 축복": pick one of three blessings at the start of each floor. */
  private offerBlessing(): void {
    const w = this.world;
    const choices = blessingChoices(w);
    markBlessed(w);
    if (!choices.length) return;
    if (autoBlessEnabled()) applyBlessing(w, choices[0]);
    else this.openOverlay(new BlessingOverlay(this, choices));
  }

  draw(r: Renderer): void {
    this.world.draw();
    r.presentWorld();
    this.hud.draw(r, this.world, app.fps);
  }
}
