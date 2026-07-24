// Copyright (c) 2026 Julian Storer
// Apache-2.0 - see LICENSE
// SPDX-License-Identifier: Apache-2.0

/**
 * A2UI motion — the three declarative tiers from the design doc, implemented
 * entirely as CSS classes + injected keyframes:
 *
 * 1. **Value motion**: components whose bound values changed since the last
 *    repaint get `.a2ui-value-changed` (a brief highlight pulse). Because a
 *    repaint rebuilds the surface DOM wholesale, re-adding the class
 *    restarts the animation naturally on every change.
 * 2. **Entry**: a component with `animate: {enter: 'fade'|'slide'|'grow'}`
 *    gets `.a2ui-enter-<kind>` on its FIRST appearance only (per surface,
 *    per component — tracked in viewer-transient module state, the same
 *    pattern as action pending state).
 * 3. **Ambient**: `.a2ui-edge-flow` (marching dashes on diagram edges) and
 *    `.a2ui-pulse` (status heartbeat via `pulse: true` on diagram nodes),
 *    plus a subtle pulse on `.a2ui-action-pending` controls.
 *
 * Every keyframe rule lives inside `@media (prefers-reduced-motion:
 * no-preference)`, so reduced-motion users get a static (but complete) UI
 * with no JS branching — class presence is inert when the media query
 * doesn't match. No `el.animate`, no timers.
 * @module a2ui/motion
 */

/** The id of the injected style element (idempotence marker). */
const STYLE_ID = 'a2ui-motion-styles';

/**
 * Per-surface motion memory: which components have already entered (so entry
 * animations fire once) and the last-seen data model (so value changes can
 * be diffed). Viewer-transient by design — a reload replays entries, which
 * is the desired "surface appears" experience.
 * @type {Map<string, {seen: Set<string>, lastModelJson: string}>}
 */
const SURFACE_MOTION = new Map();

/**
 * Inject the motion stylesheet once per document.
 * @returns {void}
 */
