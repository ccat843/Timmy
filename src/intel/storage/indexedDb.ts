import type { AlertEvent, AlertRule, CaseRecord, Entity, EvidenceEntityEdge, EvidenceItem } from '@/intel/models';
import { extractEntitiesFromEvidence } from '@/intel/entities/extractor';
import { doesRuleMatch } from '@/intel/alerts/matcher';

const DB_NAME = 'timmy_intel_db';
const DB_VERSION = 3;
const CASES_STORE = 'cases';
const EVIDENCE_STORE = 'evidence';
const ENTITIES_STORE = 'entities';
const EDGES_STORE = 'edges';
const ALERT_RULES_STORE = 'alert_rules';
const ALERT_EVENTS_STORE = 'alert_events';

type AlertEventRecord = AlertEvent & { fingerprint?: string };

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(CASES_STORE)) db.createObjectStore(CASES_STORE, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(EVIDENCE_STORE)) {
        const evidenceStore = db.createObjectStore(EVIDENCE_STORE, { keyPath: 'id' });
        evidenceStore.createIndex('caseId', 'caseId', { unique: false });
        evidenceStore.createIndex('createdAt', 'createdAt', { unique: false });
      }
      if (!db.objectStoreNames.contains(ENTITIES_STORE)) {
        const entityStore = db.createObjectStore(ENTITIES_STORE, { keyPath: 'id' });
        entityStore.createIndex('caseId', 'caseId', { unique: false });
        entityStore.createIndex('caseId_normalizedLabel', ['caseId', 'normalizedLabel'], { unique: true });
      }
      if (!db.objectStoreNames.contains(EDGES_STORE)) {
        const edgeStore = db.createObjectStore(EDGES_STORE, { keyPath: 'id' });
        edgeStore.createIndex('caseId', 'caseId', { unique: false });
        edgeStore.createIndex('caseId_evidenceId', ['caseId', 'evidenceId'], { unique: false });
      }
      if (!db.objectStoreNames.contains(ALERT_RULES_STORE)) {
        const rules = db.createObjectStore(ALERT_RULES_STORE, { keyPath: 'id' });
        rules.createIndex('enabled', 'enabled', { unique: false });
      }
      if (!db.objectStoreNames.contains(ALERT_EVENTS_STORE)) {
        const events = db.createObjectStore(ALERT_EVENTS_STORE, { keyPath: 'id' });
        events.createIndex('createdAt', 'createdAt', { unique: false });
        events.createIndex('ruleId', 'ruleId', { unique: false });
        events.createIndex('status', 'status', { unique: false });
        events.createIndex('ruleId_fingerprint', ['ruleId', 'fingerprint'], { unique: false });
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

function normalizeLabel(label: string): string {
  return label.trim().replace(/\s+/g, ' ').toLowerCase();
}

function normalizeArray(input?: string[]): string[] {
  return (input ?? []).map(v => normalizeLabel(v)).filter(Boolean);
}

export async function listCases(): Promise<CaseRecord[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(CASES_STORE, 'readonly').objectStore(CASES_STORE).getAll();
    req.onsuccess = () => resolve((req.result as CaseRecord[]).slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
    req.onerror = () => reject(req.error ?? new Error('Failed to list cases'));
  });
}

export async function createCase(input: Pick<CaseRecord, 'title' | 'description' | 'tags'>): Promise<CaseRecord> {
  const db = await openDb();
  const now = new Date().toISOString();
  const record: CaseRecord = { id: makeId('case'), title: input.title.trim(), description: input.description?.trim() || undefined, tags: input.tags, createdAt: now, updatedAt: now };
  const tx = db.transaction(CASES_STORE, 'readwrite');
  tx.objectStore(CASES_STORE).put(record);
  await txComplete(tx);
  return record;
}

