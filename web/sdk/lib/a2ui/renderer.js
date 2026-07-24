// Copyright (c) 2026 Julian Storer
// Apache-2.0 - see LICENSE
// SPDX-License-Identifier: Apache-2.0

/**
 * The A2UI surface renderer: declarative component JSON in, inert DOM out.
 *
 * `renderSurface(surface, callbacks)` walks the surface's **flat adjacency
 * list** (components reference children by id — the v1.0 wire shape) from
 * `rootId` and builds plain DOM via the component catalogs. It is a pure
 * function of its input: no framework, no retained state, no code execution.
 * Guarantees:
 * - **Untrusted-input discipline**: every model-supplied string lands via
 *   `textContent`; URLs are scheme-checked by the catalog builders.
 * - **Graceful degradation** (per spec): an unknown component type, missing
 *   child id, or builder error renders a labeled placeholder box — a broken
 *   component never takes down the surface, and rendering never throws.
 * - **Cycle safety**: the adjacency list is model-supplied, so a child chain
 *   that revisits an ancestor renders a placeholder instead of recursing
 *   forever.
 *
 * Re-rendering: callers rebuild the surface element wholesale when the
 * backing item changes (the ask-user-question form takes the same approach).
 * Incremental DOM diffing is deliberately out of scope at this stage.
 * @module a2ui/renderer
 */

import { resolveValue, toText } from './data-model.js';
import { BASIC_CATALOG } from './catalog-basic.js';
import { VIZ_CATALOG } from './catalog-viz.js';

/**
 * The union the renderer draws from. Surfaces declare a `catalogId`, but v1
 * renders the union regardless — the id is stored and reported, enforcement
 * (refusing components outside the declared catalog) is deferred until
 * cross-implementation conformance requires it.
 * @type {Record<string, (def: ComponentDef, ctx: RenderContext) => HTMLElement>}
 */
const COMPONENTS = { ...BASIC_CATALOG, ...VIZ_CATALOG };

/**
 * A component definition normalized to the renderer's canonical shape.
 * @typedef {object} ComponentDef
 * @property {string} id - Unique component id within the surface
 * @property {string} type - Catalog component type (e.g. 'Text', 'Row')
 * @property {Record<string, unknown>} props - Component properties (bindings unresolved)
 * @property {string[]} children - Child component ids (empty when none)
 * @property {Record<string, unknown>|undefined} action - Declared action payload, if interactive
 */

/**
 * The per-render context handed to catalog builders.
 * @typedef {object} RenderContext
 * @property {(value: unknown) => unknown} resolve - Resolve a property value (literal or data binding)
 * @property {(value: unknown) => string} text - Resolve then convert to display text
 * @property {(def: ComponentDef, parent: HTMLElement, wrap?: (child: HTMLElement) => HTMLElement) => void} renderChildren - Render a def's children into parent (optionally wrapping each)
 * @property {(def: ComponentDef, sourceElement?: HTMLElement) => void} dispatchAction - Dispatch a component's action through the surface callbacks
 */

/**
 * Callbacks a host passes to receive surface interactions.
 * @typedef {object} SurfaceCallbacks
 * @property {(info: {surfaceId: string, componentId: string, action: Record<string, unknown>, sourceElement?: HTMLElement}) => void} [onAction] - Invoked when an interactive component fires its action; sourceElement is the live DOM node for immediate visual feedback
 */

/**
 * A surface's renderable state (the plain-object projection of the
 * `a2ui-surface` item — increment 2 wires the Yjs item to this shape).
 * @typedef {object} SurfaceState
 * @property {string} surfaceId - Stable surface id
 * @property {string} rootId - Id of the component to render as the root
 * @property {Record<string, object>|object[]} components - Flat adjacency list (map keyed by id, or array of defs)
 * @property {Record<string, unknown>} [dataModel] - The surface's data model
 */

/**
 * Normalize one raw component definition to {@link ComponentDef}. Accepts the
 * renderer's canonical shape (`{id, type, props, children}`) and the A2UI
 * wire shape (`{id, component: {<Type>: {...props}}}`). Children may be a
 * plain id array or the `{explicitList: [...]}` wrapper; both normalize to a
 * string array. This function is the single seam where wire-format fidelity
 * gets tightened as conformance testing against the reference renderer
 * proceeds (see the design doc).
 * @param {any} raw - A raw component definition
 * @returns {ComponentDef|null} The normalized definition, or null when unrecognizable
 */