export function ensureMotionStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
@media (prefers-reduced-motion: no-preference) {
  @keyframes a2ui-value-changed { 0% { filter: brightness(1.6); } 100% { filter: brightness(1); } }
  .a2ui-value-changed { animation: a2ui-value-changed 400ms ease-out; }

  @keyframes a2ui-enter-fade { from { opacity: 0; } to { opacity: 1; } }
  .a2ui-enter-fade { animation: a2ui-enter-fade 250ms ease-out; }
  @keyframes a2ui-enter-slide { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
  .a2ui-enter-slide { animation: a2ui-enter-slide 250ms ease-out; }
  @keyframes a2ui-enter-grow { from { opacity: 0; transform: scale(0.92); } to { opacity: 1; transform: none; } }
  .a2ui-enter-grow { animation: a2ui-enter-grow 250ms ease-out; }

  @keyframes a2ui-flow { to { stroke-dashoffset: -20; } }
  .a2ui-edge-flow { animation: a2ui-flow 1.2s linear infinite; }

  @keyframes a2ui-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.45; } }
  .a2ui-pulse { animation: a2ui-pulse 1.6s ease-in-out infinite; }
  .a2ui-action-pending { animation: a2ui-pulse 1.6s ease-in-out infinite; }
}
`;
  document.head.appendChild(style);
}

/**
 * The JSON Pointer paths at which two data models differ (added, removed, or
 * changed leaves; a changed subtree reports the shallowest differing path).
 * @param {unknown} oldModel - Previous data model
 * @param {unknown} newModel - Current data model
 * @returns {Set<string>} Changed pointer paths (e.g. "/stats/cpu")
 */
export function diffChangedPaths(oldModel, newModel) {
  /** @type {Set<string>} */
  const changed = new Set();
  const walk = (/** @type {unknown} */ a, /** @type {unknown} */ b, /** @type {string} */ path) => {
    if (a === b) return;
    const aObj = a !== null && typeof a === 'object';
    const bObj = b !== null && typeof b === 'object';
    if (!aObj || !bObj) {
      changed.add(path || '/');
      return;
    }
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
      const token = k.replace(/~/g, '~0').replace(/\//g, '~1');
      walk(
        /** @type {Record<string, unknown>} */ (a)[k],
        /** @type {Record<string, unknown>} */ (b)[k],
        `${path}/${token}`
      );
    }
  };
  walk(oldModel ?? {}, newModel ?? {}, '');
  return changed;
}

/**
 * Every absolute pointer path a component's props bind to (deep walk over
 * `{path: ...}` nodes; relative collection-scope paths are skipped — they
 * cannot be attributed without template context).
 * @param {{props?: Record<string, unknown>}} def - A component definition
 * @returns {string[]} Absolute bound paths
 */
export function componentBoundPaths(def) {
  /** @type {string[]} */
  const paths = [];
  const walk = (/** @type {unknown} */ node) => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (node !== null && typeof node === 'object') {
      const p = /** @type {Record<string, unknown>} */ (node).path;
      if (typeof p === 'string' && p.startsWith('/')) paths.push(p);
      Object.values(node).forEach(walk);
    }
  };
  walk(def.props || {});
  return paths;
}

/**
 * Does a bound path overlap a changed path (either containing the other)?
 * A component bound to `/stats` must pulse when `/stats/cpu` changes, and a
 * component bound to `/stats/cpu` must pulse when all of `/stats` was
 * replaced.
 * @param {string} bound - A component's bound path
 * @param {Set<string>} changed - Changed paths from diffChangedPaths
 * @returns {boolean} True when the binding is affected
 */
export function pathAffected(bound, changed) {
  for (const c of changed) {
    if (c === '/' || bound === c || bound.startsWith(`${c}/`) || c.startsWith(`${bound}/`)) return true;
  }
  return false;
}

/**
 * Apply the motion tiers to a freshly rendered surface element. Called by
 * the card on every repaint, AFTER renderSurface.
 * @param {HTMLElement} surfaceEl - The rendered surface root
 * @param {{surfaceId: string, components: Record<string, any>, dataModel: unknown}} surface - Surface state
 * @returns {void}
 */
export function applyMotion(surfaceEl, surface) {
  ensureMotionStyles();
  let memory = SURFACE_MOTION.get(surface.surfaceId);
  const firstPaint = !memory;
  if (!memory) {
    memory = { seen: new Set(), lastModelJson: '' };
    SURFACE_MOTION.set(surface.surfaceId, memory);
  }

  /** @type {unknown} */
  let lastModel = {};
  try {
    lastModel = memory.lastModelJson ? JSON.parse(memory.lastModelJson) : {};
  } catch {
    lastModel = {};
  }
  const changed = firstPaint ? new Set() : diffChangedPaths(lastModel, surface.dataModel ?? {});
  try {
    memory.lastModelJson = JSON.stringify(surface.dataModel ?? {});
  } catch {
    memory.lastModelJson = '';
  }

  for (const [id, def] of Object.entries(surface.components || {})) {
    const el = /** @type {HTMLElement|null} */ (surfaceEl.querySelector(`[data-a2ui-id="${CSS.escape(id)}"]`));
    if (!el) continue;

    // Tier 2 — entry, first appearance only.
    const enter = def?.props?.animate?.enter;
    if (!memory.seen.has(id)) {
      memory.seen.add(id);
      if (typeof enter === 'string' && ['fade', 'slide', 'grow'].includes(enter)) {
        el.classList.add(`a2ui-enter-${enter}`);
      }
    }

    // Tier 1 — value motion on changed bindings (skip on first paint; entry
    // covers it, and everything "changed" from nothing).
    if (!firstPaint && changed.size &&
        componentBoundPaths(def).some(p => pathAffected(p, changed))) {
      el.classList.add('a2ui-value-changed');
    }
  }

  // Tier 3 — diagram node heartbeat: nodes are rendered inside a component,
  // not as components, so they are tagged here by their declared pulse flag.
  for (const def of Object.values(surface.components || {})) {
    const nodes = def?.props?.nodes;
    if (!Array.isArray(nodes)) continue;
    for (const n of nodes) {
      if (n && n.pulse === true && typeof n.id === 'string') {
        const nodeEl = surfaceEl.querySelector(`[data-node-id="${CSS.escape(n.id)}"]`);
        nodeEl?.classList.add('a2ui-pulse');
      }
    }
  }
}

/**
 * Forget a surface's motion memory. Called when a deleted surface's card
 * renders, so a later recreation under the same id replays entry animations.
 * @param {string} surfaceId - The surface id
 * @returns {void}
 */
export function resetMotion(surfaceId) {
  SURFACE_MOTION.delete(surfaceId);
}
