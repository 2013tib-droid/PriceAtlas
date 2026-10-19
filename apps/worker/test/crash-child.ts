// Dijalankan sebagai proses terpisah oleh concurrency.test.ts: klaim satu capture
// lalu mati mendadak (tanpa fail_run), meniru worker yang crash setelah claim.
import { LocalBlobStore } from '../src/adapters/local-blob-store.ts';
import { createPool } from '../src/db.ts';
import { FixtureRegistry, StubAiMatcher, StubExtractor } from '../src/extractors/stub.ts';
import { processNextCapture } from '../src/pipeline/process-capture.ts';
import { FIXTURES_DIR } from './helpers.ts';

const db = createPool(process.env.CRASH_DB_URL!, { role: 'service_role' });
const fixtures = new FixtureRegistry(FIXTURES_DIR);
await processNextCapture({
  db,
  blob: new LocalBlobStore(process.env.CRASH_BLOB_DIR!, db),
  extractor: new StubExtractor(fixtures),
  ai: new StubAiMatcher(fixtures),
  workerId: 'crash-child',
  hooks: {
    afterClaim: (claim) => {
      process.stdout.write(`CLAIMED ${claim.capture_id}\n`);
      process.exit(1);
    },
  },
});
