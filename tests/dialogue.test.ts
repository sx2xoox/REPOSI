import { expect, it } from 'vitest';
import { DialoguePlayback } from '../src/game/dialogue';

it('reveals before advancing and reports completion only once', () => {
  const p = new DialoguePlayback({ title: '귀환', lines: [{ who: '루메', text: '돌아왔구나.' }, { who: '브릭', text: '등불을 보자.' }] });
  p.update(.04); expect(p.revealed).toBe(1);
  expect(p.advance()).toBe('reveal'); expect(p.index).toBe(0); expect(p.finished).toBe(false);
  expect(p.advance()).toBe('line'); expect(p.index).toBe(1); expect(p.revealed).toBe(0);
  expect(p.advance()).toBe('reveal'); expect(p.finished).toBe(false);
  expect(p.advance()).toBe('end'); expect(p.finished).toBe(true);
  expect(p.advance()).toBe('none');
});

it('finishes Unicode reveal without advancing the story', () => {
  const p = new DialoguePlayback({ title: '', lines: [{ who: '기록', text: '불빛 🕯' }] });
  p.update(60); expect(p.revealed).toBe(4); expect(p.complete).toBe(true); expect(p.finished).toBe(false);
  expect(p.advance()).toBe('end');
});
