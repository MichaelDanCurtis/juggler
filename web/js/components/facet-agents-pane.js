// Prizmanyx fork — native Agents pane (the roster).
// AGPL-3.0-or-later - see LICENSE

/**
 * The panel's AGENTS tab: spawn agents from a template library, watch the ones
 * running, and answer the one that needs you.
 *
 * DENSITY IS THE DESIGN (roster spec §5). Nine agents must be readable at once,
 * so a card is ONE LINE by default — status dot, name, current focus, elapsed ·
 * budget. Hover peeks at the recent journal without committing the space.
 *
 * A card earns space by being urgent: a run that is BLOCKED expands itself and
 * STAYS expanded, carrying the question, the evidence, the optional diagram and
 * the answer box. That is the whole interaction — you scan a quiet list, and
 * the one that needs you is the one you cannot miss.
 *
 * Everything goes through the fork server's same-origin /pzx proxy with the
 * program-bound capability token from prizmanyx-context, exactly as the
 * Workspace pane does. No context degrades to an honest empty state, never a
 * blank pane.
 *
 * Polling, not streaming: a roster is a low-rate surface (a leg is seconds to
 * minutes) and a 5s poll costs one cheap request against an endpoint that is
 * already program-scoped. A socket would add a reconnect state machine for no
 * felt latency difference. Polling PAUSES while an answer box has focus — a
 * re-render that ate half a typed answer would be the pane's most infuriating
 * possible bug.
 */

import { getPzxContext, onPzxContextChange } from '../utils/prizmanyx-context.js';

const POLL_MS = 5000;

/**
 * @param {string} value
 * @returns {string} The value with HTML metacharacters escaped.
 */
function esc(value) {
  const div = document.createElement('div');
  div.textContent = value === null || value === undefined ? '' : String(value);
  return div.innerHTML;
}

/**
 * @param {string|null} iso
 * @returns {string} A short human duration, or '' when unparseable.
 */
