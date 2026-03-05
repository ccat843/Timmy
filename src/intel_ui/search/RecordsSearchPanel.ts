import { Panel } from '@/components/Panel';
import { escapeHtml } from '@/utils/sanitize';
import { searchRecords, getRecordById, type UniversalRecord } from '@/intel_client/client';
import { saveFeedItemToCase } from '@/intel/ui/CasesPanel';

export class RecordsSearchPanel extends Panel {
  private query = '';
  private sourceType = '';
  private results: UniversalRecord[] = [];
  private selected: UniversalRecord | null = null;
  private error = '';

  constructor() {
    super({ id: 'records-search', title: 'Search', showCount: true });
    this.bindEvents();
    void this.runSearch();
  }

  private bindEvents(): void {
    this.content.addEventListener('input', (event) => {
      const target = event.target as HTMLInputElement;
      if (target.matches('[data-records-query]')) this.query = target.value;
      if (target.matches('[data-records-source-type]')) this.sourceType = target.value;
    });

    this.content.addEventListener('click', (event) => {
      const target = event.target as HTMLElement;
      if (target.closest('[data-records-search]')) return void this.runSearch();

      const open = target.closest<HTMLElement>('[data-open-record]');
      if (open?.dataset.openRecord) return void this.openRecord(open.dataset.openRecord);

      const addToCase = target.closest<HTMLElement>('[data-add-record-to-case]');
      if (addToCase?.dataset.addRecordToCase) {
        const rec = this.results.find((row) => row.id === addToCase.dataset.addRecordToCase) ?? this.selected;
        if (!rec) return;
        return void saveFeedItemToCase({
          sourceId: rec.source_id,
          title: rec.title ?? rec.id,
          url: rec.url,
          summary: rec.text,
          raw: rec,
        });
      }
    });
  }

  private async runSearch(): Promise<void> {
    this.error = '';
    const result = await searchRecords({ q: this.query, source_type: this.sourceType || undefined, limit: 100, offset: 0 });
    if (!result.ok) {
      this.error = result.error ?? 'Search failed';
      this.results = [];
      this.render();
      return;
    }

    this.results = result.records;
    this.setCount(this.results.length);
    this.render();
  }

  private async openRecord(id: string): Promise<void> {
    const result = await getRecordById(id);
    if (!result.ok) {
      this.error = result.error ?? 'Record load failed';
      this.render();
      return;
    }
    this.selected = result.record ?? null;
    this.render();
  }

  private render(): void {
    const rows = this.results.map((record) => `<button data-open-record="${escapeHtml(record.id)}" style="text-align:left;border:1px solid var(--border-color);border-radius:8px;padding:8px;display:grid;gap:4px;">
      <strong>${escapeHtml(record.title ?? record.id)}</strong>
      <span style="opacity:.8">${escapeHtml(record.source_type)} · ${escapeHtml(record.source_id)} · ${escapeHtml(record.published_at ?? record.fetched_at)}</span>
      <span style="opacity:.8">${escapeHtml((record.text ?? '').slice(0, 180))}</span>
    </button>`).join('');

    const detail = this.selected
      ? `<div style="display:grid;gap:8px;">
          <div><strong>${escapeHtml(this.selected.title ?? this.selected.id)}</strong></div>
          <div>${escapeHtml(this.selected.source_type)} · ${escapeHtml(this.selected.source_id)}</div>
          <div>${this.selected.url ? `<a href="${escapeHtml(this.selected.url)}" target="_blank" rel="noopener">Open link</a>` : '<span style="opacity:.7">No URL</span>'}</div>
          <button data-add-record-to-case="${escapeHtml(this.selected.id)}">Add to Case</button>
          <pre style="max-height:320px;overflow:auto;background:rgba(127,127,127,.08);padding:8px;border-radius:6px;">${escapeHtml(this.selected.raw_json)}</pre>
        </div>`
      : '<div class="panel-empty">Select a record</div>';

    this.setContent(`
      <div style="display:grid;grid-template-columns:1.3fr 1fr auto;gap:8px;margin-bottom:8px;">
        <input data-records-query placeholder="Search records" value="${escapeHtml(this.query)}" />
        <input data-records-source-type placeholder="source_type filter" value="${escapeHtml(this.sourceType)}" />
        <button data-records-search>Search</button>
      </div>
      ${this.error ? `<div style="color:#ff7b7b">${escapeHtml(this.error)}</div>` : ''}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
        <div style="display:grid;gap:8px;max-height:520px;overflow:auto;">${rows || '<div class="panel-empty">No records</div>'}</div>
        <div style="max-height:520px;overflow:auto;">${detail}</div>
      </div>
    `);
  }
}
