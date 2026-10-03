// Gameplay scene: owns the World and the HUD, and opens overlays
// (pause, status (Tab), full map (M), game over / victory).
//
// Online co-op (`coop` given): the World holds every roster keeper and a
// NetRun (net/netrun.ts) steps it in lockstep. Then nothing local stops or
// changes the simulation: overlays (pause, Tab, map, blessing) open on top of
// a world that keeps running (`alwaysUpdate`), this peer's keeper idles while
// one is open, and decisions (blessing, discard, the host ending the run or
// taking the party back to the lobby) go out as lockstep commands.

import type { Scene } from './scene';
import type { Renderer } from '../engine/renderer';
import { UI_H, UI_W } from '../engine/renderer';
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
import type { NetSession } from '../net/session';
import type { StartInfo } from '../net/lobby';
import { NetRun } from '../net/netrun';
import { emptyInput, fixedRules, readLocalInput } from '../game/seam';
import { CoopSummaryOverlay, NetNoticeOverlay, drawWaiting } from './coop';
import { LobbyScene } from './lobby';
import type { CoopCommand } from '../game/coop';

/** What the lobby hands to a co-op game scene. */
export interface CoopStart {
  session: NetSession;
  start: StartInfo;
}

export class GameScene implements Scene, WorldHost {
  world: World;
  run: RunState;
  hud = new Hud();
  /** online co-op: the lockstep driver (null in single-player) */
  net: NetRun | null = null;
  /** co-op: keep stepping the world under overlays */
  alwaysUpdate = false;
  private overlayOpen: Scene | null = null;
  private readonly coop: CoopStart | null;
  private readonly sample = emptyInput();
  /** co-op: floor whose blessing this peer already offered */
  private blessFloor = 0;
  private notice: Scene | null = null;
  /** co-op: time the client has been waiting for the host (s) */
  private waitT = 0;

  constructor(seed: string, character: string, seeded: boolean, coop: CoopStart | null = null) {
    this.coop = coop;
    if (coop) {
      const me = coop.start.roster.find((p) => p.slot === coop.session.localSlot);
      character = me?.characterId ?? coop.start.roster[0]?.characterId ?? character;
      seed = coop.start.seed;
      seeded = false;
    }
    this.run = new RunState(seed, character);
    this.run.seeded = seeded;
    this.world = new World(app.renderer, this.run, this);
  }

  enter(): void {
    save.progress.runs++;
    save.saveProgress();
    const c = this.coop;
    if (c) {
      const w = this.world;
      // the host's simulation options, fixed for the whole run on every peer
      w.rules = fixedRules(c.start.rules ?? {});
      w.startParty(c.start.roster.map((p) => ({ slot: p.slot, characterId: p.characterId, name: p.name })), c.session.localSlot);
      this.net = new NetRun(c.session, c.start, w);
      this.alwaysUpdate = true;
    } else this.world.start();
    (window as unknown as { __world?: World }).__world = this.world;
    applyGraphics(this.world);
  }

  exit(): void {
    audio.stopMusic(0.5);
    if (this.net) {
      this.net.dispose();
      if (!this.net.session.closed) this.net.session.close();
    }
  }

  /** Online co-op run? */
  get online(): boolean {
    return !!this.net;
  }

  openOverlay(s: Scene): void {
    this.overlayOpen = s;
    // co-op: the world keeps running under menus
    if (!this.net) this.world.paused = true;
    input.releaseAll();
    app.scenes.push(s);
  }

  /** Called by overlays when they close. */
  closeOverlay(s: Scene): void {
    app.scenes.remove(s);
    if (this.overlayOpen === s) this.overlayOpen = null;
    if (!this.net && !this.world.gameOver) this.world.paused = false;
    input.releaseAll();
  }

  /** Co-op: queue a lockstep command (no-op in single-player). */
  command(cmd: CoopCommand): void {
    this.net?.sendCommand(cmd);
  }

