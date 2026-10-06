/** Reviewed source-frame offsets, in native pixels. Never resample the artwork. */
const HORIZONTAL_OFFSETS: Readonly<Record<string, number>> = { bern: -1, serin: -1 };

export function actorFramePlacement(key: string, width: number, height: number, bottom: number) {
  const actor = key.split('/')[0];
  const dx = HORIZONTAL_OFFSETS[actor] ?? 0;
  // Symmetric transparent margins keep the existing bottom-centre origin and
  // prevent a corrected edge pixel from being clipped off its source canvas.
  const margin = Math.abs(dx) + (dx ? 1 : 0);
  return { width: width + margin * 2, height, x: margin + dx, y: height - 1 - bottom };
}
