// Rewrites `fixtures/fixture-block.v1.json` from `block.ts`:
//   cd client && npx vite-node tests/fixture-block/regen-block.ts
// `block-current.test.ts` fails CI when the committed file differs.

import { writeFileSync } from "node:fs";
import { BLOCK_FIXTURE_PATH, blockDocument } from "./block-document";

writeFileSync(BLOCK_FIXTURE_PATH, blockDocument(), "utf-8");
console.log(`wrote ${BLOCK_FIXTURE_PATH}`);
