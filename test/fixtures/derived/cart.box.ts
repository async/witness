import { box } from '@async/witness';

// Anonymous boxes derive their names at discovery time: the default export
// takes the file basename ('cart'), a named export appends its export name.
export default box(async () => {});

export const full = box(async () => {});
