import { Panel } from '@/components/Panel';
import {
  generateHypotheses,
  getEvent,
  health,
  listEventHypotheses,
  listEvents,
  rebuildEvents,
  type IntelEvent,
  type IntelHypothesisResult,
} from '@/intel_client/client';
import { escapeHtml } from '@/utils/sanitize';
import { renderEventDetail } from './EventDetail';

type Range = '24h' | '7d' | '30d';

function fromRange(range: Range): string {
  const now = Date.now();
  const ms = range === '24h' ? 24 * 60 * 60 * 1000 : range === '7d' ? 7 * 24 * 60 * 60 * 1000 : 30 * 24 * 60 * 60 * 1000;
  return new Date(now - ms).toISOString();
}

export class EventsPanel extends Panel {
  private events: IntelEvent[] = [];
  private selectedEvent: IntelEvent | null = null;
  private selectedHypotheses: IntelHypothesisResult[] = [];
  private hypothesesLoading = false;
  private hypothesesError = '';
  private range: Range = '7d';
  private textFilter = '';
  private loading = false;
  private offline = false;
  private statusHint = '';
  private error = '';
  private detailError = '';

  constructor() {
    super({ id: 'intel-events', title: 'Events', showCount: true });
    this.bindEvents();
    void this.refresh();
  }

  private bindEvents(): void {
    this.content.addEventListener('click', (event) => {
      const target = event.target as HTMLElement;
      if (target.closest('[data-events-retry]')) {
        void this.refresh();
        return;
      }
      if (target.closest('[data-events-rebuild]')) {
        void this.handleRebuild();
        return;
      }

      const row = target.closest<HTMLElement>('[data-open-event]');
      if (row?.dataset.openEvent) {
        void this.openEvent(row.dataset.openEvent);
        return;
      }

      const generateButton = target.closest<HTMLElement>('[data-generate-hypotheses]');
      if (generateButton?.dataset.generateHypotheses) {
        void this.handleGenerateHypotheses(generateButton.dataset.generateHypotheses);
      }
    });

    this.content.addEventListener('change', (event) => {
      const target = event.target as HTMLSelectElement;
      if (target.matches('[data-events-range]')) {
        this.range = target.value as Range;
        void this.refreshList();
      }
    });

    this.content.addEventListener('input', (event) => {
      const target = event.target as HTMLInputElement;
      if (target.matches('[data-events-filter]')) {
        this.textFilter = target.value;
        this.render();
      }
    });
  }

  private async refresh(): Promise<void> {
    this.loading = true;
    this.error = '';
    this.detailError = '';
    this.render();

    const status = await health();
    if (!status.ok) {
      this.statusHint = 'Intel engine health check failed; trying to load events anyway.';
    } else {
      this.statusHint = '';
      this.offline = false;
    }

    await this.refreshList();
  }

  private async refreshList(): Promise<void> {
    this.loading = true;
    this.error = '';
    this.render();

    const result = await listEvents({ from: fromRange(this.range), limit: 500, offset: 0 });
    if (!result.ok) {
      this.error = result.error ?? 'Failed to load events';
      this.offline = true;
      this.loading = false;
      this.render();
      return;
    }

    this.offline = false;

    this.events = result.events;
    this.setCount(this.events.length);
    this.loading = false;
    this.render();
  }

  private async openEvent(id: string): Promise<void> {
    this.detailError = '';
    this.hypothesesError = '';
    this.selectedHypotheses = [];
    this.hypothesesLoading = true;
    this.render();

    const result = await getEvent(id);
    if (!result.ok) {
      this.detailError = result.error ?? 'Failed to load event detail';
      this.hypothesesLoading = false;
      this.render();
      return;
    }

    this.selectedEvent = result.event;
    await this.loadHypothesesForSelectedEvent();
    this.render();
  }

  private async loadHypothesesForSelectedEvent(): Promise<void> {
    if (!this.selectedEvent) {
      this.selectedHypotheses = [];
      this.hypothesesLoading = false;
      return;
    }

    this.hypothesesLoading = true;
    this.hypothesesError = '';
    const result = await listEventHypotheses(this.selectedEvent.id);
    if (!result.ok) {
      this.hypothesesError = result.error ?? 'Failed to load hypotheses';
      this.selectedHypotheses = [];
      this.hypothesesLoading = false;
      return;
    }

    this.selectedHypotheses = result.hypotheses;
    this.hypothesesLoading = false;
  }

  private async handleGenerateHypotheses(eventId: string): Promise<void> {
    this.hypothesesLoading = true;
    this.hypothesesError = '';
    this.render();

    const generated = await generateHypotheses(eventId);
    if (!generated.ok) {
      this.hypothesesLoading = false;
      this.hypothesesError = generated.error ?? 'Failed to generate hypotheses';
      this.render();
      return;
    }

    await this.loadHypothesesForSelectedEvent();
    this.render();
  }