export function normalizeComponent(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string') return null;
  let type = '';
  /** @type {Record<string, unknown>} */
  let props = {};
  if (typeof raw.type === 'string') {
    type = raw.type;
    props = (raw.props && typeof raw.props === 'object') ? { ...raw.props } : {};
  } else if (raw.component && typeof raw.component === 'object') {
    // Wire shape: the single key of `component` is the type, its value the props.
    const keys = Object.keys(raw.component);
    if (keys.length !== 1) return null;
    type = keys[0];
    const inner = raw.component[type];
    props = (inner && typeof inner === 'object') ? { ...inner } : {};
  } else {
    return null;
  }
  const rawChildren = /** @type {any} */ (props.children ?? raw.children);
  delete props.children;
  /** @type {string[]} */
  let children = [];
  if (Array.isArray(rawChildren)) {
    children = rawChildren.filter(c => typeof c === 'string');
  } else if (rawChildren && typeof rawChildren === 'object' && Array.isArray(rawChildren.explicitList)) {
    children = rawChildren.explicitList.filter((/** @type {unknown} */ c) => typeof c === 'string');
  }
  const action = (props.action && typeof props.action === 'object')
    ? /** @type {Record<string, unknown>} */ (props.action)
    : undefined;
  delete props.action;
  return { id: raw.id, type, props, children, action };
}

/**
 * Build the id → normalized-definition index for a surface's component list
 * (which may arrive as a map keyed by id or as an array of defs).
 * @param {Record<string, object>|object[]} components - Raw component list
 * @returns {Map<string, ComponentDef>} Normalized defs keyed by id
 */
function indexComponents(components) {
  /** @type {Map<string, ComponentDef>} */
  const index = new Map();
  const list = Array.isArray(components)
    ? components
    : Object.entries(components || {}).map(([id, def]) => ({ id, .../** @type {object} */ (def) }));
  for (const raw of list) {
    const def = normalizeComponent(raw);
    if (def) index.set(def.id, def);
  }
  return index;
}

/**
 * Build a labeled placeholder box — the spec's graceful-degradation path for
 * anything the renderer cannot draw. The label is developer-facing
 * diagnostics, rendered as text.
 * @param {string} label - Why this box exists (e.g. `Unknown component "Video"`)
 * @returns {HTMLElement} The placeholder element
 */
function placeholder(label) {
  const el = document.createElement('div');
  el.className = 'a2ui-placeholder';
  el.textContent = label;
  return el;
}

/**
 * Render a surface to a detached DOM element.
 * @param {SurfaceState} surface - The surface state to render
 * @param {SurfaceCallbacks} [callbacks] - Interaction callbacks
 * @returns {HTMLElement} The rendered surface root (class `a2ui-surface`)
 */
export function renderSurface(surface, callbacks = {}) {
  const root = document.createElement('div');
  root.className = 'a2ui-surface';
  const index = indexComponents(surface?.components ?? {});
  const dataModel = surface?.dataModel ?? {};

  /**
   * Render one component by id. `ancestors` carries the id chain of the
   * current branch: a repeated id means the model supplied a cyclic
   * adjacency list, which must degrade to a placeholder rather than recurse.
   * @param {string} id - Component id to render
   * @param {Set<string>} ancestors - Ids already on this render branch
   * @returns {HTMLElement} The rendered element or a placeholder
   */
  const renderComponent = (id, ancestors) => {
    const def = index.get(id);
    if (!def) return placeholder(`Missing component "${id}"`);
    if (ancestors.has(id)) return placeholder(`Cyclic component reference "${id}"`);
    const builder = COMPONENTS[def.type];
    if (!builder) return placeholder(`Unsupported component "${def.type}"`);

    const branch = new Set(ancestors).add(id);
    /** @type {RenderContext} */
    const ctx = {
      resolve: value => resolveValue(value, { dataModel }),
      text: value => toText(resolveValue(value, { dataModel })),
      renderChildren: (parentDef, parentEl, wrap) => {
        for (const childId of parentDef.children) {
          const child = renderComponent(childId, branch);
          parentEl.appendChild(wrap ? wrap(child) : child);
        }
      },
      dispatchAction: (actionDef, sourceElement) => {
        if (!callbacks.onAction) return;
        callbacks.onAction({
          surfaceId: surface.surfaceId,
          componentId: actionDef.id,
          action: actionDef.action ?? {},
          sourceElement
        });
      }
    };

    try {
      const el = builder(def, ctx);
      // Tag every component's root element with its id so hosts can address
      // rendered components (busy overlays, response badges, tests).
      el.dataset.a2uiId = def.id;
      return el;
    } catch (e) {
      return placeholder(`Component "${def.type}" failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  root.appendChild(
    surface?.rootId
      ? renderComponent(surface.rootId, new Set())
      : placeholder('Surface has no rootId')
  );
  return root;
}
