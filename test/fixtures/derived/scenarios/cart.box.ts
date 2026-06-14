import { box } from '@async/witness';

// Same basename as the root-level cart.box.ts: the derived name collides, so
// discovery upgrades the colliding names to relative-path bases.
export default box(async () => {});