export async function updateCase(input: CaseRecord): Promise<CaseRecord> {
  const db = await openDb();
  const updated: CaseRecord = { ...input, title: input.title.trim(), description: input.description?.trim() || undefined, updatedAt: new Date().toISOString() };
  const tx = db.transaction(CASES_STORE, 'readwrite');
  tx.objectStore(CASES_STORE).put(updated);
  await txComplete(tx);
  return updated;
}

export async function deleteCase(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction([CASES_STORE, EVIDENCE_STORE, ENTITIES_STORE, EDGES_STORE], 'readwrite');
  tx.objectStore(CASES_STORE).delete(id);

  for (const storeName of [EVIDENCE_STORE, ENTITIES_STORE, EDGES_STORE]) {
    const store = tx.objectStore(storeName);
    const index = store.index('caseId');
    const cursorReq = index.openCursor(IDBKeyRange.only(id));
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (!cursor) return;
      store.delete(cursor.primaryKey);
      cursor.continue();
    };
  }

  await txComplete(tx);
}

export async function listEvidence(caseId: string): Promise<EvidenceItem[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {    const req = db.transaction(EVIDENCE_STORE, 'readonly').objectStore(EVIDENCE_STORE).index('caseId').getAll(IDBKeyRange.only(caseId));
    req.onsuccess = () => resolve((req.result as EvidenceItem[]).slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    req.onerror = () => reject(req.error ?? new Error('Failed to list evidence'));
  });
}

export async function addEvidence(item: Omit<EvidenceItem, 'id' | 'createdAt'>): Promise<EvidenceItem> {
  const db = await openDb();
  const record: EvidenceItem = { ...item, id: makeId('evd'), createdAt: new Date().toISOString() };

  const tx = db.transaction(EVIDENCE_STORE, 'readwrite');
  tx.objectStore(EVIDENCE_STORE).put(record);
  await txComplete(tx);

  await touchCase(record.caseId);
  await extractAndUpsertEntitiesForEvidence(record);
  await applyRulesToItem({
    title: record.title,
    summary: record.summary,
    notes: record.notes,
    sourceId: record.sourceId,
    caseId: record.caseId,
    evidenceId: record.id,
    url: record.url,
  });
  return record;
}

export async function deleteEvidence(id: string): Promise<void> {
  const db = await openDb();
  const existing = await getEvidenceById(id);
  const tx = db.transaction([EVIDENCE_STORE, EDGES_STORE], 'readwrite');
  tx.objectStore(EVIDENCE_STORE).delete(id);
  if (existing) {
    const edgeCursor = tx.objectStore(EDGES_STORE).index('caseId_evidenceId').openCursor(IDBKeyRange.only([existing.caseId, existing.id]));
    edgeCursor.onsuccess = () => {
      const cursor = edgeCursor.result;
      if (!cursor) return;
      tx.objectStore(EDGES_STORE).delete(cursor.primaryKey);
      cursor.continue();
    };
  }
  await txComplete(tx);
  if (existing) await touchCase(existing.caseId);
}

export async function updateEvidenceNotes(id: string, notes: string): Promise<EvidenceItem | null> {
  const db = await openDb();
  const tx = db.transaction(EVIDENCE_STORE, 'readwrite');
  const store = tx.objectStore(EVIDENCE_STORE);
  const req = store.get(id);

  const updated = await new Promise<EvidenceItem | null>((resolve, reject) => {
    req.onsuccess = () => {
      const existing = req.result as EvidenceItem | undefined;
      if (!existing) return resolve(null);
      const next = { ...existing, notes };
      store.put(next);
      resolve(next);
    };
    req.onerror = () => reject(req.error ?? new Error('Failed to fetch evidence'));
  });

  await txComplete(tx);
  if (updated) {
    await touchCase(updated.caseId);
    await extractAndUpsertEntitiesForEvidence(updated);
    await applyRulesToItem({
      title: updated.title,
      summary: updated.summary,
      notes: updated.notes,
      sourceId: updated.sourceId,
      caseId: updated.caseId,
      evidenceId: updated.id,
      url: updated.url,
    });
  }
  return updated;
}

