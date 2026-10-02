// Auto-imports every content module under src/content/** so each file only
// has to call define*() — no central list to edit (avoids merge conflicts).

const modules = import.meta.glob(['./**/*.ts', '!./index.ts'], { eager: true });

let loaded = false;
export function loadContent(): number {
  if (loaded) return Object.keys(modules).length;
  loaded = true;
  return Object.keys(modules).length;
}
