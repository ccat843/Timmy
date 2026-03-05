import { Panel } from '@/components/Panel';
import type { CaseRecord, Entity, EvidenceEntityEdge, EvidenceItem } from '@/intel/models';
import {
  addEvidence,
  createCase,
  deleteCase,
  deleteEvidence,
  listCases,
  listEdges,
  listEntities,
  listEvidence,
  rebuildCaseEntities,
  searchEvidence,
  updateCase,
  updateEvidenceNotes,
} from '@/intel/storage/indexedDb';
import { escapeHtml } from '@/utils/sanitize';

type ViewMode = 'list' | 'detail';
type DetailTab = 'evidence' | 'graph';

export class CasesPanel extends Panel {
  private cases: CaseRecord[] = [];
  private selectedCaseId: string | null = null;
  private evidence: EvidenceItem[] = [];
  private selectedEvidenceId: string | null = null;
  private evidenceQuery = '';
  private mode: ViewMode = 'list';
  private detailTab: DetailTab = 'evidence';
  private entities: Entity[] = [];
  private edges: EvidenceEntityEdge[] = [];
  private selectedEntityId: string | null = null;

  constructor() {
    super({ id: 'cases', title: 'Cases', showCount: true });
    this.bindEvents();
    void this.refreshCases();
  }

  public async refreshCases(): Promise<void> {
    this.cases = await listCases();
    this.setCount(this.cases.length);
    if (this.selectedCaseId && !this.cases.some(c => c.id === this.selectedCaseId)) {
      this.selectedCaseId = null;
      this.mode = 'list';
    }
    if (this.selectedCaseId) await this.refreshEvidence();
    this.render();
  }

  public async refreshEvidence(): Promise<void> {
    if (!this.selectedCaseId) return;
    this.evidence = await listEvidence(this.selectedCaseId);
    this.entities = await listEntities(this.selectedCaseId);
    this.edges = await listEdges(this.selectedCaseId);
  }

