// Prizmanyx fork — native Workspace pane (per-task durable files).
// AGPL-3.0-or-later - see LICENSE

/**
 * The panel's WORKSPACE tab: the consultant's per-task file space, served by
 * Prizmanyx (cloud-workspaces contract — local adapter today, ACI/ECS mounts
 * later behind the same API). All requests go through the fork server's
 * same-origin /pzx proxy with the program-bound capability token from
 * prizmanyx-context; "This task" scopes to the fork's own active conversation.
 * No context (standalone fork without the Prizmanyx console ever opened, or an
 * expired token) degrades to an honest explanatory empty state.
 */

import {
  getActiveConversationId,
  getPzxContext,
  onPzxContextChange,
} from '../utils/prizmanyx-context.js';

/** @param {string} value @returns {string} */
function esc(value) {
  const div = document.createElement('div');
  div.textContent = value;
  return div.innerHTML;
}

/** @param {number} bytes @returns {string} */
function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

class FacetWorkspacePane extends HTMLElement {
  constructor() {
    super();
    /** @type {'task'|'shared'} */
    this._scope = 'task';
    /** @type {Array<{name: string, size: number}>|null} */
    this._files = null;
    this._error = '';
    this._busy = false;
    /** @type {(() => void)|null} */
    this._unsubscribe = null;
  }

  connectedCallback() {
    this._unsubscribe = onPzxContextChange(() => void this._load());
    void this._load();
  }

  disconnectedCallback() {
    this._unsubscribe?.();
    this._unsubscribe = null;
  }

  /** Re-fetch when the pane becomes visible (tab switch). */
  refresh() {
    void this._load();
  }

  /** @returns {{base: string, task: string, token: string}|null} */
  _target() {
    const context = getPzxContext();
    if (!context) return null;
    const active = getActiveConversationId();
    const task = this._scope === 'task' && active ? active : 'shared';
    return {
      base: `/pzx/api/v1/programs/${context.programId}/workspace/files`,
      task,
      token: context.token,
    };
  }

  async _load() {
    const target = this._target();
    if (!target) {
      this._files = null;
      this._error = '';
      this._render();
      return;
    }
    try {
      const response = await fetch(
        `${target.base}?task=${encodeURIComponent(target.task)}&t=${encodeURIComponent(target.token)}`
      );
      const body = await response.json().catch(() => null);
      if (response.ok && body && Array.isArray(body.files)) {
        this._files = body.files;
        this._error = '';
      } else {
        this._files = null;
        this._error =
          response.status === 401
            ? 'Access token expired — open the Console in Prizmanyx to refresh it.'
            : `Workspace unavailable (HTTP ${response.status})`;
      }
    } catch {
      this._files = null;
      this._error = 'Workspace unreachable — is the Prizmanyx API running?';
    }
    this._render();
  }

  /** @param {FileList|null} list */
  async _upload(list) {
    const target = this._target();
    if (!target || !list || list.length === 0) return;
    this._busy = true;
    this._render();
    try {
      for (const file of Array.from(list)) {
        const response = await fetch(
          `${target.base}/${encodeURIComponent(file.name)}` +
            `?task=${encodeURIComponent(target.task)}&t=${encodeURIComponent(target.token)}`,
          { method: 'PUT', body: file }
        );
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          this._error = body.detail || `Upload failed (HTTP ${response.status})`;
          break;
        }
      }
    } finally {
      this._busy = false;
      await this._load();
    }
  }

  /** @param {string} name */
  async _delete(name) {
    const target = this._target();
    if (!target) return;
    await fetch(
      `${target.base}/${encodeURIComponent(name)}` +
        `?task=${encodeURIComponent(target.task)}&t=${encodeURIComponent(target.token)}`,
      { method: 'DELETE' }
    );
    await this._load();
  }

  _render() {
    const context = getPzxContext();
    if (!context) {
      this.innerHTML = `
        <div class="pzx-pane-empty">
          Workspace files live in Prizmanyx. Open the Console page in Prizmanyx
          once — it hands this window an access token (refreshed while the
          console is open).
        </div>`;
      return;
    }
    const active = getActiveConversationId();
    const files = this._files || [];
    const rows = files
      .map(
        (file) => `
        <li class="pzx-file-row" data-name="${esc(file.name)}">
          <a class="pzx-file-name" href="#" data-action="download" title="Download ${esc(file.name)}">${esc(file.name)}</a>
          <span class="pzx-file-size">${formatSize(file.size)}</span>
          <button type="button" class="pzx-file-delete" data-action="delete"
                  title="Delete" aria-label="Delete ${esc(file.name)}">✕</button>
        </li>`
      )
      .join('');
    this.innerHTML = `
      <div class="pzx-pane-toolbar">
        <button type="button" class="pzx-scope${this._scope === 'task' ? ' is-active' : ''}"
                data-action="scope-task" ${active ? '' : 'disabled'}>
          This task${active ? '' : ' (none active)'}
        </button>
        <button type="button" class="pzx-scope${this._scope === 'shared' ? ' is-active' : ''}"
                data-action="scope-shared">Shared</button>
        <button type="button" class="pzx-upload" data-action="upload" ${this._busy ? 'disabled' : ''}>
          ${this._busy ? 'Uploading…' : '+ Upload'}
        </button>
        <input type="file" multiple hidden>
      </div>
      ${this._error ? `<div class="pzx-pane-error">${esc(this._error)}</div>` : ''}
      ${
        this._files !== null && files.length === 0 && !this._error
          ? `<div class="pzx-pane-empty">Empty — drop documents, notes, or artifacts here;
             they persist per ${this._scope === 'task' ? 'task' : 'engagement'}.</div>`
          : ''
      }
      <ul class="pzx-file-list">${rows}</ul>`;

    const input = /** @type {HTMLInputElement|null} */ (this.querySelector('input[type="file"]'));
    input?.addEventListener('change', () => void this._upload(input.files));
    this.addEventListener('click', this._onClick);
  }

  /** @param {Event} event */
  _onClick = (event) => {
    const button = /** @type {HTMLElement} */ (event.target).closest('[data-action]');
    if (!button) return;
    const action = button.getAttribute('data-action');
    if (action === 'scope-task' || action === 'scope-shared') {
      this._scope = action === 'scope-task' ? 'task' : 'shared';
      void this._load();
    } else if (action === 'upload') {
      /** @type {HTMLInputElement|null} */ (this.querySelector('input[type="file"]'))?.click();
    } else if (action === 'download') {
      event.preventDefault();
      const row = button.closest('.pzx-file-row');
      const name = row?.getAttribute('data-name');
      const target = this._target();
      if (name && target) {
        window.location.href =
          `${target.base}/${encodeURIComponent(name)}` +
          `?task=${encodeURIComponent(target.task)}&t=${encodeURIComponent(target.token)}`;
      }
    } else if (action === 'delete') {
      const name = button.closest('.pzx-file-row')?.getAttribute('data-name');
      if (name) void this._delete(name);
    }
  };
}

customElements.define('facet-workspace-pane', FacetWorkspacePane);
