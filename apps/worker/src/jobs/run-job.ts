// Job worker dari app.job (docs/05 §1.4, §7.4–§7.6): purge_images, redact_ocr,
// delete_household, purge_storage_paths. Setiap langkah idempoten.
import type { Db } from '../db.ts';
import { log } from '../log.ts';
import type { BlobStore } from '../pipeline/types.ts';
import { piiStrings, redactJson, redactText } from './redact.ts';

export const WORKER_JOB_KINDS = ['purge_images', 'redact_ocr', 'delete_household', 'purge_storage_paths'] as const;

interface JobRow {
  id: string;
  kind: (typeof WORKER_JOB_KINDS)[number];
  payload: Record<string, unknown>;
  attempts: number;
  created_at: Date;
}

export interface JobDeps {
  db: Db;
  blob: BlobStore;
  leaseSeconds?: number;
}

/** Batas tunggu household tanpa anggota (§7.6 langkah 1). */
const DELETE_WAIT_MS = 24 * 3600 * 1000;

export async function runNextJob(deps: JobDeps): Promise<{ id: string; kind: string; outcome: string } | null> {
  const { db } = deps;
  const r = await db.query<JobRow>('select * from app.claim_job($1, $2)', [WORKER_JOB_KINDS, deps.leaseSeconds ?? 300]);
  const job = r.rows[0];
  if (!job) return null;
  const started = Date.now();
  let outcome: string;
  try {
    outcome = await handle(deps, job);
  } catch (e) {
    outcome = job.attempts >= 5 ? 'failed' : 'retry';
    const msg = e instanceof Error ? e.message : String(e);
    if (outcome === 'failed') await db.query('select app.fail_job($1, $2)', [job.id, msg]);
    else await db.query('select app.requeue_job($1, $2, $3)', [job.id, 60 * job.attempts, msg]);
  }
  log('job.done', { job: job.id, kind: job.kind, outcome, ms: Date.now() - started });
  return { id: job.id, kind: job.kind, outcome };
}

async function handle(deps: JobDeps, job: JobRow): Promise<string> {
  const { db, blob } = deps;
  switch (job.kind) {
    case 'purge_images': {
      // Hapus file dulu, baru tandai (§7.5). Diulang → file yang sudah tidak ada tidak error.
      const ids = (job.payload.image_ids as string[] | undefined) ?? [];
      const rows = await db.query<{ id: string; storage_path: string }>('select * from app.images_to_purge($1)', [ids]);
      await blob.delete(rows.rows.map((x) => x.storage_path));
      await db.query('select app.mark_images_purged($1)', [rows.rows.map((x) => x.id)]);
      await db.query('select app.complete_job($1)', [job.id]);
      return `purged:${rows.rowCount}`;
    }
    case 'purge_storage_paths': {
      await blob.delete((job.payload.paths as string[] | undefined) ?? []);
      await db.query('select app.complete_job($1)', [job.id]);
      return 'done';
    }
    case 'redact_ocr': {
      const ids = (job.payload.run_ids as string[] | undefined) ?? [];
      const rows = await db.query<{ run_id: string; raw_ocr_text: string | null; raw_ai_output: unknown; pii: unknown }>(
        'select * from app.runs_to_redact($1)',
        [ids],
      );
      for (const row of rows.rows) {
        const pii = piiStrings(row.pii);
        await db.query('select app.apply_redaction($1, $2, $3)', [
          row.run_id,
          row.raw_ocr_text == null ? null : redactText(row.raw_ocr_text, pii),
          row.raw_ai_output == null ? null : JSON.stringify(redactJson(row.raw_ai_output, pii)),
        ]);
      }
      await db.query('select app.complete_job($1)', [job.id]);
      return `redacted:${rows.rowCount}`;
    }
    case 'delete_household': {
      const hh = job.payload.household_id as string;
      const st = await db.query<{ s: string }>('select app.prepare_household_deletion($1) as s', [hh]);
      const state = st.rows[0]?.s;
      if (state === 'gone') {
        await db.query('select app.complete_job($1)', [job.id]);
        return 'gone';
      }
      if (state === 'has_members') {
        // Langkah 3 (hapus user) belum berhasil: tunggu dengan backoff, maksimal 24 jam.
        if (Date.now() - new Date(job.created_at).getTime() > DELETE_WAIT_MS) {
          await db.query('select app.fail_job($1, $2)', [job.id, 'household masih punya anggota setelah 24 jam']);
          return 'failed';
        }
        await db.query('select app.requeue_job($1, $2, $3)', [job.id, 300, 'menunggu user dihapus']);
        return 'waiting';
      }
      const paths = await blob.list(`${hh}/`);
      await blob.delete(paths);
      await db.query('select app.finish_household_deletion($1)', [hh]);
      await db.query('select app.complete_job($1)', [job.id]);
      return `deleted:${paths.length}`;
    }
  }
}

/** Sapuan unggahan yatim (§5.2): objek tanpa capture_image, lebih tua dari TTL. */
export async function sweepOrphans(deps: JobDeps): Promise<number> {
  const r = await deps.db.query<{ name: string }>('select name from app.orphan_storage_objects(500)');
  await deps.blob.delete(r.rows.map((x) => x.name));
  if (r.rowCount) log('orphans.swept', { count: r.rowCount });
  return r.rowCount ?? 0;
}