  private bindEvents(): void {
    this.content.addEventListener('click', (event) => {
      const target = event.target as HTMLElement;

      if (target.closest('[data-action="create-case"]')) return void this.handleCreateCase();
      const openCase = target.closest<HTMLElement>('[data-open-case]');
      if (openCase?.dataset.openCase) {
        this.selectedCaseId = openCase.dataset.openCase;
        this.mode = 'detail';
        this.detailTab = 'evidence';
        return void this.refreshEvidence().then(() => this.render());
      }
      const deleteCaseBtn = target.closest<HTMLElement>('[data-delete-case]');
      if (deleteCaseBtn?.dataset.deleteCase) {
        if (!confirm('Delete this case and all evidence?')) return;
        return void deleteCase(deleteCaseBtn.dataset.deleteCase).then(() => this.refreshCases());
      }
      if (target.closest('[data-action="back-to-list"]')) {
        this.mode = 'list';
        this.render();
        return;
      }
      const tab = target.closest<HTMLElement>('[data-detail-tab]');
      if (tab?.dataset.detailTab === 'evidence' || tab?.dataset.detailTab === 'graph') {
        this.detailTab = tab.dataset.detailTab;
        this.render();
        return;
      }
      const pickEvidence = target.closest<HTMLElement>('[data-select-evidence]');
      if (pickEvidence?.dataset.selectEvidence) {
        this.selectedEvidenceId = pickEvidence.dataset.selectEvidence;
        this.render();
        return;
      }
      const removeEvidenceBtn = target.closest<HTMLElement>('[data-delete-evidence]');
      if (removeEvidenceBtn?.dataset.deleteEvidence) {
        return void deleteEvidence(removeEvidenceBtn.dataset.deleteEvidence).then(() => this.refreshEvidence().then(() => this.render()));
      }
      const entityNode = target.closest<HTMLElement>('[data-entity-node]');
      if (entityNode?.dataset.entityNode) {
        this.selectedEntityId = entityNode.dataset.entityNode;
        this.applyEntityEvidenceFilter();
        return;
      }
      const evidenceNode = target.closest<HTMLElement>('[data-evidence-node]');
      if (evidenceNode?.dataset.evidenceNode) {
        this.selectedEvidenceId = evidenceNode.dataset.evidenceNode;
        this.detailTab = 'evidence';
        this.render();
        return;
      }
      if (target.closest('[data-action="rebuild-entities"]') && this.selectedCaseId) {
        return void rebuildCaseEntities(this.selectedCaseId).then(() => this.refreshEvidence().then(() => this.render()));
      }
    });

    this.content.addEventListener('input', (event) => {
      const target = event.target as HTMLInputElement | HTMLTextAreaElement;
      if (target.matches('[data-case-title]')) {
        const id = target.getAttribute('data-case-title');
        const entry = this.cases.find(c => c.id === id);
        if (entry) entry.title = target.value;
        return;
      }
      if (target.matches('[data-case-description]')) {
        const id = target.getAttribute('data-case-description');
        const entry = this.cases.find(c => c.id === id);
        if (entry) entry.description = target.value;
        return;
      }
      if (target.matches('[data-case-tags]')) {
        const id = target.getAttribute('data-case-tags');
        const entry = this.cases.find(c => c.id === id);
        if (entry) entry.tags = target.value.split(',').map(t => t.trim()).filter(Boolean);
        return;
      }
      if (target.matches('[data-evidence-search]')) {
        this.evidenceQuery = target.value;
        return void this.applyEvidenceFilter();
      }
      if (target.matches('[data-evidence-notes]')) {
        const id = target.getAttribute('data-evidence-notes');
        if (!id) return;
        void updateEvidenceNotes(id, target.value).then(() => this.refreshEvidence());
      }
    });

    this.content.addEventListener('change', (event) => {
      const target = event.target as HTMLInputElement;
      if (target.matches('[data-case-title],[data-case-description],[data-case-tags]')) {
        const id = target.getAttribute('data-case-title') ?? target.getAttribute('data-case-description') ?? target.getAttribute('data-case-tags');
        const entry = this.cases.find(c => c.id === id);
        if (entry) void updateCase(entry).then(() => this.refreshCases());
      }
    });
  }

  private async handleCreateCase(): Promise<void> {
    const title = prompt('Case title');
    if (!title?.trim()) return;
    await createCase({ title, description: '', tags: [] });
    await this.refreshCases();
  }

  private async applyEvidenceFilter(): Promise<void> {
    if (!this.selectedCaseId) return;
    this.evidence = await searchEvidence(this.selectedCaseId, this.evidenceQuery);
    this.render();
  }

  private applyEntityEvidenceFilter(): void {
    if (!this.selectedCaseId || !this.selectedEntityId) return;
    const evidenceIds = new Set(this.edges.filter(e => e.entityId === this.selectedEntityId).map(e => e.evidenceId));
    this.evidence = this.evidence.filter(e => evidenceIds.has(e.id));
    this.detailTab = 'evidence';
    this.render();
  }

  private render(): void {
    this.setContent(this.mode === 'detail' && this.selectedCaseId ? this.renderCaseDetail() : this.renderCaseList());
  }

  private renderCaseList(): string {
    const rows = this.cases.map((item) => `
      <div class="item" style="display:grid;gap:6px;">
        <input data-case-title="${escapeHtml(item.id)}" value="${escapeHtml(item.title)}" placeholder="Case title" />
        <textarea data-case-description="${escapeHtml(item.id)}" placeholder="Description">${escapeHtml(item.description ?? '')}</textarea>
        <input data-case-tags="${escapeHtml(item.id)}" value="${escapeHtml(item.tags.join(', '))}" placeholder="tags, comma-separated" />
        <div style="display:flex;gap:8px;"><button data-open-case="${escapeHtml(item.id)}">Open</button><button data-delete-case="${escapeHtml(item.id)}">Delete</button></div>
      </div>`).join('');

    return `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;"><strong>Investigations</strong><button data-action="create-case">New Case</button></div><div style="display:grid;gap:10px;">${rows || '<div class="panel-empty">No cases yet</div>'}</div>`;
  }

