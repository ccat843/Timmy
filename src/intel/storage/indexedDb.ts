import type { CaseRecord, EvidenceItem } from '@/intel/models';

const DB_NAME = 'timmy_intel_db';
const DB_VERSION = 1;
const CASES_STORE = 'cases';
const EVIDENCE_STORE = 'evidence';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(CASES_STORE)) {
        db.createObjectStore(CASES_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(EVIDENCE_STORE)) {
        const evidenceStore = db.createObjectStore(EVIDENCE_STORE, { keyPath: 'id' });
        evidenceStore.createIndex('caseId', 'caseId', { unique: false });
        evidenceStore.createIndex('createdAt', 'createdAt', { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Failed to open intel database'));
  });

  return dbPromise;
}

function txComplete(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

function makeId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export async function listCases(): Promise<CaseRecord[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CASES_STORE, 'readonly');
    const req = tx.objectStore(CASES_STORE).getAll();
    req.onsuccess = () => {
      const rows = (req.result as CaseRecord[])
        .slice()
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      resolve(rows);
    };
    req.onerror = () => reject(req.error ?? new Error('Failed to list cases'));
  });
}

export async function createCase(input: Pick<CaseRecord, 'title' | 'description' | 'tags'>): Promise<CaseRecord> {
  const db = await openDb();
  const now = new Date().toISOString();
  const record: CaseRecord = {
    id: makeId('case'),
    title: input.title.trim(),
    description: input.description?.trim() || undefined,
    tags: input.tags,
    createdAt: now,
    updatedAt: now,
  };

  const tx = db.transaction(CASES_STORE, 'readwrite');
  tx.objectStore(CASES_STORE).put(record);
  await txComplete(tx);
  return record;
}

export async function updateCase(input: CaseRecord): Promise<CaseRecord> {
  const db = await openDb();
  const updated: CaseRecord = {
    ...input,
    title: input.title.trim(),
    description: input.description?.trim() || undefined,
    updatedAt: new Date().toISOString(),
  };

  const tx = db.transaction(CASES_STORE, 'readwrite');
  tx.objectStore(CASES_STORE).put(updated);
  await txComplete(tx);
  return updated;
}

export async function deleteCase(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction([CASES_STORE, EVIDENCE_STORE], 'readwrite');
  tx.objectStore(CASES_STORE).delete(id);

  const evidenceStore = tx.objectStore(EVIDENCE_STORE);
  const index = evidenceStore.index('caseId');
  const range = IDBKeyRange.only(id);
  const cursorReq = index.openCursor(range);
  cursorReq.onsuccess = () => {
    const cursor = cursorReq.result;
    if (!cursor) return;
    evidenceStore.delete(cursor.primaryKey);
    cursor.continue();
  };

  await txComplete(tx);
}

export async function listEvidence(caseId: string): Promise<EvidenceItem[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(EVIDENCE_STORE, 'readonly');
    const req = tx.objectStore(EVIDENCE_STORE).index('caseId').getAll(IDBKeyRange.only(caseId));
    req.onsuccess = () => {
      const rows = (req.result as EvidenceItem[])
        .slice()
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      resolve(rows);
    };
    req.onerror = () => reject(req.error ?? new Error('Failed to list evidence'));
  });
}

export async function addEvidence(item: Omit<EvidenceItem, 'id' | 'createdAt'>): Promise<EvidenceItem> {
  const db = await openDb();
  const record: EvidenceItem = {
    ...item,
    id: makeId('evd'),
    createdAt: new Date().toISOString(),
  };

  const tx = db.transaction(EVIDENCE_STORE, 'readwrite');
  tx.objectStore(EVIDENCE_STORE).put(record);
  await txComplete(tx);

  const casesTx = db.transaction(CASES_STORE, 'readwrite');
  const caseReq = casesTx.objectStore(CASES_STORE).get(record.caseId);
  caseReq.onsuccess = () => {
    const caseRecord = caseReq.result as CaseRecord | undefined;
    if (!caseRecord) return;
    casesTx.objectStore(CASES_STORE).put({ ...caseRecord, updatedAt: new Date().toISOString() });
  };
  await txComplete(casesTx);

  return record;
}

export async function deleteEvidence(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(EVIDENCE_STORE, 'readwrite');
  tx.objectStore(EVIDENCE_STORE).delete(id);
  await txComplete(tx);
}

export async function updateEvidenceNotes(id: string, notes: string): Promise<EvidenceItem | null> {
  const db = await openDb();
  const tx = db.transaction(EVIDENCE_STORE, 'readwrite');
  const store = tx.objectStore(EVIDENCE_STORE);
  const req = store.get(id);

  const updated = await new Promise<EvidenceItem | null>((resolve, reject) => {
    req.onsuccess = () => {
      const existing = req.result as EvidenceItem | undefined;
      if (!existing) {
        resolve(null);
        return;
      }
      const next: EvidenceItem = { ...existing, notes };
      store.put(next);
      resolve(next);
    };
    req.onerror = () => reject(req.error ?? new Error('Failed to fetch evidence'));
  });

  await txComplete(tx);
  return updated;
}

export async function searchEvidence(caseId: string, query: string): Promise<EvidenceItem[]> {
  const all = await listEvidence(caseId);
  const q = query.trim().toLowerCase();
  if (!q) return all;

  return all.filter((item) => {
    const haystacks = [item.title, item.summary ?? '', item.notes ?? '', item.url ?? '', (item.entities ?? []).join(' ')];
    return haystacks.some((h) => h.toLowerCase().includes(q));
  });
}
