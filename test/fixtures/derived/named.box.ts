import { box } from 'gumbox';

// An explicit name always wins over derivation, and the options form works
// without a name when only metadata is needed.
export default box('explicit name wins', async () => {});

export const tagged = box({ tags: ['derived'] }, async () => {});