  /** The keeper chose a blessing (`id: null` = none). Single-player: applied now; co-op: a command. */
  chooseBlessing(id: string | null, floor = this.world.run.floor): void {
    if (this.net) {
      this.net.sendCommand({ type: 'bless', floor, id });
      return;
    }
    if (id) applyBlessing(this.world, id);
    else markBlessed(this.world);
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
    if (this.net) {
      // co-op: the party summary (the lockstep keeps running for the host's choice)
      this.overlayOpen = new CoopSummaryOverlay(this, info);
      app.scenes.push(this.overlayOpen);
      return;
    }
    this.world.paused = true;
    app.scenes.push(new GameOverOverlay(this, info));
  }

  update(dt: number): void {
    if (this.net) {
      this.updateNet(dt);
      return;
    }
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

  /** Co-op step: local input → lockstep → 0..2 world steps; menus never stop it. */
  private updateNet(dt: number): void {
    const net = this.net!;
    const w = this.world;
    if (net.state === 'lobby') {
      this.backToLobby();
      return;
    }
    if ((net.state === 'desync' || net.state === 'ended') && !this.notice) {
      this.notice = new NetNoticeOverlay(this, net.state === 'desync' ? 'desync' : net.endReason ?? 'host-lost');
      if (this.overlayOpen) app.scenes.remove(this.overlayOpen);
      this.overlayOpen = this.notice;
      app.scenes.push(this.notice);
      return;
    }
    const free = !this.overlayOpen && net.state === 'running';
    if (free && !w.gameOver && !w.transitioning) {
      if (input.pressed('pause')) this.openOverlay(new PauseOverlay(this));
      else if (input.pressed('inventory')) this.openOverlay(new StatusOverlay(this));
      else if (input.pressed('map')) this.openOverlay(new MapOverlay(this));
    }
    // this peer's keeper: local devices (incl. touch auto-aim), idle while a menu is up
    let sample = null;
    if (!this.overlayOpen && !w.gameOver) {
      readLocalInput(w, w.local, this.sample);
      sample = this.sample;
    }
    net.step(sample);
    this.waitT = net.waiting ? this.waitT + dt : 0;
    this.hud.update(w, dt);
    if (!this.overlayOpen && !w.gameOver && net.state === 'running' && blessingDue(w) && this.blessFloor !== w.run.floor) this.offerBlessing();
  }

  /** "등불의 축복": pick one of three blessings at the start of each floor. */
  private offerBlessing(): void {
    const w = this.world;
    const choices = blessingChoices(w);
    const floor = w.run.floor;
    if (this.net) {
      // co-op: the choice goes out as a command; nothing changes locally until it comes back
      this.blessFloor = floor;
      if (!choices.length) this.chooseBlessing(null, floor);
      else if (autoBlessEnabled()) this.chooseBlessing(choices[0], floor);
      else this.openOverlay(new BlessingOverlay(this, choices));
      return;
    }
    markBlessed(w);
    if (!choices.length) return;
    if (autoBlessEnabled()) applyBlessing(w, choices[0]);
    else this.openOverlay(new BlessingOverlay(this, choices));
  }

  /** Co-op: the host took everyone back to the lobby — same room, same connections. */
  private backToLobby(): void {
    const net = this.net!;
    net.dispose();
    const transport = net.session.detach();
    app.scenes.set(new LobbyScene({ resume: transport }));
  }

  /** Co-op: leave the session and go to the title (pause menu "방 나가기", notices). */
  leaveOnline(to: 'title' | 'lobby' = 'title'): void {
    const net = this.net;
    if (net && !net.session.closed) net.session.close();
    if (to === 'lobby') app.scenes.set(new LobbyScene());
    else app.goTitle();
  }

  draw(r: Renderer): void {
    this.world.draw();
    r.presentWorld();
    this.hud.draw(r, this.world, app.fps);
    if (this.net && this.waitT > 0) drawWaiting(r, this.waitT, UI_W, UI_H);
  }
}
