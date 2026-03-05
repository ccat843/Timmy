import { Panel } from '@/components/Panel';
import type { AlertEvent, AlertRule, AlertSeverity } from '@/intel/models';
import {
  archiveAlertEvent,
  deleteAlertRule,
  listAlertEvents,
  listAlertRules,
  markAlertEventRead,
  setRuleEnabled,
  upsertAlertRule,
} from '@/intel/storage/indexedDb';
import { escapeHtml } from '@/utils/sanitize';

type AlertsTab = 'events' | 'rules';

export class AlertsPanel extends Panel {
  private tab: AlertsTab = 'events';
  private rules: AlertRule[] = [];
  private events: AlertEvent[] = [];
  private severityFilter: '' | AlertSeverity = '';
  private statusFilter: '' | AlertEvent['status'] = '';
  private ruleFilter = '';

  constructor() {
    super({ id: 'alerts', title: 'Alerts', showCount: true });
    this.bindEvents();
    void this.refresh();
  }

  private async refresh(): Promise<void> {
    const [rules, events] = await Promise.all([
      listAlertRules(),
      listAlertEvents({ status: this.statusFilter || undefined, severity: this.severityFilter || undefined, ruleId: this.ruleFilter || undefined }),
    ]);
    this.rules = rules;
    this.events = events;
    this.setCount(events.filter((e) => e.status === 'new').length);
    this.render();
  }

  private bindEvents(): void {
    this.content.addEventListener('click', (event) => {
      const target = event.target as HTMLElement;
      const tab = target.closest<HTMLElement>('[data-alerts-tab]');
      if (tab?.dataset.alertsTab === 'events' || tab?.dataset.alertsTab === 'rules') {
        this.tab = tab.dataset.alertsTab;
        this.render();
        return;
      }

      const markRead = target.closest<HTMLElement>('[data-mark-read]');
      if (markRead?.dataset.markRead) return void markAlertEventRead(markRead.dataset.markRead).then(() => this.refresh());
      const archive = target.closest<HTMLElement>('[data-archive-event]');
      if (archive?.dataset.archiveEvent) return void archiveAlertEvent(archive.dataset.archiveEvent).then(() => this.refresh());
      const toggleRule = target.closest<HTMLElement>('[data-toggle-rule]');
      if (toggleRule?.dataset.toggleRule) {
        const rule = this.rules.find((r) => r.id === toggleRule.dataset.toggleRule);
        if (!rule) return;
        return void setRuleEnabled(rule.id, !rule.enabled).then(() => this.refresh());
      }
      const deleteRuleBtn = target.closest<HTMLElement>('[data-delete-rule]');
      if (deleteRuleBtn?.dataset.deleteRule) return void deleteAlertRule(deleteRuleBtn.dataset.deleteRule).then(() => this.refresh());
      if (target.closest('[data-create-rule]')) return void this.createRule();
    });

    this.content.addEventListener('change', (event) => {
      const target = event.target as HTMLSelectElement;
      if (target.matches('[data-filter-severity]')) {
        this.severityFilter = target.value as '' | AlertSeverity;
        void this.refresh();
        return;
      }
      if (target.matches('[data-filter-status]')) {
        this.statusFilter = target.value as '' | AlertEvent['status'];
        void this.refresh();
        return;
      }
      if (target.matches('[data-filter-rule]')) {
        this.ruleFilter = target.value;
        void this.refresh();
      }
    });
  }

  private async createRule(): Promise<void> {
    const name = prompt('Rule name');
    if (!name?.trim()) return;
    const keywordsRaw = prompt('Keywords (comma separated)') ?? '';
    const mode = ((prompt('Keyword mode: AND or OR', 'OR') ?? 'OR').toUpperCase() === 'AND' ? 'AND' : 'OR') as 'AND' | 'OR';
    const severity = ((prompt('Severity: low|med|high', 'med') ?? 'med').toLowerCase()) as AlertSeverity;
    const entitiesRaw = prompt('Optional entities (comma separated)') ?? '';
    const sourcesRaw = prompt('Optional sources/feed ids (comma separated)') ?? '';
    const throttleRaw = prompt('Throttle minutes', '15') ?? '15';

    await upsertAlertRule({
      name,
      enabled: true,
      severity: severity === 'low' || severity === 'high' ? severity : 'med',
      throttleMinutes: Number.parseInt(throttleRaw, 10) || 15,
      match: {
        keywords: keywordsRaw.split(',').map((v) => v.trim()).filter(Boolean),
        keywordMode: mode,
        entities: entitiesRaw.split(',').map((v) => v.trim()).filter(Boolean),
        sources: sourcesRaw.split(',').map((v) => v.trim()).filter(Boolean),
        tags: [],
      },
    });
    await this.refresh();
  }

