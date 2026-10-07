import { defineDrawnSprite } from '../../engine/sprites';
import type { PassiveDef, DashDef } from '../../game/defs';
import { Enemy } from '../../game/enemy';
import type { World } from '../../game/world';
import type { Player } from '../../game/player';
import { runProc } from '../../game/procs';
import { proc } from '../items/lib';
import { RefugeRelease } from './refuge-release';
import { releaseOpen } from './kit-common';
import { aimPoint, directContribution, REFUGE_COLORS, supportFamily, refugeVisualOpacity } from './refuge-common';
import { RefugeCharge, RefugeWeave, RefugeSupport, RefugeGuard, RefugeSeal, RefugeFootwork } from './refuge-devices';
export { REFUGE_COLORS } from './refuge-common';
export { RefugeCharge, RefugeWeave, RefugeSupport, RefugeGuard, RefugeSeal } from './refuge-devices';

const ids = ['tove', 'luen', 'ves', 'ort', 'mira'];
for (let i = 0; i < ids.length; i++) for (const type of ['passive', 'dash']) {
  defineDrawnSprite(`icon_${ids[i]}_${type}`, 16, 16, p => {
    const c = REFUGE_COLORS[i];
    p.rect(2, 2, 12, 12, '#343044'); p.rectOutline(2, 2, 12, 12, c);
    if (i === 0) {
      p.rect(5, 6, 6, 6, '#ad754f'); p.rect(7, 5, 2, 8, '#f6d498');
      p.line(9, 6, 11, 3, '#e4bb77'); p.px(12, 3, '#fff4d8');
    } else if (i === 1) {
      p.line(4, 5, 11, 11, c); p.line(11, 5, 4, 11, c);
      p.ring(8, 8, 3, 1, '#f4dfef'); p.px(4, 4, '#ffffff'); p.px(11, 11, '#ffffff');
    } else if (i === 2) {
      p.line(4, 4, 11, 11, '#fae0c9'); p.line(11, 4, 4, 11, c);
      p.line(3, 10, 6, 13, '#ad789b'); p.line(10, 10, 13, 7, '#ad789b');
    } else if (i === 3) {
      p.poly([4, 4, 8, 3, 12, 4, 11, 10, 8, 13, 5, 10], '#436c60');
      p.line(5, 5, 8, 4, '#d9eed0'); p.line(8, 4, 11, 5, c); p.line(8, 4, 8, 11, c);
    } else {
      p.poly([3, 5, 7, 4, 8, 6, 9, 4, 13, 5, 12, 11, 9, 10, 8, 12, 7, 10, 4, 11], '#e8dfc9');
      p.line(8, 6, 8, 11, '#7183aa'); p.line(5, 7, 6, 7, '#7183aa'); p.line(10, 7, 11, 7, '#7183aa');
    }
    if (type === 'dash') { p.line(1, 12, 4, 12, '#ffffff'); p.line(1, 14, 6, 14, c); }
  }, { outline: '#0c0810' });
}
defineDrawnSprite('refuge_road_rune', 11, 11, p => {
  p.poly([5, 0, 10, 5, 5, 10, 0, 5], '#29483f'); p.line(2, 5, 5, 2, '#91c6a3');
  p.line(5, 2, 8, 5, '#e6e2b8'); p.line(8, 5, 5, 8, '#629c83'); p.px(5, 5, '#fff0c3');
}, { origin: [5, 5] });
defineDrawnSprite('refuge_record_page', 9, 11, p => {
  p.rect(1, 1, 7, 9, '#ece0bb'); p.line(2, 2, 6, 2, '#fff4d2');
  p.line(3, 4, 6, 4, '#787a9e'); p.line(3, 6, 6, 6, '#787a9e'); p.line(3, 8, 5, 8, '#787a9e');
}, { outline: '#272239', origin: [4, 5] });

function weave(w: World, p: Player): RefugeWeave {
  const effect = w.entityById(p.vars.rfLuenWeave);
  if (effect instanceof RefugeWeave && effect.owner === p && effect.valid(w)) return effect;
  const next = w.spawn(new RefugeWeave(w, p)); p.vars.rfLuenWeave = next.id;
  return next;
}
function guard(w: World, p: Player): RefugeGuard {
  const effect = w.entityById(p.vars.rfOrtGuard);
  if (effect instanceof RefugeGuard && effect.owner === p && effect.valid(w)) return effect;
  const next = w.spawn(new RefugeGuard(w, p)); p.vars.rfOrtGuard = next.id;
  return next;
}
function placeSeal(w: World, p: Player, x: number, y: number): void {
  const effect = w.entityById(p.vars.rfMiraSeal);
  if (effect instanceof RefugeSeal && effect.owner === p && effect.valid(w)) effect.place(w, x, y);
  else { const next = w.spawn(new RefugeSeal(w, p, x, y)); p.vars.rfMiraSeal = next.id; }
  proc(w, 'passive:mira', true);
}
function flushWeave(w: World): void {
  const p = w.player;
  if (!(p.vars.rfLuenPool > 0)) return;
  const target = w.entityById(p.vars.rfLuenTarget);
  if (!(target instanceof Enemy)) { p.vars.rfLuenPool = 0; return; }
  runProc(w, 'keeper:luen:record', () => {
    weave(w, p).record(w, target, p.vars.rfLuenPool);
    p.vars.rfLuenPool = 0;
    return true;
  });
}