function elapsed(iso) {
  if (!iso) return '';
  const started = Date.parse(iso);
  if (Number.isNaN(started)) return '';
  const seconds = Math.max(0, Math.round((Date.now() - started) / 1000));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h${Math.floor((seconds % 3600) / 60)}m`;
}

/**
 * Blast radius, stated on the template card BEFORE you spawn (spec §5).
 * Derived from the definition itself rather than prose, so it cannot drift from
 * what the agent can actually do.
 * @param {{tool_ids?: string[], deposit_kinds?: string[], default_budget_calls?: number}} def
 * @returns {string} One line naming what the agent reads, saves and may spend.
 */
function blastRadius(def) {
  const reads = (def.tool_ids || []).length;
  const deposits = def.deposit_kinds || [];
  const writes = deposits.length
    ? `SAVES ${deposits.join(', ')}`
    : 'SAVES nothing — reports back only';
  return `READS ${reads} tool${reads === 1 ? '' : 's'} · ${writes} · BUDGET ${
    def.default_budget_calls ?? '?'
  } calls`;
}

class FacetAgentsPane extends HTMLElement {
  constructor() {
    super();
    /** @type {Array<Record<string, any>>|null} */
    this._runs = null;
    /** @type {Array<Record<string, any>>|null} */
    this._definitions = null;
    this._error = '';
    this._library = false;
    /** @type {number|null} */
    this._timer = null;
    /** @type {(() => void)|null} */
    this._unsubscribe = null;
    /** Run ids the user expanded by hand — sticky across re-render. */
    this._expanded = new Set();
  }

  /** @returns {void} */
  connectedCallback() {
    this._unsubscribe = onPzxContextChange(() => void this._load());
    void this._load();
    this._timer = window.setInterval(() => void this._poll(), POLL_MS);
  }

  /** @returns {void} */
  disconnectedCallback() {
    this._unsubscribe?.();
    this._unsubscribe = null;
    if (this._timer !== null) window.clearInterval(this._timer);
    this._timer = null;
  }

  /** @returns {void} Re-fetch when the tab becomes visible. */
  refresh() {
    void this._load();
  }

  /**
   * @returns {{base: string, token: string, programId: number}|null} The proxy target, or null with no console context.
   */
  _target() {
    const context = getPzxContext();
    if (!context) return null;
    return { base: '/pzx/api/v1/agents', token: context.token, programId: context.programId };
  }

  /**
   * A poll must never destroy work in progress. If the operator is typing an
   * answer, skip this tick entirely rather than re-render underneath them.
   * @returns {Promise<void>} Resolves once the tick is done or skipped.
   */
  async _poll() {
    const typing = this.querySelector('textarea[data-answer]');
    if (typing && this.contains(document.activeElement) && document.activeElement === typing) {
      return;
    }
    await this._load();
  }

  /** @returns {Promise<void>} Resolves once runs and definitions are refreshed. */
  async _load() {
    const target = this._target();
    if (!target) {
      this._runs = null;
      this._definitions = null;
      this._error = '';
      this._render();
      return;
    }
    try {
      const [runs, definitions] = await Promise.all([
        this._get(`${target.base}/runs?program_id=${target.programId}&t=${target.token}`),
        this._get(`${target.base}/definitions?t=${target.token}`),
      ]);
      if (Array.isArray(runs)) {
        this._runs = runs;
        this._error = '';
      }
      if (Array.isArray(definitions)) this._definitions = definitions;
    } catch {
      this._error = 'Agents unreachable — is the Prizmanyx API running?';
    }
    this._render();
  }

  /**
   * @param {string} url
   * @returns {Promise<any>} The parsed body, or null when the request failed.
   */
  async _get(url) {
    const response = await fetch(url);
    if (response.status === 401) {
      this._error = 'Access token expired — open the Console in Prizmanyx to refresh it.';
      return null;
    }
    if (!response.ok) {
      this._error = `Agents unavailable (HTTP ${response.status})`;
      return null;
    }
    return response.json().catch(() => null);
  }

  /**
   * @param {string} path
   * @param {Record<string, unknown>} body
   * @returns {Promise<void>} Resolves once the roster has been reloaded.
   */
  async _post(path, body) {
    const target = this._target();
    if (!target) return;
    try {
      const response = await fetch(`${target.base}${path}?t=${target.token}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const detail = await response.json().catch(() => ({}));
        this._error = detail.detail || `Request failed (HTTP ${response.status})`;
      }
    } catch {
      this._error = 'Agents unreachable — is the Prizmanyx API running?';
    }
    await this._load();
  }

  /**
   * @param {Record<string, any>} run
   * @returns {boolean} True when the card shows its body.
   */
  _isOpen(run) {
    // Blocked expands ITSELF and stays open: the card earns the space by
    // needing you. Everything else is one line unless you opened it.
    return run.status === 'blocked' || this._expanded.has(run.id);
  }

  /**
   * @param {Record<string, any>} run
   * @returns {string} The needs-you card body markup.
   */
  _renderBlocked(run) {
    const payload = run.blocked_payload || {};
    const options = Array.isArray(payload.options) ? payload.options : [];
    const evidence = Array.isArray(payload.evidence) ? payload.evidence : [];
    const diagram = payload.diagram;
    return `
      <div class="agent-card-body agent-needs-you">
        <p class="agent-question">${esc(payload.question || 'This agent needs you.')}</p>
        ${
          evidence.length
            ? `<ul class="agent-evidence">${evidence
              .map((/** @type {string} */ item) => `<li>${esc(item)}</li>`)
              .join('')}</ul>`
            : ''
        }
        ${diagram ? this._renderDiagram(diagram, payload.diagram_beyond_registry || []) : ''}
        ${
          payload.diagram_error
            ? `<p class="agent-diagram-error">${esc(payload.diagram_error)}</p>`
            : ''
        }
        ${
          options.length
            ? `<div class="agent-options">${options
              .map(
                (/** @type {string} */ opt) =>
                  `<button type="button" data-answer-option="${esc(opt)}" data-run="${esc(
                    run.id
                  )}">${esc(opt)}</button>`
              )
              .join('')}</div>`
            : ''
        }
        <textarea data-answer data-run="${esc(run.id)}" rows="2"
          placeholder="Answer and the run continues from where it stopped."></textarea>
        <div class="agent-actions">
          <button type="button" data-send="${esc(run.id)}">Send</button>
          <button type="button" data-cancel="${esc(run.id)}">Stop this agent</button>
        </div>
      </div>`;
  }

  /**
   * The sketch, rendered as boxes and arrows. Deliberately plain: this is a
   * hand-raise on a panel someone is reading while interrupted, not the estate
   * graph. Nodes the mapping registry does not know are marked — the flag is
   * stamped server-side, so the agent cannot claim an invented type is known.
   * @param {Record<string, any>} diagram The validated sketch spec.
   * @param {string[]} beyond Node keys the registry does not know.
   * @returns {string} The sketch markup.
   */
  _renderDiagram(diagram, beyond) {
    const flagged = new Set(beyond);
    const nodes = Array.isArray(diagram.nodes) ? diagram.nodes : [];
    const edges = Array.isArray(diagram.edges) ? diagram.edges : [];
    return `
      <figure class="agent-diagram">
        <figcaption>${esc(diagram.title || 'Sketch')}</figcaption>
        <ul class="agent-diagram-nodes">
          ${nodes
            .map(
              (n) =>
                `<li${flagged.has(n.key) ? ' class="beyond-registry"' : ''}>${esc(n.label)}${
                  n.type ? ` <span class="agent-node-type">${esc(n.type)}</span>` : ''
                }${flagged.has(n.key) ? ' <span class="agent-beyond">beyond registry</span>' : ''}</li>`
            )
            .join('')}
        </ul>
        ${
          edges.length
            ? `<ul class="agent-diagram-edges">${edges
              .map(
                (e) =>
                  `<li>${esc(e.source)} → ${esc(e.target)}${
                    e.label ? ` <span>${esc(e.label)}</span>` : ''
                  }</li>`
              )
              .join('')}</ul>`
            : ''
        }
        ${diagram.narration ? `<p>${esc(diagram.narration)}</p>` : ''}
      </figure>`;
  }

  /**
   * @param {Record<string, any>} run
   * @returns {string} The recent tool journal markup.
   */
  _renderJournal(run) {
    const events = Array.isArray(run.events) ? run.events.slice(-6) : [];
    if (!events.length) return '<p class="agent-journal-empty">No tool calls yet.</p>';
    return `<ul class="agent-journal">${events
      .map((e) => `<li>${esc(e.kind)}${e.payload?.tool ? `: ${esc(e.payload.tool)}` : ''}</li>`)
      .join('')}</ul>`;
  }

  /**
   * @param {Record<string, any>} run
   * @returns {string} One roster card.
   */
  _renderRun(run) {
    const open = this._isOpen(run);
    const budget = `${run.calls_used ?? 0}/${run.budget_calls ?? '?'}`;
    return `
      <li class="agent-card status-${esc(run.status)}${open ? ' is-open' : ''}"
          data-run-card="${esc(run.id)}">
        <button type="button" class="agent-line" data-toggle="${esc(run.id)}"
                aria-expanded="${open}">
          <span class="agent-dot" aria-hidden="true"></span>
          <span class="agent-name">${esc(run.definition_name)}</span>
          <span class="agent-focus">${esc(run.focus || run.status)}</span>
          <span class="agent-meta">${esc(elapsed(run.created_at))} · ${esc(budget)}</span>
        </button>
        ${
          run.status === 'blocked'
            ? this._renderBlocked(run)
            : open
              ? `<div class="agent-card-body">${this._renderJournal(run)}
                   <div class="agent-actions">
                     <button type="button" data-cancel="${esc(run.id)}">Stop this agent</button>
                   </div>
                 </div>`
              : ''
        }
      </li>`;
  }

  /** @returns {string} The template-library markup. */
  _renderLibrary() {
    const definitions = this._definitions || [];
    if (!definitions.length) {
      return '<p class="agents-empty">No agent templates are defined.</p>';
    }
    return `
      <ul class="agent-templates">
        ${definitions
          .map(
            (def) => `
          <li class="agent-template">
            <h4>${esc(def.title || def.name)}</h4>
            <p>${esc(def.description || '')}</p>
            <p class="agent-blast">${esc(blastRadius(def))}</p>
            <textarea data-brief="${esc(def.name)}" rows="2"
              placeholder="What are you trying to find out?"></textarea>
            <button type="button" data-spawn="${esc(def.name)}">Start this agent</button>
          </li>`
          )
          .join('')}
      </ul>`;
  }

  /** @returns {void} */
  _render() {
    const context = getPzxContext();
    if (!context) {
      this.innerHTML = `
        <div class="agents-pane">
          <p class="agents-empty">
            Open the Console in Prizmanyx to connect this panel to a program.
            Agents are program-scoped, so there is nothing to show until then.
          </p>
        </div>`;
      return;
    }
    const runs = this._runs || [];
    const active = runs.filter((r) => r.status === 'running' || r.status === 'blocked');
    const done = runs.filter((r) => r.status !== 'running' && r.status !== 'blocked');
    this.innerHTML = `
      <div class="agents-pane">
        ${this._error ? `<p class="agents-error">${esc(this._error)}</p>` : ''}
        <div class="agents-header">
          <span>${active.length} running</span>
          <button type="button" data-library>${this._library ? 'Close' : '+ New agent'}</button>
        </div>
        ${this._library ? this._renderLibrary() : ''}
        ${
          active.length
            ? `<ul class="agent-cards">${active.map((r) => this._renderRun(r)).join('')}</ul>`
            : '<p class="agents-empty">No agents running. Start one to investigate something.</p>'
        }
        ${
          done.length
            ? `<details class="agents-done"><summary>${done.length} finished</summary>
                 <ul class="agent-cards">${done.map((r) => this._renderRun(r)).join('')}</ul>
               </details>`
            : ''
        }
      </div>`;
    this._wire();
  }

  /** @returns {void} */
  _wire() {
    this.querySelector('[data-library]')?.addEventListener('click', () => {
      this._library = !this._library;
      this._render();
    });
    for (const el of Array.from(this.querySelectorAll('[data-toggle]'))) {
      el.addEventListener('click', () => {
        const id = Number(el.getAttribute('data-toggle'));
        if (this._expanded.has(id)) this._expanded.delete(id);
        else this._expanded.add(id);
        this._render();
      });
    }
    for (const el of Array.from(this.querySelectorAll('[data-spawn]'))) {
      el.addEventListener('click', () => {
        const name = el.getAttribute('data-spawn');
        const brief = /** @type {HTMLTextAreaElement|null} */ (
          this.querySelector(`textarea[data-brief="${name}"]`)
        );
        const context = getPzxContext();
        if (!context) return;
        this._library = false;
        void this._post('/spawn', {
          definition: name,
          program_id: context.programId,
          brief: brief ? brief.value : '',
        });
      });
    }
    for (const el of Array.from(this.querySelectorAll('[data-answer-option]'))) {
      el.addEventListener('click', () => {
        const box = /** @type {HTMLTextAreaElement|null} */ (
          this.querySelector(`textarea[data-answer][data-run="${el.getAttribute('data-run')}"]`)
        );
        if (box) box.value = el.getAttribute('data-answer-option') || '';
      });
    }
    for (const el of Array.from(this.querySelectorAll('[data-send]'))) {
      el.addEventListener('click', () => {
        const id = el.getAttribute('data-send');
        const box = /** @type {HTMLTextAreaElement|null} */ (
          this.querySelector(`textarea[data-answer][data-run="${id}"]`)
        );
        const answer = box ? box.value.trim() : '';
        if (!answer) return;
        void this._post(`/runs/${id}/answer`, { answer });
      });
    }
    for (const el of Array.from(this.querySelectorAll('[data-cancel]'))) {
      el.addEventListener('click', () => {
        void this._post(`/runs/${el.getAttribute('data-cancel')}/cancel`, {});
      });
    }
  }
}

customElements.define('facet-agents-pane', FacetAgentsPane);

export { FacetAgentsPane, blastRadius, elapsed };
