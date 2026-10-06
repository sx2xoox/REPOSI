import { describe, expect, it, vi } from 'vitest';
import { isContentTemporarilyLocked } from '../src/game/release-policy';
describe('reviewed roster production access',()=>{
 it('removes only the five keeper quarantine locks in production',()=>{
  vi.stubEnv('PROD',true);
  try{for(const id of ['tove','luen','ves','ort','mira'])expect(isContentTemporarilyLocked(id),id).toBe(false);
   expect(isContentTemporarilyLocked('brass_revolver')).toBe(true);expect(isContentTemporarilyLocked('moon_fan')).toBe(true);
  }finally{vi.unstubAllEnvs();}
 });
});