  private render(): void {
    const tabs = `<div style="display:flex;gap:8px;margin-bottom:8px;"><button data-alerts-tab="events" ${this.tab === 'events' ? 'style="font-weight:700;"' : ''}>Events</button><button data-alerts-tab="rules" ${this.tab === 'rules' ? 'style="font-weight:700;"' : ''}>Rules</button></div>`;
    this.setContent(`${tabs}${this.tab === 'events' ? this.renderEvents() : this.renderRules()}`);
  }

  private renderEvents(): string {
    const rows = this.events.map((event) => `
      <div class="item" style="display:grid;gap:4px;">
        <div style="display:flex;justify-content:space-between;gap:8px;">
          <strong>${escapeHtml(event.title)}</strong>
          <span>${escapeHtml(event.severity.toUpperCase())}</span>
        </div>
        <div style="opacity:.8">${escapeHtml(event.reason)}</div>
        <div style="opacity:.7;font-size:12px;">${escapeHtml(event.createdAt.replace('T', ' ').slice(0, 16))} • ${escapeHtml(event.status)}</div>
        <div style="display:flex;gap:8px;"><button data-mark-read="${escapeHtml(event.id)}">Mark Read</button><button data-archive-event="${escapeHtml(event.id)}">Archive</button></div>
      </div>
    `).join('');

    const ruleOptions = this.rules.map((rule) => `<option value="${escapeHtml(rule.id)}" ${this.ruleFilter === rule.id ? 'selected' : ''}>${escapeHtml(rule.name)}</option>`).join('');

    return `
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:8px;">
        <select data-filter-status><option value="">All status</option><option value="new" ${this.statusFilter === 'new' ? 'selected' : ''}>new</option><option value="read" ${this.statusFilter === 'read' ? 'selected' : ''}>read</option><option value="archived" ${this.statusFilter === 'archived' ? 'selected' : ''}>archived</option></select>
        <select data-filter-severity><option value="">All severity</option><option value="low" ${this.severityFilter === 'low' ? 'selected' : ''}>low</option><option value="med" ${this.severityFilter === 'med' ? 'selected' : ''}>med</option><option value="high" ${this.severityFilter === 'high' ? 'selected' : ''}>high</option></select>
        <select data-filter-rule><option value="">All rules</option>${ruleOptions}</select>
      </div>
      <div style="display:grid;gap:8px;">${rows || '<div class="panel-empty">No alert events</div>'}</div>
    `;
  }

  private renderRules(): string {
    const rows = this.rules.map((rule) => `
      <div class="item" style="display:grid;gap:4px;">
        <div style="display:flex;justify-content:space-between;gap:8px;"><strong>${escapeHtml(rule.name)}</strong><span>${rule.enabled ? 'enabled' : 'disabled'}</span></div>
        <div style="opacity:.8">${escapeHtml((rule.match.keywordMode ?? 'OR') + ': ' + rule.match.keywords.join(', '))}</div>
        <div style="opacity:.7;font-size:12px;">severity=${escapeHtml(rule.severity)} throttle=${escapeHtml(String(rule.throttleMinutes ?? 15))}m</div>
        <div style="display:flex;gap:8px;"><button data-toggle-rule="${escapeHtml(rule.id)}">${rule.enabled ? 'Disable' : 'Enable'}</button><button data-delete-rule="${escapeHtml(rule.id)}">Delete</button></div>
      </div>
    `).join('');

    return `<div style="display:flex;justify-content:flex-end;margin-bottom:8px;"><button data-create-rule>Create Rule</button></div><div style="display:grid;gap:8px;">${rows || '<div class="panel-empty">No alert rules</div>'}</div>`;
  }
}
