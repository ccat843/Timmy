import { Panel } from '@/components/Panel';
import type { CaseRecord, EvidenceItem } from '@/intel/models';
import {
  addEvidence,
  createCase,
  deleteCase,
  deleteEvidence,
  listCases,
  listEvidence,
  searchEvidence,
  updateCase,
  updateEvidenceNotes,
} from '@/intel/storage/indexedDb';
import { escapeHtml } from '@/utils/sanitize';

type ViewMode = 'list' | 'detail';

export class CasesPanel extends Panel {
  private cases: CaseRecord[] = [];
  private selectedCaseId: string | null = null;
  private evidence: EvidenceItem[] = [];
  private selectedEvidenceId: string | null = null;
  private evidenceQuery = '';
  private mode: ViewMode = 'list';

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
    if (!this.selectedCaseId) {
      this.evidence = [];
      return;
    }
    this.evidence = await listEvidence(this.selectedCaseId);
  }

  private bindEvents(): void {
    this.content.addEventListener('click', (event) => {
      const target = event.target as HTMLElement;

      if (target.closest('[data-action="create-case"]')) {
        void this.handleCreateCase();
        return;
      }

      const openCase = target.closest<HTMLElement>('[data-open-case]');
      if (openCase?.dataset.openCase) {
        this.selectedCaseId = openCase.dataset.openCase;
        this.mode = 'detail';
        void this.refreshEvidence().then(() => this.render());
        return;
      }

      const deleteCaseBtn = target.closest<HTMLElement>('[data-delete-case]');
      if (deleteCaseBtn?.dataset.deleteCase) {
        if (!confirm('Delete this case and all evidence?')) return;
        void deleteCase(deleteCaseBtn.dataset.deleteCase).then(() => this.refreshCases());
        return;
      }

      if (target.closest('[data-action="back-to-list"]')) {
        this.mode = 'list';
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
        void deleteEvidence(removeEvidenceBtn.dataset.deleteEvidence).then(() => this.refreshEvidence().then(() => this.render()));
      }
    });

    this.content.addEventListener('input', (event) => {
      const target = event.target as HTMLInputElement | HTMLTextAreaElement;

      if (target.matches('[data-case-title]')) {
        const id = target.getAttribute('data-case-title');
        if (!id) return;
        const entry = this.cases.find(c => c.id === id);
        if (!entry) return;
        entry.title = target.value;
        return;
      }

      if (target.matches('[data-case-description]')) {
        const id = target.getAttribute('data-case-description');
        if (!id) return;
        const entry = this.cases.find(c => c.id === id);
        if (!entry) return;
        entry.description = target.value;
        return;
      }

      if (target.matches('[data-case-tags]')) {
        const id = target.getAttribute('data-case-tags');
        if (!id) return;
        const entry = this.cases.find(c => c.id === id);
        if (!entry) return;
        entry.tags = target.value.split(',').map(t => t.trim()).filter(Boolean);
        return;
      }

      if (target.matches('[data-evidence-search]')) {
        this.evidenceQuery = target.value;
        void this.applyEvidenceFilter();
        return;
      }

      if (target.matches('[data-evidence-notes]')) {
        const id = target.getAttribute('data-evidence-notes');
        if (!id) return;
        void updateEvidenceNotes(id, target.value).then((updated) => {
          if (!updated) return;
          const idx = this.evidence.findIndex(e => e.id === updated.id);
          if (idx !== -1) this.evidence[idx] = updated;
        });
      }
    });

    this.content.addEventListener('change', (event) => {
      const target = event.target as HTMLInputElement;
      if (target.matches('[data-case-title],[data-case-description],[data-case-tags]')) {
        const id = target.getAttribute('data-case-title')
          ?? target.getAttribute('data-case-description')
          ?? target.getAttribute('data-case-tags');
        if (!id) return;
        const entry = this.cases.find(c => c.id === id);
        if (!entry) return;
        void updateCase(entry).then(() => this.refreshCases());
      }
    });
  }

  private async handleCreateCase(): Promise<void> {
    const title = prompt('Case title');
    if (!title || !title.trim()) return;
    await createCase({ title, description: '', tags: [] });
    await this.refreshCases();
  }

  private async applyEvidenceFilter(): Promise<void> {
    if (!this.selectedCaseId) return;
    this.evidence = await searchEvidence(this.selectedCaseId, this.evidenceQuery);
    this.render();
  }

  private render(): void {
    if (this.mode === 'detail' && this.selectedCaseId) {
      this.setContent(this.renderCaseDetail());
      return;
    }
    this.setContent(this.renderCaseList());
  }

  private renderCaseList(): string {
    const rows = this.cases.map((item) => `
      <div class="item" style="display:grid;gap:6px;">
        <input data-case-title="${escapeHtml(item.id)}" value="${escapeHtml(item.title)}" placeholder="Case title" />
        <textarea data-case-description="${escapeHtml(item.id)}" placeholder="Description">${escapeHtml(item.description ?? '')}</textarea>
        <input data-case-tags="${escapeHtml(item.id)}" value="${escapeHtml(item.tags.join(', '))}" placeholder="tags, comma-separated" />
        <div style="display:flex;gap:8px;">
          <button data-open-case="${escapeHtml(item.id)}">Open</button>
          <button data-delete-case="${escapeHtml(item.id)}">Delete</button>
        </div>
      </div>
    `).join('');

    return `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <strong>Investigations</strong>
        <button data-action="create-case">New Case</button>
      </div>
      <div style="display:grid;gap:10px;">${rows || '<div class="panel-empty">No cases yet</div>'}</div>
    `;
  }

  private renderCaseDetail(): string {
    const currentCase = this.cases.find(c => c.id === this.selectedCaseId);
    if (!currentCase) return '<div class="panel-empty">Case not found</div>';

    const timelineGroups = new Map<string, number>();
    this.evidence.forEach((item) => {
      const day = item.createdAt.slice(0, 10);
      timelineGroups.set(day, (timelineGroups.get(day) ?? 0) + 1);
    });

    const evidenceRows = this.evidence.map((item) => `
      <tr data-select-evidence="${escapeHtml(item.id)}" style="cursor:pointer;${this.selectedEvidenceId === item.id ? 'background:rgba(120,180,255,0.12);' : ''}">
        <td>${escapeHtml(item.createdAt.slice(0, 16).replace('T', ' '))}</td>
        <td>${escapeHtml(item.sourceType)}</td>
        <td>${escapeHtml(item.title)}</td>
        <td>${item.url ? `<a href="${escapeHtml(item.url)}" target="_blank" rel="noopener">link</a>` : ''}</td>
        <td><button data-delete-evidence="${escapeHtml(item.id)}">x</button></td>
      </tr>
    `).join('');

    const timeline = Array.from(timelineGroups.entries())
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([day, count]) => `<div class="item" style="display:flex;justify-content:space-between;"><span>${escapeHtml(day)}</span><strong>${count}</strong></div>`)
      .join('');

    const selected = this.evidence.find(e => e.id === this.selectedEvidenceId);

    return `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <button data-action="back-to-list">← Cases</button>
        <strong>${escapeHtml(currentCase.title)}</strong>
      </div>
      <input data-evidence-search value="${escapeHtml(this.evidenceQuery)}" placeholder="Search evidence" style="margin-bottom:8px;" />
      <div style="overflow:auto;max-height:220px;">
        <table style="width:100%;font-size:12px;border-collapse:collapse;">
          <thead><tr><th>Time</th><th>Type</th><th>Title</th><th>URL</th><th></th></tr></thead>
          <tbody>${evidenceRows || '<tr><td colspan="5">No evidence</td></tr>'}</tbody>
        </table>
      </div>
      <div style="margin-top:10px;display:grid;gap:8px;grid-template-columns:1fr 1fr;">
        <div>
          <strong>Timeline</strong>
          <div style="display:grid;gap:6px;margin-top:6px;">${timeline || '<div class="panel-empty">No timeline data</div>'}</div>
        </div>
        <div>
          <strong>Notes</strong>
          ${selected ? `<textarea data-evidence-notes="${escapeHtml(selected.id)}" style="width:100%;min-height:120px;">${escapeHtml(selected.notes ?? '')}</textarea>` : '<div class="panel-empty">Select evidence to annotate</div>'}
        </div>
      </div>
    `;
  }
}

