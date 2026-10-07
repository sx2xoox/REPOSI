# HUD lanterns — PixelLab art

**Done 2026-10-07** (see HANDOVER.md and `src/assets/pixellab/hud/provenance.json`). Kept as the record of the
brief; regenerate with the same rules if the lanterns are redone.

User request (2026-10-07): health becomes a lantern like the ember gauge. Make **two lanterns with
PixelLab** that look like a natural pair: the **health lantern** where the ember lantern used to be,
and the **release (ember) lantern** to its left. Soul hearts and shields are overlaid on health inside
the health lantern: each fills from the bottom of the glass on the same scale, and the layer spent first
is drawn in front (shield → soul → red), so the one behind shows as the front one drains.

## Already done in code (commit after a48fd5e)
- `src/ui/hud-gear.ts`: procedural placeholder frames for both lanterns, `drawLantern` (release) and
  `drawHealthLantern` (red / soul / ward overlaid from the bottom, flame on the highest level, heart lines,
  capacity notch).
  `setLanternArt(kind, canvas, glass)` swaps in generated frames.
- `src/ui/pixellab-hud.ts`: loads `src/assets/pixellab/hud/lantern_release.png`,
  `lantern_health.png` and `layout.json` at boot (wired in `src/main.ts`). Without files the
  procedural frames stay. The actor-art glob excludes `hud/`.
- `src/ui/hud.ts`: release lantern at x=8, health lantern at x=48, both standing on y=74 (UI units,
  2 UI per art px); readout "3.5/4 · +1 · 방패 n" right of the health lantern.

## Connection (requires the user)
This cloud environment blocks `api.pixellab.ai` by default. The user adds it under the
environment's Network access → Allowed domains and stores the key as env var
`PIXELLAB_API_KEY` (never in chat / repo), then starts a new session. Call the MCP endpoint
`https://api.pixellab.ai/mcp` over HTTP (JSON-RPC: `initialize`, `tools/list`, `tools/call`)
with `Authorization: Bearer $PIXELLAB_API_KEY`; list the tools first and use the image-generation
tool that supports a transparent background and an explicit canvas size.

## What to generate
- Two frames, same family: aged brass + dark iron, ring handle, stepped cap, four-post cage around
  a glass window, stepped base. Top-left light, 1 px dark outline (#0c0810), chunky readable
  pixels matching the existing UI (gold/brass `#e0a848`, highlights `#ffe09a`, shadows `#7a4e1c`).
- **Release lantern**: native ~18×28 px (current placeholder size), ember/amber accent (small
  amber gem or flame motif on the cap).
- **Health lantern**: native ~22×35 px, slightly larger, a small red heart-gem on the cap.
- **The glass window must be transparent** (the game paints ember / life layers there, then the
  frame on top). If PixelLab fills the glass, clear the window pixels (keep the vertical cage bars)
  when importing — do not repaint the frame by hand.
- Generate at native size (no resampling). Several candidates; pick by viewing in-game at native
  scale and enlarged next to the minimap / item art.

## Files to add
- `src/assets/pixellab/hud/lantern_release.png`, `lantern_health.png`
- `src/assets/pixellab/hud/layout.json`:
  `{ "lantern_release": { "glass": [x, y, w, h] }, "lantern_health": { "glass": [x, y, w, h] } }`
  (glass window in art px; the cage bars are part of the art).
- `src/assets/pixellab/hud/provenance.json`: prompts, tool, job ids, chosen candidate (like the
  other `provenance.json` files).

## Check
- Screenshots: full ember / empty / cooldown; health full, damaged, low (1 half), with soul and
  2 wards, after soul pickup (scale eases); desktop 1280×720 and phone 844×390 touch.
- `npx tsc --noEmit`, `npm test`, `node scripts/smoke.mjs`; look at every PNG.