export async function searchEvidence(caseId: string, query: string): Promise<EvidenceItem[]> {
  const all = await listEvidence(caseId);
  const q = query.trim().toLowerCase();
  if (!q) return all;
  return all.filter((item) => [item.title, item.summary ?? '', item.notes ?? '', item.url ?? '', (item.entities ?? []).join(' ')].some((h) => h.toLowerCase().includes(q)));
}

export async function getEvidenceById(id: string): Promise<EvidenceItem | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(EVIDENCE_STORE, 'readonly').objectStore(EVIDENCE_STORE).get(id);
    req.onsuccess = () => resolve((req.result as EvidenceItem | undefined) ?? null);
    req.onerror = () => reject(req.error ?? new Error('Failed to load evidence'));
  });
}

export async function listEntities(caseId: string): Promise<Entity[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(ENTITIES_STORE, 'readonly').objectStore(ENTITIES_STORE).index('caseId').getAll(IDBKeyRange.only(caseId));
    req.onsuccess = () => resolve((req.result as Entity[]).slice().sort((a, b) => a.label.localeCompare(b.label)));
    req.onerror = () => reject(req.error ?? new Error('Failed to list entities'));
  });
}

export async function listEdges(caseId: string): Promise<EvidenceEntityEdge[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(EDGES_STORE, 'readonly').objectStore(EDGES_STORE).index('caseId').getAll(IDBKeyRange.only(caseId));
    req.onsuccess = () => resolve((req.result as Array<EvidenceEntityEdge & { id: string }>).map(({ id: _id, ...edge }) => edge));
    req.onerror = () => reject(req.error ?? new Error('Failed to list edges'));
  });
}

export async function extractAndUpsertEntitiesForEvidence(evidence: EvidenceItem): Promise<void> {
  const db = await openDb();
  const extracted = extractEntitiesFromEvidence(evidence);
  const existingEntities = await listEntities(evidence.caseId);
  const byNormalized = new Map<string, Entity>();
  for (const entity of existingEntities) byNormalized.set(normalizeLabel(entity.label), entity);

  const tx = db.transaction([ENTITIES_STORE, EDGES_STORE], 'readwrite');
  const entityStore = tx.objectStore(ENTITIES_STORE);
  const edgeStore = tx.objectStore(EDGES_STORE);

  const oldEdgesReq = edgeStore.index('caseId_evidenceId').openCursor(IDBKeyRange.only([evidence.caseId, evidence.id]));
  oldEdgesReq.onsuccess = () => {
    const cursor = oldEdgesReq.result;
    if (!cursor) return;
    edgeStore.delete(cursor.primaryKey);
    cursor.continue();
  };

  for (const item of extracted) {
    const normalized = normalizeLabel(item.label);
    const existing = byNormalized.get(normalized);
    const entityId = existing?.id ?? makeId('ent');

    if (!existing) {
      const newEntity: Entity = { id: entityId, caseId: evidence.caseId, label: item.label, type: item.type, createdAt: new Date().toISOString() };
      byNormalized.set(normalized, newEntity);
      entityStore.put({ ...newEntity, normalizedLabel: normalized });
    }

    edgeStore.put({ id: makeId('edge'), caseId: evidence.caseId, evidenceId: evidence.id, entityId });
  }

  await txComplete(tx);
}

export async function rebuildCaseEntities(caseId: string): Promise<void> {
  const db = await openDb();
  const clearTx = db.transaction([ENTITIES_STORE, EDGES_STORE], 'readwrite');
  for (const storeName of [ENTITIES_STORE, EDGES_STORE]) {
    const store = clearTx.objectStore(storeName);
    const cursorReq = store.index('caseId').openCursor(IDBKeyRange.only(caseId));
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (!cursor) return;
      store.delete(cursor.primaryKey);
      cursor.continue();
    };
  }
  await txComplete(clearTx);

  const evidence = await listEvidence(caseId);
  for (const item of evidence) await extractAndUpsertEntitiesForEvidence(item);
}