  private renderCaseDetail(): string {
    const currentCase = this.cases.find(c => c.id === this.selectedCaseId);
    if (!currentCase) return '<div class="panel-empty">Case not found</div>';

    const tabs = `<div style="display:flex;gap:8px;margin:8px 0;"><button data-detail-tab="evidence" ${this.detailTab === 'evidence' ? 'style="font-weight:700;"' : ''}>Evidence</button><button data-detail-tab="graph" ${this.detailTab === 'graph' ? 'style="font-weight:700;"' : ''}>Graph</button><button data-action="rebuild-entities">Rebuild entities</button></div>`;

    const evidenceRows = this.evidence.map((item) => `<tr data-select-evidence="${escapeHtml(item.id)}" style="cursor:pointer;${this.selectedEvidenceId === item.id ? 'background:rgba(120,180,255,0.12);' : ''}"><td>${escapeHtml(item.createdAt.slice(0, 16).replace('T', ' '))}</td><td>${escapeHtml(item.sourceType)}</td><td>${escapeHtml(item.title)}</td><td>${item.url ? `<a href="${escapeHtml(item.url)}" target="_blank" rel="noopener">link</a>` : ''}</td><td><button data-delete-evidence="${escapeHtml(item.id)}">x</button></td></tr>`).join('');

    const timelineMap = new Map<string, number>();
    this.evidence.forEach((item) => timelineMap.set(item.createdAt.slice(0, 10), (timelineMap.get(item.createdAt.slice(0, 10)) ?? 0) + 1));
    const timeline = Array.from(timelineMap.entries()).sort((a, b) => b[0].localeCompare(a[0])).map(([day, count]) => `<div class="item" style="display:flex;justify-content:space-between;"><span>${escapeHtml(day)}</span><strong>${count}</strong></div>`).join('');
    const selected = this.evidence.find(e => e.id === this.selectedEvidenceId);

    return `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;"><button data-action="back-to-list">← Cases</button><strong>${escapeHtml(currentCase.title)}</strong></div>${tabs}${this.detailTab === 'graph' ? this.renderGraph() : `<input data-evidence-search value="${escapeHtml(this.evidenceQuery)}" placeholder="Search evidence" style="margin-bottom:8px;" /><div style="overflow:auto;max-height:220px;"><table style="width:100%;font-size:12px;border-collapse:collapse;"><thead><tr><th>Time</th><th>Type</th><th>Title</th><th>URL</th><th></th></tr></thead><tbody>${evidenceRows || '<tr><td colspan="5">No evidence</td></tr>'}</tbody></table></div><div style="margin-top:10px;display:grid;gap:8px;grid-template-columns:1fr 1fr;"><div><strong>Timeline</strong><div style="display:grid;gap:6px;margin-top:6px;">${timeline || '<div class="panel-empty">No timeline data</div>'}</div></div><div><strong>Notes</strong>${selected ? `<textarea data-evidence-notes="${escapeHtml(selected.id)}" style="width:100%;min-height:120px;">${escapeHtml(selected.notes ?? '')}</textarea>` : '<div class="panel-empty">Select evidence to annotate</div>'}</div></div>`}`;
  }

