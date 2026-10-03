import type { StoryEvent } from './story';

/** Presentation only; callers commit story flags after the final confirmation. */
export class DialoguePlayback {
  index = 0;
  revealed = 0;
  finished = false;
  private elapsed = 0;
  constructor(readonly event: StoryEvent) {}
  get line() { return this.event.lines[this.index]; }
  get length(): number { return Array.from(this.line?.text ?? '').length; }
  get complete(): boolean { return this.revealed >= this.length; }
  update(dt: number): void {
    if (this.finished || this.complete) return;
    this.elapsed += dt * 34;
    this.revealed = Math.min(this.length, Math.floor(this.elapsed));
  }
  advance(): 'reveal' | 'line' | 'end' | 'none' {
    if (this.finished) return 'none';
    if (!this.complete) { this.revealed = this.length; return 'reveal'; }
    if (this.index + 1 >= this.event.lines.length) { this.finished = true; return 'end'; }
    this.index++; this.elapsed = 0; this.revealed = 0; return 'line';
  }
}