export async function listAlertRules(): Promise<AlertRule[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(ALERT_RULES_STORE, 'readonly').objectStore(ALERT_RULES_STORE).getAll();
    req.onsuccess = () => resolve((req.result as AlertRule[]).slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
    req.onerror = () => reject(req.error ?? new Error('Failed to list alert rules'));
  });
}

export async function upsertAlertRule(rule: Omit<AlertRule, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }): Promise<AlertRule> {
  const db = await openDb();
  const now = new Date().toISOString();
  const payload: AlertRule = {
    id: rule.id ?? makeId('rule'),
    name: rule.name.trim(),
    enabled: rule.enabled,
    createdAt: rule.id ? now : now,
    updatedAt: now,
    match: {
      keywords: normalizeArray(rule.match.keywords),
      keywordMode: rule.match.keywordMode ?? 'OR',
      entities: normalizeArray(rule.match.entities),
      tags: normalizeArray(rule.match.tags),
      sources: normalizeArray(rule.match.sources),
      caseId: rule.match.caseId,
    },
    severity: rule.severity,
    throttleMinutes: rule.throttleMinutes,
  };

  const existing = rule.id ? await getAlertRule(rule.id) : null;
  if (existing) payload.createdAt = existing.createdAt;

  const tx = db.transaction(ALERT_RULES_STORE, 'readwrite');
  tx.objectStore(ALERT_RULES_STORE).put(payload);
  await txComplete(tx);
  return payload;
}

export async function getAlertRule(id: string): Promise<AlertRule | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(ALERT_RULES_STORE, 'readonly').objectStore(ALERT_RULES_STORE).get(id);
    req.onsuccess = () => resolve((req.result as AlertRule | undefined) ?? null);
    req.onerror = () => reject(req.error ?? new Error('Failed to get rule'));
  });
}

export async function deleteAlertRule(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(ALERT_RULES_STORE, 'readwrite');
  tx.objectStore(ALERT_RULES_STORE).delete(id);
  await txComplete(tx);
}

export async function setRuleEnabled(id: string, enabled: boolean): Promise<void> {
  const rule = await getAlertRule(id);
  if (!rule) return;
  await upsertAlertRule({ ...rule, enabled, id: rule.id });
}

export async function addAlertEvent(event: Omit<AlertEvent, 'id' | 'createdAt' | 'status'> & { status?: AlertEvent['status']; fingerprint?: string }): Promise<AlertEvent> {
  const db = await openDb();
  const payload: AlertEventRecord = {
    id: makeId('alrtev'),
    createdAt: new Date().toISOString(),
    status: event.status ?? 'new',
    ...event,
  };
  const tx = db.transaction(ALERT_EVENTS_STORE, 'readwrite');
  tx.objectStore(ALERT_EVENTS_STORE).put(payload);
  await txComplete(tx);
  const { fingerprint: _fingerprint, ...clean } = payload;
  return clean;
}

export async function listAlertEvents(filters?: { status?: AlertEvent['status']; severity?: AlertEvent['severity']; ruleId?: string }): Promise<AlertEvent[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(ALERT_EVENTS_STORE, 'readonly').objectStore(ALERT_EVENTS_STORE).getAll();
    req.onsuccess = () => {
      let rows = (req.result as AlertEventRecord[]).slice();
      if (filters?.status) rows = rows.filter(r => r.status === filters.status);
      if (filters?.severity) rows = rows.filter(r => r.severity === filters.severity);
      if (filters?.ruleId) rows = rows.filter(r => r.ruleId === filters.ruleId);
      rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      resolve(rows.map(({ fingerprint: _f, ...event }) => event));
    };
    req.onerror = () => reject(req.error ?? new Error('Failed to list alert events'));
  });
}

