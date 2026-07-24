//     ▄▄ ▄▄ ▄▄  ▄▄▄▄  ▄▄▄▄ ▄▄    ▄▄▄▄▄ ▄▄▄▄
//     ██ ██ ██ ██ ▄▄ ██ ▄▄ ██    ██▄▄  ██▄█▄   Copyright (c) 2026 Julian Storer
//   ▄▄█▀ ▀███▀ ▀███▀ ▀███▀ ██▄▄▄ ██▄▄▄ ██ ██   Apache-2.0 - see LICENSE
// SPDX-License-Identifier: Apache-2.0

/**
 * Facet Extension SDK — A2UI (https://a2ui.org) declarative UI rendering.
 *
 * Declarative component JSON in, inert DOM out: extensions describe UI as an
 * A2UI surface (a flat adjacency list of components plus a JSON-Pointer-bound
 * data model) instead of hand-rolling DOM. The renderer enforces the A2UI
 * trust story — every string lands via `textContent`, URLs are
 * scheme-checked, unknown/cyclic/broken components degrade to labeled
 * placeholders, and rendering never throws.
 *
 * ## Quick start
 *
 * ```javascript
 * import { renderSurface } from 'facet/a2ui';
 *
 * const el = renderSurface({
 *   surfaceId: 'demo',
 *   rootId: 'root',
 *   components: {
 *     root:  { id: 'root', type: 'Column', children: ['title', 'value'] },
 *     title: { id: 'title', type: 'Text', props: { text: 'CPU' } },
 *     value: { id: 'value', type: 'Metric', props: { label: 'now', value: { path: '/cpu' } } }
 *   },
 *   dataModel: { cpu: '42%' }
 * }, {
 *   onAction: info => console.log('clicked', info.componentId)
 * });
 * someContainer.appendChild(el);
 * ```
 *
 * Component vocabulary: the basic catalog (Text, Row, Column, Card, List,
 * Divider, Image, Button) plus the viz catalog (Chart, Metric, Diagram with
 * the named symbol library — see `SYMBOL_NAMES`). Prop values are literals or
 * `{path: '/json/pointer'}` bindings into the surface's `dataModel`.
 *
 * Motion: call `applyMotion(el, surface)` after each re-render to get the
 * three declarative tiers (value-change pulses, one-shot entry animations,
 * ambient flow/heartbeat) — all CSS-driven and automatically inert under
 * `prefers-reduced-motion`.
 *
 * All named exports of this facade are covered by the `engineApi` version
 * promise (see `facet/version`). The `@facet/a2ui` extension builds its
 * surface tools on exactly this surface — it is the reference consumer.
 *
 * This module is worker-safe: nothing touches the DOM at import time, so the
 * engine can import it (rendering functions are only callable where a
 * `document` exists).
 * @module facet/a2ui
 */

export { renderSurface, normalizeComponent } from './lib/a2ui/renderer.js';
export { BASIC_CATALOG } from './lib/a2ui/catalog-basic.js';
export { VIZ_CATALOG } from './lib/a2ui/catalog-viz.js';
export { buildSymbol, svgEl, SYMBOL_NAMES } from './lib/a2ui/symbols.js';
export {
  parsePointer, getByPointer, setByPointer, resolveBoundValue, resolveValue, toText
} from './lib/a2ui/data-model.js';
export {
  ensureMotionStyles, applyMotion, resetMotion,
  diffChangedPaths, componentBoundPaths, pathAffected
} from './lib/a2ui/motion.js';