export const REFUGE_PASSIVES: PassiveDef[] = [
  {
    name: '시한 폭약', icon: 'icon_tove_passive',
    summary: '적중 시 0.9초마다 시한 폭약 부착. 0.68초 뒤 주변에 폭발한다.',
    desc: '직접 공격으로 0.9초마다 시한 폭약을 붙인다. 0.68초 뒤 주변에 폭발하며, 모은 직접 피해 일부가 위력에 더해진다.',
    onHit(w, target, hit) {
      const contribution = directContribution(w, hit);
      if (!(target instanceof Enemy) || contribution <= 0) return;
      const p = w.player;
      p.vars.rfToveEnergy = Math.min(p.stats.damage * 1.5, (p.vars.rfToveEnergy ?? 0) + contribution * .28);
      runProc(w, 'keeper:tove:charge', () => {
        const damage = Math.max(p.stats.damage * .45, p.vars.rfToveEnergy);
        p.vars.rfToveEnergy = 0;
        w.spawn(new RefugeCharge(w, p, target.x, target.y, damage, target.id));
        proc(w, 'passive:tove', true);
        return true;
      }, .9);
    },
    onRoomEnter(w) { w.vars.rfToveEnergy = 0; },
  },
  {
    name: '서로 잇는 실', icon: 'icon_luen_passive',
    summary: '최대 3명을 연결해 직접 피해의 28%를 전달. 혼자면 매듭으로 돌려준다.',
    desc: '적중한 적 주변 최대 3명을 잇는다. 직접 피해 28%를 모아 0.5초마다 전달(기본 피해 2배까지). 다른 연결 대상이 없으면 매듭 피해를 준다.',
    onHit(w, target, hit) {
      const contribution = directContribution(w, hit);
      if (!(target instanceof Enemy) || contribution <= 0) return;
      const p = w.player;
      p.vars.rfLuenPool = Math.min(p.stats.damage * 8, (p.vars.rfLuenPool ?? 0) + contribution);
      p.vars.rfLuenTarget = target.id;
      flushWeave(w);
    },
    onUpdate(w) { if (w.player.alive && !w.player.downed && !w.transitioning) flushWeave(w); },
    draw(w, r) {
      const p = w.player;
      if (!p.vars.rfLuenRetie || !p.alive || p.downed) return;
      const x = p.x - 8, y = p.y - 16, alpha = refugeVisualOpacity(w, p);
      r.pixelLine(x - 3, y, x, y - 3, '#e4ceee', 1, alpha * .85);
      r.pixelLine(x, y - 3, x + 3, y, '#bba3e5', 1, alpha * .85);
      r.pixelLine(x + 3, y, x, y + 3, '#bba3e5', 1, alpha * .85);
      r.pixelLine(x, y + 3, x - 3, y, '#e4ceee', 1, alpha * .85);
      r.rect(x, y - 1, 1, 2, '#fff0df', alpha);
    },
    onRoomEnter(w) { w.vars.rfLuenWeave = 0; w.vars.rfLuenRetie = 0; w.vars.rfLuenPool = 0; w.vars.rfLuenTarget = 0; },
  },
  {
    name: '양손 호흡', icon: 'icon_ves_passive',
    summary: '적중 시 1.2초마다 보조무기 계열 기술. 보조무기가 없으면 단검.',
    desc: '직접 적중 시 1.2초마다 보조무기 계열 지원 기술을 쓴다. 근접은 교차 베기, 사격은 관통, 폭발은 착탄, 광선은 집중 공격. 보조무기가 없으면 단검.',
    onHit(w, target, hit) {
      const contribution = directContribution(w, hit);
      if (!(target instanceof Enemy) || contribution <= 0) return;
      const p = w.player;
      p.vars.rfVesPool = Math.min(p.stats.damage * 1.5, (p.vars.rfVesPool ?? 0) + contribution * .3);
      if (w.time < (p.vars.rfVesNext ?? -1)) return;
      runProc(w, 'keeper:ves:support', () => {
        const damage = Math.max(p.stats.damage * .7, p.vars.rfVesPool);
        p.vars.rfVesPool = 0;
        p.vars.rfVesLast = w.time;
        p.vars.rfVesNext = w.time + 1.2;
        w.spawn(new RefugeSupport(w, p, supportFamily(p.weapon2Id), target, damage));
        proc(w, 'passive:ves', true);
        return true;
      });
    },
    onRoomEnter(w) { w.vars.rfVesPool = 0; w.vars.rfVesNext = 0; w.vars.rfVesLast = -99; },
  },
  {
    name: '전방 방벽', icon: 'icon_ort_passive',
    summary: '전방 일반 적탄 2발 차단. 2.4초마다 내구 1 회복, 차단 간격 0.2초.',
    desc: '조준 방향의 방패가 일반 적탄을 2발 막는다. 2.4초마다 내구 1 회복, 차단 간격 0.2초. 접촉·장판·광선은 막지 못한다.',
    onUpdate(w) { if (w.player.alive && !w.player.downed && !w.transitioning) guard(w, w.player); },
    onRoomEnter(w) { w.vars.rfOrtGuard = 0; },
  },
  {
    name: '머무는 인장', icon: 'icon_mira_passive',
    summary: '적중 지점에 감속·피해 결계. 2.8초 지속, 설치 간격 1.6초, 최대 1개.',
    desc: '직접 적중 지점에 2.8초 결계를 펼친다. 적의 이동과 일반 적탄을 30% 늦추고 약하게 타격한다. 보스 이동은 12% 감속. 설치 간격 1.6초, 최대 1개.',
    onHit(w, target, hit) {
      if (!(target instanceof Enemy) || directContribution(w, hit) <= 0) return;
      runProc(w, 'keeper:mira:place', () => { placeSeal(w, w.player, target.x, target.y); return true; }, 1.6);
    },
    onRoomEnter(w) { w.vars.rfMiraSeal = 0; },
  },
];