function chooseCaseModal(cases: CaseRecord[]): Promise<{ mode: 'existing'; caseId: string } | { mode: 'new'; title: string } | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;z-index:12000;';
    overlay.innerHTML = `
      <div style="width:min(92vw,420px);background:var(--panel-bg, #111827);border:1px solid var(--border-color, #334155);border-radius:12px;padding:14px;">
        <div style="font-weight:700;margin-bottom:8px;">Save to Case</div>
        <select id="intel-case-picker" style="width:100%;margin-bottom:8px;">
          <option value="">Create new case…</option>
          ${cases.map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.title)}</option>`).join('')}
        </select>
        <input id="intel-case-new-title" placeholder="New case title" style="width:100%;margin-bottom:10px;" />
        <div style="display:flex;justify-content:flex-end;gap:8px;">
          <button id="intel-case-cancel">Cancel</button>
          <button id="intel-case-save">Save</button>
        </div>
      </div>`;

    const cleanup = () => overlay.remove();
    overlay.querySelector('#intel-case-cancel')?.addEventListener('click', () => { cleanup(); resolve(null); });
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        cleanup();
        resolve(null);
      }
    });

    overlay.querySelector('#intel-case-save')?.addEventListener('click', () => {
      const picker = overlay.querySelector<HTMLSelectElement>('#intel-case-picker');
      const newTitle = overlay.querySelector<HTMLInputElement>('#intel-case-new-title');
      const selected = picker?.value?.trim();
      if (selected) {
        cleanup();
        resolve({ mode: 'existing', caseId: selected });
        return;
      }
      const title = newTitle?.value?.trim() ?? '';
      if (!title) return;
      cleanup();
      resolve({ mode: 'new', title });
    });

    document.body.appendChild(overlay);
  });
}

export async function saveFeedItemToCase(payload: {
  sourceId: string;
  title: string;
  url?: string;
  summary?: string;
  raw: unknown;
}): Promise<void> {
  const cases = await listCases();
  const choice = await chooseCaseModal(cases);
  if (!choice) return;

  let caseId: string;
  if (choice.mode === 'existing') {
    caseId = choice.caseId;
  } else {
    const created = await createCase({ title: choice.title, description: '', tags: [] });
    caseId = created.id;
  }

  await addEvidence({
    caseId,
    sourceType: 'feed',
    sourceId: payload.sourceId,
    title: payload.title,
    url: payload.url,
    summary: payload.summary,
    raw: payload.raw,
  });
}
