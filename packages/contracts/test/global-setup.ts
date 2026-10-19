import { buildTestDb } from '@priceatlas/testkit';

// Database uji untuk test kesetaraan TS ↔ SQL (unitPrice, kontrak extra, kode error).
export default function setup(): void {
  process.env.CONTRACTS_DB_URL = buildTestDb('priceatlas_l2_contracts');
}