export const REFUGE_DASHES: DashDef[] = [
  {
    name: '철수 지뢰', desc: '떠난 자리에 3.2초 지뢰를 남긴다. 다가온 적에게 폭발하며 최대 2개까지 유지된다.',
    summary: '떠난 자리에 3.2초 지뢰. 적이 다가오면 폭발하며 최대 2개 유지.',
    icon: 'icon_tove_dash', color: REFUGE_COLORS[0],
    start(w, p) {
      runProc(w, 'keeper:tove:mine', () => {
        const mines = w.entities.filter(e => e instanceof RefugeCharge && e.owner === p && !e.dead && e.mem.mine && !e.mem.fired);
        if (mines.length >= 2) mines[0].dead = true;
        w.spawn(new RefugeCharge(w, p, p.x, p.y, p.stats.damage * 1.1, 0, true));
        return true;
      });
    },
  },
  {
    name: '새 실걸음', desc: '다음 직접 적중을 중심으로 실을 옮기고 기본 피해 40%의 매듭을 더한다. 한 번만 준비되며 무기 교체나 공격 중단이 필요 없다.',
    summary: '다음 직접 적중으로 실을 옮기고 기본 피해 40%의 매듭 추가. 1회 준비.',
    icon: 'icon_luen_dash', color: REFUGE_COLORS[1],
    start(w, p) { runProc(w, 'keeper:luen:retie', () => { p.vars.rfLuenRetie = 1; w.spawn(new RefugeFootwork(w, p, 1)); return true; }); },
  },
  {
    name: '교차 발걸음', desc: '대시하면 다음 지원 기술이 0.5초 빨리 준비된다. 지원 기술 간격은 최소 0.2초.',
    summary: '다음 지원 기술을 0.5초 앞당긴다. 지원 기술 간격은 최소 0.2초.',
    icon: 'icon_ves_dash', color: REFUGE_COLORS[2], iframes: .09,
    start(w, p) {
      runProc(w, 'keeper:ves:advance', () => {
        p.vars.rfVesNext = Math.max((p.vars.rfVesLast ?? -99) + .2, (p.vars.rfVesNext ?? w.time) - .5);
        w.spawn(new RefugeFootwork(w, p, 2));
        return true;
      });
    },
  },
  {
    name: '방패 맡기기', desc: '방패를 1.1초 동안 그 자리에 남겨 사선을 막고 비켜선다. 내구를 공유하며 시간이 지나면 다시 따라온다.',
    summary: '방패를 1.1초 남겨 사선을 막는다. 내구를 공유하며 시간이 지나면 회수.',
    icon: 'icon_ort_dash', color: REFUGE_COLORS[3],
    start(w, p) { runProc(w, 'keeper:ort:park', () => { guard(w, p).park(w); return true; }); },
  },
  {
    name: '책장 넘기기', desc: '대시 도착점 앞으로 결계를 옮겨 새로 펼친다. 활성 결계가 없어도 생성된다.',
    summary: '대시 도착점 앞에 결계를 새로 펼친다. 기존 결계가 있으면 옮긴다.',
    icon: 'icon_mira_dash', color: REFUGE_COLORS[4],
    end(w, p) { runProc(w, 'keeper:mira:dash', () => { const q = aimPoint(w, p, 70, 38); placeSeal(w, p, q.x, q.y); return true; }); },
  },
];

export const REFUGE_RELEASES = ids.map((id, mode) => (w: World, p: Player): void => {
  runProc(w, 'keeper:' + id + ':release', () => {
    releaseOpen(w, p, REFUGE_COLORS[mode], 48, 'focus');
    w.spawn(new RefugeRelease(p, mode, w));
    return true;
  });
});
