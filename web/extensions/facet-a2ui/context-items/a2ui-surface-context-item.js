// Copyright (c) 2026 Julian Storer
// Apache-2.0 - see LICENSE
// SPDX-License-Identifier: Apache-2.0

import ContextItem from 'facet/context-item';
import { createItem } from 'facet/registry';
import {
  renderSurface, setByPointer, SYMBOL_NAMES, applyMotion, resetMotion
} from 'facet/a2ui';
import {
  formatActionMessage, resolveActionContext, registerDispatch, clearPending,
  pendingFor, reconcileResponses, RESPONSE_TIMEOUT_MS
} from '../a2ui/actions.js';

/** Bound on stored action responses per surface (oldest pruned first). */
const MAX_ACTION_RESPONSES = 5;

/**
 * A2UI surfaces — agent-driven declarative UI rendered natively in the
 * conversation (protocol: https://a2ui.org; full approved design:
 * `scratch/a2ui/design.md`).
 *
 * One class fronts the whole tool suite (the MCP-bridge one-class/many-tools
 * pattern, dispatching on `this.toolName`):
 *
 * | Tool | Effect |
 * |---|---|
 * | `a2ui_create_surface` | Create (or replace) a surface item |
 * | `a2ui_update_components` | Upsert components by id on a surface |
 * | `a2ui_update_data_model` | Upsert data at a JSON Pointer (or replace all) |
 * | `a2ui_delete_surface` | Tombstone a surface |
 *
 * A surface is a **standalone context item** (`type: 'a2ui-surface'`) whose
 * whole state lives under the standard `data` key — so every write goes
 * through the sanctioned `addContextItem`/`updateContextItem` upsert path
 * (the plan plugin's pattern) and no new Yjs invariants exist. The item
 * outlives the tool calls that shaped it: later turns mutate the same item,
 * every client re-renders live, and undo/redo work item-wise for free.
 *
 * Increment 3 (next) adds the `a2ui-action` item type: `_handleAction` below
 * currently swallows interactions; it will append an action event that starts
 * an agent turn (fire-and-forget) or resolves a `wantResponse` pending state.
 * @augments ContextItem
 */
class A2uiSurfaceContextItem extends ContextItem {
  static MANIFEST = {
    id: 'a2ui-surface',
    name: 'A2UI Surfaces',
    version: '0.2.0',
    description: 'Agent-driven interactive UI surfaces (A2UI protocol) rendered natively in the conversation',
    author: 'Facet Team',
    requiresApproval: true
  };

  /** @returns {string} Short type label shown on item cards and the permissions popup */
  static getTypeName() {
    return 'A2UI';
  }

  /**
   * The component vocabulary the renderer supports today, enumerated in the
   * tool descriptions so the model never emits a component we cannot draw
   * (unknowns degrade to placeholder boxes, but why invite that).
   */
  static SUPPORTED_COMPONENTS = 'Text, Row, Column, Card, List, Divider, Image, Button, Chart, Metric, Diagram';

