// Vitest setup (every test file): run the game code with the deterministic
// transcendental Math functions installed, exactly like the game does at boot
// (see engine/dmath.ts and main.ts).
import { installDeterministicMath } from '../src/engine/dmath';

installDeterministicMath();
