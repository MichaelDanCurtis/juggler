// Prizmanyx fork — native Browser pane (gateway browsing).
// AGPL-3.0-or-later - see LICENSE

/**
 * The panel's BROWSER tab: view a URL AS THE PRIZMANYX SERVER sees it. The
 * fork's /pzx proxy forwards to Prizmanyx's gateway routes, which fetch the
 * target server-side, strip scripts, and rewrite every URL back through the
 * gateway — so the network sees a requestor inside the deployment, and a
 * consultant on a locked-down link can eyeball internal apps. Renders static
 * by design (the response carries its own script-blocking CSP; the iframe adds
 * a no-scripts sandbox as the second lock). App paths ("/discovery") resolve
 * against the Prizmanyx web origin and go through the same gateway.
 */

import { getPzxContext, onPzxContextChange } from '../utils/prizmanyx-context.js';

/** @param {string} value @returns {string} */
function esc(value) {
  const div = document.createElement('div');
  div.textContent = value;
  return div.innerHTML;
}

class FacetBrowserPane extends HTMLElement {
  constructor() {
    super();
    this._address = '';
    this._viewSrc = '';
    /** @type {(() => void)|null} */
    this._unsubscribe = null;
  }

  connectedCallback() {
    this._unsubscribe = onPzxContextChange(() => this._render());
    this._render();
  }

  disconnectedCallback() {
    this._unsubscribe?.();
    this._unsubscribe = null;
  }

  refresh() {
    this._render();
  }

  /** @param {string} input */
  _go(input) {
    const context = getPzxContext();
    const raw = input.trim();
    if (!context || raw === '') return;
    let target = raw;
    if (raw.startsWith('/')) {
      target = context.webBase.replace(/\/$/, '') + raw; // Prizmanyx app path
    } else if (!/^https?:\/\//i.test(raw)) {
      target = `https://${raw}`;
    }
    this._address = raw;
    this._viewSrc =
      `/pzx/api/v1/programs/${context.programId}/gateway/view` +
      `?url=${encodeURIComponent(target)}&t=${encodeURIComponent(context.token)}`;
    this._render();
  }

  _render() {
    const context = getPzxContext();
    if (!context) {
      this.innerHTML = `
        <div class="pzx-pane-empty">
          The gateway browser fetches pages THROUGH the Prizmanyx server, so
          internal apps only the server can reach are viewable here. Open the
          Console page in Prizmanyx once to hand this window an access token.
        </div>`;
      return;
    }
    this.innerHTML = `
      <div class="pzx-pane-toolbar">
        <input class="pzx-address" type="text" spellcheck="false"
               placeholder="/discovery  or  https://internal.app/health"
               aria-label="Address — app path or full URL"
               value="${esc(this._address)}">
        <button type="button" class="pzx-go" data-action="go">Go</button>
      </div>
      <div class="pzx-pane-status">● via gateway · fetched by the Prizmanyx server · static render</div>
      ${
        this._viewSrc
          ? `<iframe class="pzx-browser-frame" src="${esc(this._viewSrc)}"
                     sandbox="allow-same-origin" title="Gateway"></iframe>`
          : `<div class="pzx-pane-empty">Enter an app path or any URL — the request
             will originate from the Prizmanyx server, not this browser.</div>`
      }`;
    const input = /** @type {HTMLInputElement|null} */ (this.querySelector('.pzx-address'));
    input?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') this._go(input.value);
    });
    this.querySelector('[data-action="go"]')?.addEventListener('click', () => {
      if (input) this._go(input.value);
    });
  }
}

customElements.define('facet-browser-pane', FacetBrowserPane);
