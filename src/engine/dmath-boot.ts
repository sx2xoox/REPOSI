// Side-effect module: installs the deterministic Math functions (engine/dmath.ts)
// before any other game module is evaluated. Import it FIRST in the entry point,
// so even module-level tables computed with Math.sin / Math.pow at load time are
// bit-identical on every browser (lockstep multiplayer; single-player too).
import { installDeterministicMath } from './dmath';

installDeterministicMath();