  private async handleRebuild(): Promise<void> {
    this.error = '';
    this.statusHint = 'Rebuilding events from recent observations...';
    this.render();
    const rebuilt = await rebuildEvents(14);
    if (!rebuilt.ok) {
      this.error = rebuilt.error ?? 'Failed to rebuild events';
      this.statusHint = '';
      this.render();
      return;
    }
    this.statusHint = `Rebuilt events (${rebuilt.built ?? 0} clusters). Refreshing list...`;
    await this.refreshList();
  }

  private render(): void {
    if (this.offline) {
      this.setContent(`<div class="panel-empty">Intel Engine offline</div><div style="opacity:.8;margin-top:6px;">Run a data load first, then click rebuild.</div><div style="display:flex;gap:8px;margin-top:8px;"><button data-events-retry>Retry</button><button data-events-rebuild>Rebuild events</button></div>`);
      return;
    }

    const filtered = this.events.filter((entry) => {
      if (!this.textFilter.trim()) return true;
      const needle = this.textFilter.toLowerCase();
      const hay = `${entry.title ?? ''} ${entry.summary ?? ''} ${(entry.tags ?? []).join(' ')}`.toLowerCase();
      return hay.includes(needle);
    });

    const listHtml = filtered.length > 0
      ? filtered.map((event) => {
        const lat = event.location?.lat ?? event.centroidLat;
        const lon = event.location?.lon ?? event.centroidLon;
        const location = event.location?.name ?? (lat !== undefined && lon !== undefined
          ? `${lat.toFixed(2)}, ${lon.toFixed(2)}`
          : 'Unknown');
        const isSelected = this.selectedEvent?.id === event.id;
        return `<button data-open-event="${escapeHtml(event.id)}" style="display:grid;gap:4px;text-align:left;padding:8px;border:1px solid var(--border-color);border-radius:8px;background:${isSelected ? 'rgba(100,150,255,.18)' : 'transparent'};">
          <strong>${escapeHtml(event.title || event.id)}</strong>
          <span style="opacity:.8">${escapeHtml(event.fromTime ?? event.startAt ?? event.observedAt ?? 'Unknown')} → ${escapeHtml(event.toTime ?? event.endAt ?? event.observedAt ?? 'Unknown')}</span>
          <span style="opacity:.8">${escapeHtml(location)}</span>
          <span style="opacity:.8">confidence: ${event.confidence !== undefined ? escapeHtml(String(event.confidence)) : 'n/a'} ${event.tags?.length ? `· ${escapeHtml(event.tags.join(', '))}` : ''}</span>
        </button>`;
      }).join('')
      : '<div class="panel-empty">No events for selected filters</div>';

    const detailHtml = this.selectedEvent
      ? renderEventDetail(this.selectedEvent, this.selectedHypotheses, this.hypothesesLoading, this.hypothesesError)
      : '<div class="panel-empty">Select an event to view details</div>';

    const loadingHtml = this.loading ? '<div style="opacity:.7">Loading events…</div>' : '';
    const statusHintHtml = this.statusHint ? `<div style="opacity:.75">${escapeHtml(this.statusHint)}</div>` : '';
    const errorHtml = this.error ? `<div style="color:#ff7b7b">${escapeHtml(this.error)}</div>` : '';
    const detailErrorHtml = this.detailError ? `<div style="color:#ff7b7b">${escapeHtml(this.detailError)}</div>` : '';

    this.setContent(`
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;align-items:center;margin-bottom:8px;">
        <select data-events-range>
          <option value="24h" ${this.range === '24h' ? 'selected' : ''}>Last 24h</option>
          <option value="7d" ${this.range === '7d' ? 'selected' : ''}>Last 7d</option>
          <option value="30d" ${this.range === '30d' ? 'selected' : ''}>Last 30d</option>
        </select>
        <input data-events-filter placeholder="Filter events" value="${escapeHtml(this.textFilter)}" />
      </div>
      ${loadingHtml}
      ${statusHintHtml}
      ${errorHtml}
      <div style="display:grid;grid-template-columns:1fr 1.2fr;gap:10px;align-items:start;">
        <div style="display:grid;gap:8px;max-height:480px;overflow:auto;">${listHtml}</div>
        <div style="display:grid;gap:8px;max-height:480px;overflow:auto;">${detailErrorHtml}${detailHtml}</div>
      </div>
y       <div style="margin-top:8px;display:flex;gap:8px;"><button data-events-retry>Retry</button><button data-events-rebuild>Rebuild events</button></div>
    `);
  }
}
