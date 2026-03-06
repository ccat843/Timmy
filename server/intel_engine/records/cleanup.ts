import type { DatabaseSync } from 'node:sqlite';

export const DEFAULT_RETENTION_DAYS = Number(process.env.DEFAULT_RETENTION_DAYS ?? process.env.RECORD_RETENTION_DAYS ?? '30');
export const MAX_DB_SIZE_MB = Number(process.env.MAX_DB_SIZE_MB ?? '5000');

export function runRecordsCleanup(db: DatabaseSync): { removed: number } {
  const now = Date.now();
  const retentionMs = Math.max(1, DEFAULT_RETENTION_DAYS) * 24 * 60 * 60 * 1000;
  const threshold = now - retentionMs;

  let removed = 0;
  const before = Number((db.prepare('SELECT COUNT(1) AS c FROM records').get() as { c: number }).c ?? 0);

  db.prepare('DELETE FROM records WHERE timestamp < ?').run(threshold);

  const maxBytes = Math.max(1, MAX_DB_SIZE_MB) * 1024 * 1024;
  if (maxBytes > 0) {
    let pageCount = Number((db.prepare('PRAGMA page_count').get() as { page_count: number }).page_count ?? 0);
    const pageSize = Number((db.prepare('PRAGMA page_size').get() as { page_size: number }).page_size ?? 4096);

    while ((pageCount * pageSize) > maxBytes) {
      db.exec(`DELETE FROM records WHERE id IN (SELECT id FROM records ORDER BY timestamp ASC LIMIT 1000)`);
      pageCount = Number((db.prepare('PRAGMA page_count').get() as { page_count: number }).page_count ?? 0);
      const remaining = Number((db.prepare('SELECT COUNT(1) AS c FROM records').get() as { c: number }).c ?? 0);
      if (remaining === 0) break;
    }
  }

  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  db.exec('VACUUM');

  const after = Number((db.prepare('SELECT COUNT(1) AS c FROM records').get() as { c: number }).c ?? 0);
  removed = Math.max(0, before - after);
  return { removed };
}