  /**
   * Shared schema fragment for a component definition list.
   * @returns {object} JSON schema for a components array
   */
  static componentsSchema() {
    return {
      type: 'array',
      minItems: 1,
      description: 'Flat adjacency list of component definitions. Each entry: '
        + '{id, type, props?, children?: [child ids]}. Types: '
        + `${A2uiSurfaceContextItem.SUPPORTED_COMPONENTS}. `
        + 'Prop values are literals or {"path": "/json/pointer"} bindings into the dataModel. '
        + 'Text: props.text; Image: props.url (+alt); Button: props.label and props.action '
        + '(an arbitrary action payload delivered back when clicked; {"event": {"name": ..., '
        + '"context": ..., "wantResponse": bool}}). '
        + 'Chart: props.chartType (line|area|bar|scatter|pie|sparkline), props.data '
        + '(number array, or object array with props.series naming value keys and props.x the label key), props.title. '
        + 'Metric: props.label, props.value, props.delta (number), props.spark (number array). '
        + 'Diagram: props.nodes [{id, symbol, label, status: ok|warn|error|off, x?, y? (0-100)}], '
        + 'props.edges [{from, to, label?, style?, flow?}]; node symbols: '
        + `${SYMBOL_NAMES.join(', ')}. Nodes may carry an action like Button. `
        + 'Bind Chart/Metric data via {"path": ...} and stream updates with a2ui_update_data_model. '
        + 'Children reference other components by id — never nest definitions.',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Unique component id within the surface' },
          type: { type: 'string', description: 'Component type (see list above)' },
          props: { type: 'object', description: 'Component properties; values may be {"path": ...} bindings' },
          children: { type: 'array', items: { type: 'string' }, description: 'Child component ids' }
        },
        required: ['id', 'type']
      }
    };
  }

  /**
   * Tool definitions for the A2UI surface suite.
   * @returns {Array<{name: string, category: string, description: string, input_schema: object}>} Tool definitions
   */
  static getToolDefinitions() {
    const surfaceId = { type: 'string', description: 'Target surface id (from a2ui_create_surface)' };
    return [
      {
        name: 'a2ui_create_surface',
        category: 'write',
        description: 'Create (or wholly replace) an interactive UI surface rendered inline in the '
          + 'conversation — dashboards, status cards, structured layouts. The surface persists '
          + 'across turns; mutate it later with a2ui_update_components / a2ui_update_data_model.',
        input_schema: {
          type: 'object',
          properties: {
            surfaceId: { type: 'string', description: 'Stable surface id; minted when omitted' },
            catalogId: { type: 'string', description: 'Component catalog; default "a2ui.org/basic"' },
            rootId: { type: 'string', description: 'Id of the root component to render' },
            components: A2uiSurfaceContextItem.componentsSchema(),
            dataModel: { type: 'object', description: 'Initial data model; components bind into it via {"path": "/x"}' }
          },
          required: ['rootId', 'components']
        }
      },
      {
        name: 'a2ui_update_components',
        category: 'write',
        description: 'Add or replace components (matched by id) on an existing A2UI surface. '
          + 'Unmentioned components are untouched.',
        input_schema: {
          type: 'object',
          properties: { surfaceId, components: A2uiSurfaceContextItem.componentsSchema() },
          required: ['surfaceId', 'components']
        }
      },
      {
        name: 'a2ui_update_data_model',
        category: 'write',
        description: 'Upsert an A2UI surface\'s data model at a JSON Pointer path. Bound components '
          + 're-render live — use this to stream new values into charts, text, and lists.',
        input_schema: {
          type: 'object',
          properties: {
            surfaceId,
            path: { type: 'string', description: 'RFC 6901 JSON Pointer (e.g. "/stats/cpu"); omit to replace the whole model' },
            value: { description: 'The value to write at path (any JSON; an object when path is omitted)' }
          },
          required: ['surfaceId', 'value']
        }
      },
      {
        name: 'a2ui_delete_surface',
        category: 'write',
        description: 'Remove an A2UI surface from view (tombstoned in history).',
        input_schema: {
          type: 'object',
          properties: { surfaceId },
          required: ['surfaceId']
        }
      },
      {
        name: 'a2ui_respond_action',
        category: 'write',
        description: 'Answer a pending A2UI action. When a "[A2UI action]" message carries an '
          + 'actionId, the user\'s control is waiting on this call — pass the actionId with a '
          + 'result value, or an error message when the action cannot be honored.',
        input_schema: {
          type: 'object',
          properties: {
            surfaceId,
            actionId: { type: 'string', description: 'The actionId from the "[A2UI action]" message' },
            value: { description: 'The action\'s result (any JSON); omit when reporting an error' },
            error: { type: 'string', description: 'Why the action failed, when it did' }
          },
          required: ['surfaceId', 'actionId']
        }
      }
    ];
  }

  // ── Approval ──────────────────────────────────────────────────────────────

  /**
   * @override
   * @returns {string} The itemType all A2UI approval rules live under
   */
  getPermissionKey() {
    return 'a2ui-surface';
  }

  /**
   * Auto-approve when the user granted the blanket A2UI rule. There is only
   * one grant breadth ("all A2UI rendering") because the tools differ only in
   * which part of a surface they touch, not in risk.
   * @override
   * @param {Record<string, unknown>} _toolInput - Tool input (unused)
   * @returns {boolean} True when a persisted grant covers A2UI rendering
   */
  isPermitted(_toolInput) {
    const mt = this.messageThread;
    if (!mt) return false;
    return mt.getRulesFor('a2ui-surface').some(
      (/** @type {{kind: string, value: unknown}} */ r) => r.kind === 'glob' && String(r.value) === '*'
    );
  }

  /**
   * One "don't ask again" choice: allow all A2UI surface rendering.
   * @override
   * @param {Record<string, unknown>} _toolInput - Tool input (unused)
   * @returns {import('facet/context-item').ApprovalSuggestion[]} Suggestions
   */
  getApprovalSuggestions(_toolInput) {
    return [{
      itemType: 'a2ui-surface',
      rules: [{ kind: 'glob', value: '*' }],
      label: 'all A2UI surface rendering'
    }];
  }

  /**
   * Approval dialog: say which operation on which surface, with the payload.
   * @override
   * @param {Record<string, unknown>} params - Validated params
   * @returns {Promise<import('facet/context-item').ApprovalConfig|null>} Approval config
   */
  async getApprovalConfig(params) {
    const titles = {
      a2ui_create_surface: 'Render a UI surface',
      a2ui_update_components: 'Update a UI surface',
      a2ui_update_data_model: 'Update UI surface data',
      a2ui_delete_surface: 'Remove a UI surface',
      a2ui_respond_action: 'Answer a UI action'
    };
    let payload = '';
    try {
      payload = JSON.stringify(params ?? {}, null, 2);
    } catch {
      payload = String(params);
    }
    return {
      title: titles[/** @type {keyof titles} */ (this.toolName)] || 'A2UI operation',
      message: payload
    };
  }

  // ── Validation ────────────────────────────────────────────────────────────

  /**
   * Validate and normalize parameters per tool.
   * @override
   * @param {Record<string, unknown>} toolInput - Raw parameters from the LLM
   * @returns {Promise<import('facet/context-item').ValidationResult>} Validation result
   */
  async validate(toolInput) {
    const p = /** @type {any} */ (toolInput);
    const needSurfaceId = () =>
      (!p.surfaceId || typeof p.surfaceId !== 'string')
        ? { valid: false, error: 'Missing required parameter: surfaceId' }
        : null;
    const needComponents = () => {
      if (!Array.isArray(p.components) || p.components.length === 0) {
        return { valid: false, error: 'components must be a non-empty array of {id, type, ...} definitions' };
      }
      for (const [i, c] of p.components.entries()) {
        if (!c || typeof c !== 'object' || typeof c.id !== 'string' || !c.id) {
          return { valid: false, error: `components[${i}]: missing string id` };
        }
        if (typeof c.type !== 'string' && (!c.component || typeof c.component !== 'object')) {
          return { valid: false, error: `components[${i}] ("${c.id}"): missing type` };
        }
      }
      return null;
    };

    switch (this.toolName) {
      case 'a2ui_create_surface': {
        if (!p.rootId || typeof p.rootId !== 'string') {
          return { valid: false, error: 'Missing required parameter: rootId' };
        }
        const bad = needComponents();
        if (bad) return bad;
        if (p.dataModel !== undefined && (p.dataModel === null || typeof p.dataModel !== 'object' || Array.isArray(p.dataModel))) {
          return { valid: false, error: 'dataModel must be an object' };
        }
        return { valid: true, params: toolInput };
      }
      case 'a2ui_update_components':
        return needSurfaceId() || needComponents() || { valid: true, params: toolInput };
      case 'a2ui_update_data_model': {
        const bad = needSurfaceId();
        if (bad) return bad;
        if (p.value === undefined) {
          return { valid: false, error: 'Missing required parameter: value' };
        }
        // Omitted/empty path replaces the whole model, which must stay an object.
        if (p.path === undefined || p.path === '') {
          if (p.value === null || typeof p.value !== 'object' || Array.isArray(p.value)) {
            return { valid: false, error: 'Replacing the whole dataModel (no path) requires an object value' };
          }
        } else if (typeof p.path !== 'string' || !p.path.startsWith('/')) {
          return { valid: false, error: 'path must be an RFC 6901 JSON Pointer starting with "/"' };
        }
        return { valid: true, params: toolInput };
      }
      case 'a2ui_delete_surface':
        return needSurfaceId() || { valid: true, params: toolInput };
      case 'a2ui_respond_action': {
        const bad = needSurfaceId();
        if (bad) return bad;
        if (!p.actionId || typeof p.actionId !== 'string') {
          return { valid: false, error: 'Missing required parameter: actionId' };
        }
        return { valid: true, params: toolInput };
      }
      default:
        return { valid: false, error: `Unknown A2UI tool "${this.toolName}"` };
    }
  }

  // ── Execution ─────────────────────────────────────────────────────────────

  /**
   * The deterministic item id for a surface. Deterministic ids make
   * `addContextItem` (an itemId-keyed upsert) the natural create-or-replace
   * primitive and let every tool find the item without scanning.
   * @param {string} surfaceId - The surface id
   * @returns {string} The context item id
   */
  static itemIdFor(surfaceId) {
    return `A2UI_${surfaceId}`;
  }

  /**
   * Find the live surface item wrapper, or null.
   * @param {string} surfaceId - The surface id
   * @returns {import('facet/context-item').default|null} The context item instance
   */
  _findSurface(surfaceId) {
    const item = this.messageThread?.getContextItem(A2uiSurfaceContextItem.itemIdFor(surfaceId));
    return (item && item.type === 'a2ui-surface') ? item : null;
  }

  /**
   * A defensive deep clone of a surface's data payload — instances hand back
   * live objects, and mutations must go through updateContextItem, never
   * by aliasing.
   * @param {import('facet/context-item').default} item - The surface item
   * @returns {any} A plain deep copy of the data payload
   */
  static _cloneData(item) {
    return JSON.parse(JSON.stringify(item.data ?? {}));
  }

  /**
   * Execute one A2UI tool (dispatch on this.toolName). Creates or mutates the
   * standalone surface item; returns the small LLM-facing ack that
   * getSummary() formats.
   * @param {Record<string, unknown>} params - Validated params
   * @returns {Promise<object>} Raw result data
   */
  async execute(params) {
    const p = /** @type {any} */ (params);
    switch (this.toolName) {
      case 'a2ui_create_surface': return this._executeCreate(p);
      case 'a2ui_update_components': return this._executeUpdateComponents(p);
      case 'a2ui_update_data_model': return this._executeUpdateDataModel(p);
      case 'a2ui_delete_surface': return this._executeDelete(p);
      case 'a2ui_respond_action': return this._executeRespondAction(p);
      default: throw new Error(`Unknown A2UI tool "${this.toolName}"`);
    }
  }

  /**
   * Record the model's answer to a wantResponse action. Delivery is
   * doc-mediated: writing `data.actionResponses[actionId]` syncs to every
   * client, whose cards reconcile pending busy states against it on repaint.
   * The store is bounded — oldest responses are pruned.
   * @param {any} p - Validated params
   * @returns {Promise<object>} Ack
   */
  async _executeRespondAction(p) {
    const item = this._findSurface(p.surfaceId);
    if (!item) throw new Error(`Unknown surfaceId "${p.surfaceId}"`);
    const data = A2uiSurfaceContextItem._cloneData(item);
    /** @type {Record<string, object>} */
    const responses = data.actionResponses || {};
    responses[p.actionId] = p.error !== undefined
      ? { error: p.error }
      : { value: p.value ?? null };
    // Prune oldest first (object key order is insertion order).
    const keys = Object.keys(responses);
    for (let i = 0; i < keys.length - MAX_ACTION_RESPONSES; i++) delete responses[keys[i]];
    data.actionResponses = responses;
    this.messageThread.updateContextItem(item.id, { data });
    await this.session?.save?.();
    return { surfaceId: p.surfaceId, actionId: p.actionId, isError: p.error !== undefined };
  }

  /**
   * Create (or replace) a surface item.
   * @param {any} p - Validated params
   * @returns {Promise<object>} Ack
   */
  async _executeCreate(p) {
    const surfaceId = p.surfaceId || `s_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
    // Store components as an id-keyed map: upserts become key writes, and the
    // renderer indexes maps natively. Later defs win on duplicate ids.
    /** @type {Record<string, object>} */
    const components = {};
    for (const def of p.components) components[def.id] = def;

    const replaced = Boolean(this._findSurface(surfaceId));
    const contextItem = createItem({
      id: A2uiSurfaceContextItem.itemIdFor(surfaceId),
      type: 'a2ui-surface',
      data: {
        surfaceId,
        catalogId: p.catalogId || 'a2ui.org/basic',
        rootId: p.rootId,
        components,
        dataModel: p.dataModel || {},
        deleted: false
      }
    }, this.session, this.conversation, this.messageThread);
    this.messageThread.addContextItem(contextItem);
    await this.session?.save?.();
    return { surfaceId, componentCount: Object.keys(components).length, replaced };
  }

  /**
   * Upsert components by id on an existing surface.
   * @param {any} p - Validated params
   * @returns {Promise<object>} Ack
   */
  async _executeUpdateComponents(p) {
    const item = this._findSurface(p.surfaceId);
    if (!item) throw new Error(`Unknown surfaceId "${p.surfaceId}" — create it first with a2ui_create_surface`);
    const data = A2uiSurfaceContextItem._cloneData(item);
    for (const def of p.components) data.components[def.id] = def;
    this.messageThread.updateContextItem(item.id, { data });
    await this.session?.save?.();
    return { surfaceId: p.surfaceId, updated: p.components.length, componentCount: Object.keys(data.components).length };
  }

  /**
   * Upsert the data model at a pointer (or replace it wholesale).
   * @param {any} p - Validated params
   * @returns {Promise<object>} Ack
   */
  async _executeUpdateDataModel(p) {
    const item = this._findSurface(p.surfaceId);
    if (!item) throw new Error(`Unknown surfaceId "${p.surfaceId}" — create it first with a2ui_create_surface`);
    const data = A2uiSurfaceContextItem._cloneData(item);
    if (p.path === undefined || p.path === '') {
      data.dataModel = p.value;
    } else {
      data.dataModel = data.dataModel || {};
      setByPointer(data.dataModel, p.path, p.value);
    }
    this.messageThread.updateContextItem(item.id, { data });
    await this.session?.save?.();
    return { surfaceId: p.surfaceId, path: p.path || '(entire model)' };
  }

  /**
   * Tombstone a surface (kept in history for undo; hidden from rendering).
   * @param {any} p - Validated params
   * @returns {Promise<object>} Ack
   */
  async _executeDelete(p) {
    const item = this._findSurface(p.surfaceId);
    if (!item) throw new Error(`Unknown surfaceId "${p.surfaceId}"`);
    const data = A2uiSurfaceContextItem._cloneData(item);
    data.deleted = true;
    this.messageThread.updateContextItem(item.id, { data });
    await this.session?.save?.();
    return { surfaceId: p.surfaceId, deleted: true };
  }

  // ── LLM-facing formatting ────────────────────────────────────────────────

  /**
   * Format a tool outcome for the model and the UI line.
   * @param {import('facet/context-item').Outcome} outcome - Action outcome
   * @returns {import('facet/context-item').ItemSummary} Formatted result
   */
  getSummary(outcome) {
    if (!outcome.success) {
      return { summary: outcome.error || 'A2UI operation failed', details: '', success: false, icon: '✗' };
    }
    const r = /** @type {any} */ (outcome.result);
    let summary;
    switch (this.toolName) {
      case 'a2ui_create_surface':
        summary = `${r.replaced ? 'Replaced' : 'Rendered'} surface "${r.surfaceId}" (${r.componentCount} components)`;
        break;
      case 'a2ui_update_components':
        summary = `Updated ${r.updated} component(s) on "${r.surfaceId}" (now ${r.componentCount})`;
        break;
      case 'a2ui_update_data_model':
        summary = `Updated data at ${r.path} on "${r.surfaceId}"`;
        break;
      case 'a2ui_delete_surface':
        summary = `Deleted surface "${r.surfaceId}"`;
        break;
      case 'a2ui_respond_action':
        summary = `${r.isError ? 'Rejected' : 'Answered'} action "${r.actionId}" on "${r.surfaceId}"`;
        break;
      default:
        summary = 'A2UI operation completed';
    }
    return { summary, details: '', success: true, icon: '✓' };
  }

  /**
   * The durable context injected for the standing surface item. Compact by
   * design: full component JSON already sits in the create/update tool calls
   * in history; what the model needs fresh is the identity plus the CURRENT
   * data model (which user interactions may have changed since).
   * @override
   * @returns {string} Context text for the LLM
   */
  createContextText() {
    const d = /** @type {any} */ (this.data) || {};
    if (d.deleted) return `[A2UI surface "${d.surfaceId}" was deleted]`;
    const n = Object.keys(d.components || {}).length;
    let model = '';
    try {
      model = JSON.stringify(d.dataModel ?? {});
    } catch {
      model = '(unserializable)';
    }
    return `A2UI surface "${d.surfaceId}" (catalog ${d.catalogId}, root "${d.rootId}", ${n} components) is rendered in the conversation. Current dataModel: ${model}`;
  }

  // ── Viewer rendering ─────────────────────────────────────────────────────

  /**
   * Status UI. Two call shapes share this method:
   * - **No args** (standalone `context-item-message` card): render the live
   *   surface DOM as the summary — this is the surface's home in the column.
   * - **With args** (the `tool-action-message` for one of our tool calls):
   *   return null and let the framework's default action rendering apply;
   *   the surface itself renders on the standalone item, not the tool call.
   * @override
   * @param {import('../../../js/services/action-executor.js').ActionStatus|null} [actionStatus] - Action status (tool-action calls only)
   * @param {Record<string, unknown>} [_toolInput] - Tool input (unused)
   * @param {object} [_context] - UI context (unused)
   * @returns {import('facet/context-item').ResultStatusMessage|null} Status message config
   */
  getStatusUI(actionStatus, _toolInput, _context) {
    if (actionStatus !== undefined) return null;
    const d = /** @type {any} */ (this.data) || {};
    if (d.deleted) {
      // A recreated surface under the same id should replay its entry motion.
      resetMotion(d.surfaceId);
      return { typeName: 'A2UI', summary: `Surface "${d.surfaceId}" (deleted)` };
    }
    const surfaceState = {
      surfaceId: d.surfaceId,
      rootId: d.rootId,
      components: d.components || {},
      dataModel: d.dataModel || {}
    };
    const surfaceEl = renderSurface(surfaceState, {
      onAction: info => this._handleAction(info)
    });
    applyMotion(surfaceEl, surfaceState);

    // Re-derive wantResponse busy states on every repaint: responses written
    // by a2ui_respond_action arrive as data changes, so reconciling here is
    // what clears a spinner the moment the model answers (on every client).
    reconcileResponses(d.surfaceId, d.actionResponses);
    for (const componentId of Object.keys(d.components || {})) {
      const pending = pendingFor(d.surfaceId, componentId);
      if (pending?.actionId) {
        const el = /** @type {HTMLElement|null} */ (surfaceEl.querySelector(`[data-a2ui-id="${CSS.escape(componentId)}"]`));
        if (el) A2uiSurfaceContextItem._setBusy(el, true);
      }
    }
    return { typeName: 'A2UI', summary: surfaceEl };
  }

  /**
   * Toggle a component's waiting-on-response affordance.
   * @param {HTMLElement} el - The component's root element
   * @param {boolean} on - Whether the component is waiting
   */
  static _setBusy(el, on) {
    el.classList.toggle('a2ui-action-pending', on);
    el.setAttribute('aria-busy', on ? 'true' : 'false');
    if (el.tagName === 'BUTTON') /** @type {HTMLButtonElement} */ (el).disabled = on;
  }

  /**
   * A user interaction on this surface — the client→agent half of A2UI.
   *
   * The action becomes a `[A2UI action]` **user message** sent through
   * `conversation.sendMessage`, which gives the design's delivery semantics
   * for free: worker idle → a turn starts; worker busy → the worker queues it
   * and drains at the next boundary. The action's `context` bindings resolve
   * against the current data model at click time.
   *
   * `wantResponse` actions mint an actionId, mark the source component busy,
   * and wait for `a2ui_respond_action` (doc-mediated; see
   * `_executeRespondAction`). The wedge guard: pending entries self-expire
   * after RESPONSE_TIMEOUT_MS and a timer restores the live element, so an
   * agent that ignores the flag can never wedge a control. Local
   * `functionCall` actions (spec's client-side functions) are deferred.
   * @param {{surfaceId: string, componentId: string, action: Record<string, unknown>, sourceElement?: HTMLElement}} info - Action info
   * @returns {Promise<void>}
   */
  async _handleAction(info) {
    const d = /** @type {any} */ (this.data) || {};
    const action = /** @type {any} */ (info.action) || {};
    if (action.functionCall) return;
    if (!d.surfaceId || pendingFor(d.surfaceId, info.componentId)) return;

    const event = action.event || {};
    const wantResponse = event.wantResponse === true;
    const actionId = wantResponse
      ? (typeof event.actionId === 'string' && event.actionId
        ? event.actionId
        : `act_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`)
      : undefined;

    registerDispatch(d.surfaceId, info.componentId, actionId);
    const el = info.sourceElement;
    if (wantResponse && el) {
      A2uiSurfaceContextItem._setBusy(el, true);
      // Wedge guard for the LIVE element: the pending entry self-expires, but
      // without a data change nothing repaints — restore this element too.
      setTimeout(() => {
        if (el.isConnected && !pendingFor(d.surfaceId, info.componentId)) {
          A2uiSurfaceContextItem._setBusy(el, false);
        }
      }, RESPONSE_TIMEOUT_MS + 50);
    }

    const content = formatActionMessage({
      surfaceId: d.surfaceId,
      componentId: info.componentId,
      eventName: (typeof event.name === 'string' && event.name) || 'action',
      context: resolveActionContext(event.context ?? action.context, d.dataModel),
      actionId
    });

    const dropped = await this.conversation?.sendMessage?.(content, null, this.messageThread);
    if (dropped) {
      clearPending(d.surfaceId, info.componentId);
      if (el) A2uiSurfaceContextItem._setBusy(el, false);
      console.warn(`[a2ui] action not delivered: ${dropped}`);
    }
  }

  /**
   * Properties panel: the raw component and data JSON — the payload is part
   * of "everything important is visible".
   * @override
   * @returns {HTMLElement} Panel element
   */
  createPropertiesPanelElement() {
    const d = /** @type {any} */ (this.data) || {};
    const wrap = document.createElement('div');
    wrap.className = 'a2ui-properties';

    const addSection = (label, value) => {
      const h = document.createElement('h4');
      h.className = 'properties-panel-subtitle';
      h.textContent = label;
      wrap.appendChild(h);
      const pre = document.createElement('pre');
      pre.className = 'a2ui-properties-json';
      try {
        pre.textContent = JSON.stringify(value ?? {}, null, 2);
      } catch {
        pre.textContent = '(unserializable)';
      }
      wrap.appendChild(pre);
    };

    addSection(`Surface "${d.surfaceId}"${d.deleted ? ' (deleted)' : ''} — components`, d.components);
    addSection('Data model', d.dataModel);
    return wrap;
  }
}

export default A2uiSurfaceContextItem;
