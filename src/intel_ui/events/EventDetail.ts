import type { IntelEvent, IntelHypothesisResult, IntelObservation } from '@/intel_client/client';
import { escapeHtml } from '@/utils/sanitize';

function findUrlInRaw(raw: unknown): string | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const candidate = raw as Record<string, unknown>;
  const direct = candidate.url;
  if (typeof direct === 'string' && direct.startsWith('http')) return direct;
  const link = candidate.link;
  if (typeof link === 'string' && link.startsWith('http')) return link;
  return undefined;
}

function renderObservationRow(observation: IntelObservation): string {
  const snippet = observation.text?.slice(0, 180) ?? '';
  const rawUrl = findUrlInRaw(observation.raw);
  const urlHtml = rawUrl
    ? `<a href="${escapeHtml(rawUrl)}" target="_blank" rel="noopener">open</a>`
    : '<span style="opacity:.6">n/a</span>';

  return `<details style="border:1px solid var(--border-color);border-radius:8px;padding:8px;">
    <summary style="cursor:pointer;display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
      <strong>${escapeHtml(observation.observedAt.replace('T', ' ').slice(0, 16))}</strong>
      <span>${escapeHtml(observation.type)}</span>
      <span>${escapeHtml(observation.source)}</span>
      <span style="opacity:.8">${escapeHtml(snippet)}</span>
      <span>${urlHtml}</span>
    </summary>
    <pre style="margin-top:8px;max-height:280px;overflow:auto;background:rgba(127,127,127,0.08);padding:8px;border-radius:6px;">${escapeHtml(JSON.stringify(observation.raw, null, 2))}</pre>
  </details>`;
}

function renderHypothesis(hypothesis: IntelHypothesisResult): string {
  const supports = hypothesis.supportingObservations.length > 0
    ? hypothesis.supportingObservations.map(renderObservationRow).join('')
    : '<div class="panel-empty">No supporting evidence</div>';
  const contradicts = hypothesis.contradictingObservations.length > 0
    ? hypothesis.contradictingObservations.map(renderObservationRow).join('')
    : '<div class="panel-empty">No contradicting evidence</div>';

  return `<details style="border:1px solid var(--border-color);border-radius:8px;padding:8px;">
    <summary style="cursor:pointer;display:flex;justify-content:space-between;gap:8px;">
      <strong>${escapeHtml(hypothesis.hypothesis.label)}</strong>
      <span>confidence: ${escapeHtml(hypothesis.confidence.toFixed(2))}</span>
    </summary>
    <div style="margin-top:8px;display:grid;gap:8px;">
      <div>${escapeHtml(hypothesis.hypothesis.description)}</div>
      <div><strong>Supporting evidence (${hypothesis.supportingObservations.length})</strong><div style="display:grid;gap:8px;margin-top:4px;">${supports}</div></div>
      <div><strong>Contradicting evidence (${hypothesis.contradictingObservations.length})</strong><div style="display:grid;gap:8px;margin-top:4px;">${contradicts}</div></div>
    </div>
  </details>`;
}

export function renderEventDetail(
  event: IntelEvent,
  hypotheses: IntelHypothesisResult[],
  hypothesesLoading: boolean,
  hypothesesError: string,
): string {
  const lat = event.location?.lat ?? event.centroidLat;
  const lon = event.location?.lon ?? event.centroidLon;
  const location = event.location?.name ?? (lat !== undefined && lon !== undefined
    ? `${lat.toFixed(2)}, ${lon.toFixed(2)}`
    : 'Unknown');

  const observations = event.observations ?? [];
  const linkedHtml = observations.length > 0
    ? observations.map(renderObservationRow).join('')
    : '<div class="panel-empty">No linked observations</div>';

  const hypothesisContent = hypothesesLoading
    ? '<div style="opacity:.7">Generating/loading hypotheses…</div>'
    : hypotheses.length > 0
      ? hypotheses.map(renderHypothesis).join('')
      : '<div class="panel-empty">No hypotheses generated</div>';

  return `<div style="display:grid;gap:10px;">
    <div>
      <h4 style="margin:0 0 6px 0;">${escapeHtml(event.title || event.id)}</h4>
      <div style="opacity:.8;">${escapeHtml(event.summary ?? 'No summary')}</div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
      <div><strong>Time Window</strong><div>${escapeHtml(event.fromTime ?? event.startAt ?? event.observedAt ?? 'Unknown')} → ${escapeHtml(event.toTime ?? event.endAt ?? event.observedAt ?? 'Unknown')}</div></div>
      <div><strong>Location</strong><div>${escapeHtml(location)}</div></div>
      <div><strong>Confidence</strong><div>${event.confidence !== undefined ? escapeHtml(String(event.confidence)) : 'n/a'}</div></div>
      <div><strong>Tags</strong><div>${event.tags?.map((tag) => `<span class="status-badge">${escapeHtml(tag)}</span>`).join(' ') || 'n/a'}</div></div>
    </div>
    <div>
      <h5 style="margin:0 0 8px 0;">Linked Observations (${observations.length})</h5>
      <div style="display:grid;gap:8px;">${linkedHtml}</div>
    </div>
    <div>
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
        <h5 style="margin:0;">Hypotheses</h5>
        <button data-generate-hypotheses="${escapeHtml(event.id)}">Regenerate</button>
      </div>
      ${hypothesesError ? `<div style="color:#ff7b7b;margin-top:6px;">${escapeHtml(hypothesesError)}</div>` : ''}
      <div style="display:grid;gap:8px;margin-top:8px;">${hypothesisContent}</div>
    </div>
  </div>`;
}
