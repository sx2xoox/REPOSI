import { defineGlobalHooks } from '../../game/defs';
import { SYNERGIES, synergyActive } from '../../game/synergies';
import { amplify, isPrimary } from './lib';

defineGlobalHooks({
  id: 'mixed_resonance',
  onDash(w) {
    const counts = w.items.computed?.tagCounts ?? {};
    if (synergyActive(counts, SYNERGIES[2].tags)) w.vars.__eclipseUntil = w.time + w.player.stats.dashTime + 1;
  },
  modifyHit(w, target, hit) {
    if (!isPrimary(hit)) return;
    const counts = w.items.computed?.tagCounts ?? {};
    const triggers = [
      target.hasStatus('burn') && (target.hasStatus('slow') || target.hasStatus('freeze')),
      target.hasStatus('poison') && target.hasStatus('bleed'),
      !!hit.crit && (w.vars.__eclipseUntil ?? 0) > w.time,
    ];
    SYNERGIES.forEach((s, i) => {
      if (!triggers[i] || !synergyActive(counts, s.tags)) return;
      amplify(hit, i === 2 ? 0.1 : 0.12);
      // Reuse the two family HUD indicators, which already rate-limit feedback.
      for (const tag of s.tags) w.items.proc(`set:${tag}`, true);
    });
  },
});