export async function markAlertEventRead(id: string): Promise<void> {
  await updateAlertEventStatus(id, 'read');
}

export async function archiveAlertEvent(id: string): Promise<void> {
  await updateAlertEventStatus(id, 'archived');
}

export async function applyRulesToItem(item: {
  title: string;
  summary?: string;
  notes?: string;
  sourceId?: string;
  caseId?: string;
  evidenceId?: string;
  url?: string;
  tags?: string[];
}): Promise<AlertEvent[]> {
  const [rules, entities] = await Promise.all([
    listAlertRules(),
    item.caseId && item.evidenceId ? getEvidenceEntityLabels(item.caseId, item.evidenceId) : Promise.resolve<string[]>([]),
  ]);

  const normalizedEntities = normalizeArray(entities);
  const normalizedTags = normalizeArray(item.tags);
  const sourceId = normalizeLabel(item.sourceId ?? '');
  const created: AlertEvent[] = [];

  for (const rule of rules) {
    if (!doesRuleMatch(rule, {
      title: item.title,
      summary: item.summary,
      notes: item.notes,
      sourceId: sourceId,
      caseId: item.caseId,
      entities: normalizedEntities,
      tags: normalizedTags,
    })) continue;

    const fingerprint = normalizeLabel(`${item.url ?? item.evidenceId ?? item.title}:${item.title}`);
    const deduped = await hasRecentAlert(rule.id, fingerprint, rule.throttleMinutes ?? 15);
    if (deduped) continue;

    const event = await addAlertEvent({
      ruleId: rule.id,
      severity: rule.severity,
      title: item.title,
      reason: `Matched rule "${rule.name}"`,
      evidenceRef: item.caseId && item.evidenceId ? { caseId: item.caseId, evidenceId: item.evidenceId } : undefined,
      feedRef: item.sourceId ? { feedId: item.sourceId, url: item.url } : undefined,
      fingerprint,
    });
    created.push(event);
  }

  return created;
}

async function hasRecentAlert(ruleId: string, fingerprint: string, throttleMinutes: number): Promise<boolean> {
  const db = await openDb();
  const threshold = Date.now() - Math.max(1, throttleMinutes) * 60_000;
  return new Promise((resolve) => {
    const req = db.transaction(ALERT_EVENTS_STORE, 'readonly').objectStore(ALERT_EVENTS_STORE).index('ruleId_fingerprint').getAll(IDBKeyRange.only([ruleId, fingerprint]));
    req.onsuccess = () => {
      const rows = req.result as AlertEventRecord[];
      resolve(rows.some((row) => new Date(row.createdAt).getTime() >= threshold));
    };
    req.onerror = () => resolve(false);
  });
}

async function updateAlertEventStatus(id: string, status: AlertEvent['status']): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(ALERT_EVENTS_STORE, 'readwrite');
  const store = tx.objectStore(ALERT_EVENTS_STORE);
  const req = store.get(id);
  req.onsuccess = () => {
    const existing = req.result as AlertEventRecord | undefined;
    if (!existing) return;
    store.put({ ...existing, status });
  };
  await txComplete(tx);
}

async function getEvidenceEntityLabels(caseId: string, evidenceId: string): Promise<string[]> {
  const [entities, edges] = await Promise.all([listEntities(caseId), listEdges(caseId)]);
  const linked = new Set(edges.filter((edge) => edge.evidenceId === evidenceId).map((edge) => edge.entityId));
  return entities.filter((entity) => linked.has(entity.id)).map((entity) => entity.label);
}

async function touchCase(caseId: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(CASES_STORE, 'readwrite');
  const req = tx.objectStore(CASES_STORE).get(caseId);
  req.onsuccess = () => {
    const entry = req.result as CaseRecord | undefined;
    if (!entry) return;
    tx.objectStore(CASES_STORE).put({ ...entry, updatedAt: new Date().toISOString() });
  };
  await txComplete(tx);
}
