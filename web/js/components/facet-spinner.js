// Copyright (c) 2026 Julian Storer
// AGPL-3.0-or-later - see LICENSE

/**
 * Facet busy spinner (Prizmanyx) — three prism facets (triangles) orbiting a
 * central point and turning on their own axis: light moving through the prism.
 * Same animation rig as the original spinner — only the artwork changed
 * (owner 2026-07-24: the juggling clubs read as off-brand).
 *
 * Usage:
 *   <facet-spinner></facet-spinner>
 *   <facet-spinner style="--size: 2rem"></facet-spinner>
 *   <facet-spinner style="--size: 1rem; --duration: 1.2s; color: white"></facet-spinner>
 *
 * CSS knobs (set on the host):
 *   --size      — overall diameter         (default 1.5rem)
 *   --duration  — one orbital cycle        (default 1.5s)
 *   color       — facet fill               (inherited from the parent's
 *                                           `color`, so the spinner adapts
 *                                           to the surrounding theme by
 *                                           default)
 *
 * Drawn with `fill: currentColor`, so changing `color` on the host (or any
 * ancestor) recolours the spinner — no extra knob needed.
 *
 * A plain inline <svg> per facet, no <symbol>/<use> indirection — the most
 * portable SVG construct there is (a Firefox 149 viewport bug scattered
 * symbol-referenced shapes off their orbit; see git history).
 */
const FACET_SVG_HTML = `<svg viewBox="-26 -26 52 52" aria-hidden="true"><path fill="currentColor" d="M 0,-23 L 23,17 L -23,17 Z"/></svg>`;

class FacetSpinner extends HTMLElement {
  connectedCallback() {
    if (this.childElementCount === 0) {
      // Three pivot/facet pairs: each pivot rotates around the centre to
      // place its facet on the orbit; each facet rotates on its own axis
      // to give the visible turn. (The .js-club class names stay — they are
      // the animation contract in components.css.)
      this.innerHTML = `
                <span class="js-pivot"><span class="js-club">${FACET_SVG_HTML}</span></span>
                <span class="js-pivot"><span class="js-club">${FACET_SVG_HTML}</span></span>
                <span class="js-pivot"><span class="js-club">${FACET_SVG_HTML}</span></span>
            `;
    }
    if (!this.hasAttribute('role')) this.setAttribute('role', 'status');
    if (!this.hasAttribute('aria-label')) this.setAttribute('aria-label', 'Loading');
  }
}

customElements.define('facet-spinner', FacetSpinner);