  private renderGraph(): string {
    const maxNodes = 250;
    const entities = this.entities.slice(0, maxNodes);
    const nodeEls = entities.map((entity, idx) => {
      const angle = (idx / Math.max(1, entities.length)) * Math.PI * 2;
      const radius = 34 + (idx % 9) * 12;
      const x = 42 + Math.cos(angle) * radius;
      const y = 45 + Math.sin(angle) * radius;
      return `<button data-entity-node="${escapeHtml(entity.id)}" style="position:absolute;left:${x}%;top:${y}%;transform:translate(-50%,-50%);font-size:11px;padding:3px 6px;border-radius:999px;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(entity.label)}</button>`;
    }).join('');

    const selectedEntity = entities.find(e => e.id === this.selectedEntityId);
    const linkedEvidence = selectedEntity ? this.edges.filter(edge => edge.entityId === selectedEntity.id).slice(0, 50) : [];
    const linkedEvidenceHtml = linkedEvidence.map((edge) => `<button data-evidence-node="${escapeHtml(edge.evidenceId)}" style="display:block;margin:4px 0;">Open evidence ${escapeHtml(edge.evidenceId.slice(0, 12))}</button>`).join('');

    return `<div style="display:grid;grid-template-columns:2fr 1fr;gap:10px;min-height:360px;"><div style="position:relative;border:1px solid var(--border-color);border-radius:10px;min-height:360px;overflow:hidden;">${nodeEls || '<div class="panel-empty">No entities yet</div>'}</div><div><div style="font-weight:700;margin-bottom:6px;">Node details</div>${selectedEntity ? `<div class="item"><div>${escapeHtml(selectedEntity.label)}</div><div style="opacity:.7">Type: ${escapeHtml(selectedEntity.type ?? 'other')}</div></div><div style="margin-top:8px;">Linked evidence</div>${linkedEvidenceHtml || '<div class="panel-empty">No links</div>'}` : '<div class="panel-empty">Select an entity node</div>'}</div></div>`;
  }
}

function chooseCaseModal(cases: CaseRecord[]): Promise<{ mode: 'existing'; caseId: string } | { mode: 'new'; title: string } | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;z-index:12000;';
    overlay.innerHTML = `<div style="width:min(92vw,420px);background:var(--panel-bg, #111827);border:1px solid var(--border-color, #334155);border-radius:12px;padding:14px;"><div style="font-weight:700;margin-bottom:8px;">Save to Case</div><select id="intel-case-picker" style="width:100%;margin-bottom:8px;"><option value="">Create new case…</option>${cases.map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.title)}</option>`).join('')}</select><input id="intel-case-new-title" placeholder="New case title" style="width:100%;margin-bottom:10px;" /><div style="display:flex;justify-content:flex-end;gap:8px;"><button id="intel-case-cancel">Cancel</button><button id="intel-case-save">Save</button></div></div>`;
    const cleanup = () => overlay.remove();
    overlay.querySelector('#intel-case-cancel')?.addEventListener('click', () => { cleanup(); resolve(null); });
    overlay.addEventListener('click', (e) => { if (e.target === overlay) { cleanup(); resolve(null); } });
    overlay.querySelector('#intel-case-save')?.addEventListener('click', () => {
      const picker = overlay.querySelector<HTMLSelectElement>('#intel-case-picker');
      const newTitle = overlay.querySelector<HTMLInputElement>('#intel-case-new-title');
      const selected = picker?.value?.trim();
      if (selected) return void (cleanup(), resolve({ mode: 'existing', caseId: selected }));
      const title = newTitle?.value?.trim() ?? '';
      if (!title) return;
      cleanup();
      resolve({ mode: 'new', title });
    });
    document.body.appendChild(overlay);
  });
}

export async function saveFeedItemToCase(payload: { sourceId: string; title: string; url?: string; summary?: string; raw: unknown; }): Promise<void> {
  const cases = await listCases();
  const choice = await chooseCaseModal(cases);
  if (!choice) return;
  const caseId = choice.mode === 'existing' ? choice.caseId : (await createCase({ title: choice.title, description: '', tags: [] })).id;
  await addEvidence({ caseId, sourceType: 'feed', sourceId: payload.sourceId, title: payload.title, url: payload.url, summary: payload.summary, raw: payload.raw });
}

