//     ▄▄ ▄▄ ▄▄  ▄▄▄▄  ▄▄▄▄ ▄▄    ▄▄▄▄▄ ▄▄▄▄
//     ██ ██ ██ ██ ▄▄ ██ ▄▄ ██    ██▄▄  ██▄█▄   Copyright (c) 2026 Julian Storer
//   ▄▄█▀ ▀███▀ ▀███▀ ▀███▀ ██▄▄▄ ██▄▄▄ ██ ██   Apache-2.0 - see LICENSE
// SPDX-License-Identifier: Apache-2.0

/**
 * The `a2ui.org/basic` catalog subset Juggler renders natively: the
 * structural chrome (Text, Row, Column, Card, List, Divider, Image) plus the
 * one interactive component every surface needs (Button).
 *
 * Every builder receives the normalized component definition and a render
 * context (see `renderer.js` for both shapes) and returns a plain
 * HTMLElement. Two hard rules, inherited from A2UI's trust model:
 * - **All model-supplied strings land via `textContent`** — never innerHTML.
 * - **No code crosses the boundary**: builders translate declarative JSON to
 *   inert DOM; the only behavior is the `action` dispatch wired by Button.
 *
 * Deliberately deferred (per the design doc): form inputs (TextField,
 * CheckBox, ChoicePicker, Slider), Tabs, Modal, Video, Icon, DateTimeInput,
 * and List *template* mode (collection scope) — a List renders explicit
 * children today. Unknown components render a labeled placeholder in the
 * renderer, never an error.
 * @module a2ui/catalog-basic
 */

/**
 * @typedef {import('./renderer.js').ComponentDef} ComponentDef
 * @typedef {import('./renderer.js').RenderContext} RenderContext
 */

/**
 * URL schemes an Image may load. Model-supplied URLs are untrusted input:
 * anything outside this list (javascript:, file:, chrome:, …) renders as a
 * placeholder instead of an element that could navigate or execute.
 * @type {RegExp}
 */
const SAFE_IMAGE_URL = /^(https?:|data:image\/|blob:)/i;

/**
 * Build a flex container (Row/Column share everything but the axis).
 * Structural layout is set inline so the component works before any
 * stylesheet loads; visual polish belongs to the app CSS layer.
 * @param {ComponentDef} def - Normalized component definition
 * @param {RenderContext} ctx - Render context
 * @param {'row'|'column'} direction - Main axis
 * @returns {HTMLElement} The container with children rendered
 */
function buildFlex(def, ctx, direction) {
  const el = document.createElement('div');
  el.className = `a2ui-${direction}`;
  el.style.display = 'flex';
  el.style.flexDirection = direction;
  el.style.gap = '8px';
  ctx.renderChildren(def, el);
  return el;
}

/** @type {Record<string, (def: ComponentDef, ctx: RenderContext) => HTMLElement>} */
export const BASIC_CATALOG = {
  /**
   * Text — a run of display text. `text` may be a literal or a data binding.
   * @param {ComponentDef} def - Normalized component definition
   * @param {RenderContext} ctx - Render context
   * @returns {HTMLElement} The text element
   */
  Text(def, ctx) {
    const el = document.createElement('div');
    el.className = 'a2ui-text';
    el.textContent = ctx.text(def.props.text);
    return el;
  },

  /**
   * Row — horizontal flex container of child components.
   * @param {ComponentDef} def - Normalized component definition
   * @param {RenderContext} ctx - Render context
   * @returns {HTMLElement} The row container
   */
  Row(def, ctx) {
    return buildFlex(def, ctx, 'row');
  },

  /**
   * Column — vertical flex container of child components.
   * @param {ComponentDef} def - Normalized component definition
   * @param {RenderContext} ctx - Render context
   * @returns {HTMLElement} The column container
   */
  Column(def, ctx) {
    return buildFlex(def, ctx, 'column');
  },

  /**
   * Card — a grouped content container.
   * @param {ComponentDef} def - Normalized component definition
   * @param {RenderContext} ctx - Render context
   * @returns {HTMLElement} The card element
   */
  Card(def, ctx) {
    const el = document.createElement('section');
    el.className = 'a2ui-card';
    ctx.renderChildren(def, el);
    return el;
  },

  /**
   * List — explicit children rendered as list items. Template mode
   * (a per-array-element template with collection-scope bindings) is
   * deferred; the binding scaffolding for it lives in data-model.js.
   * @param {ComponentDef} def - Normalized component definition
   * @param {RenderContext} ctx - Render context
   * @returns {HTMLElement} The list element
   */
  List(def, ctx) {
    const el = document.createElement('div');
    el.className = 'a2ui-list';
    el.setAttribute('role', 'list');
    ctx.renderChildren(def, el, child => {
      const item = document.createElement('div');
      item.className = 'a2ui-list-item';
      item.setAttribute('role', 'listitem');
      item.appendChild(child);
      return item;
    });
    return el;
  },

  /**
   * Divider — a horizontal rule between sections.
   * @param {ComponentDef} _def - Normalized component definition (unused)
   * @param {RenderContext} _ctx - Render context (unused)
   * @returns {HTMLElement} The divider element
   */
  Divider(_def, _ctx) {
    const el = document.createElement('hr');
    el.className = 'a2ui-divider';
    return el;
  },

  /**
   * Image — an image restricted to safe URL schemes. `url` may be a literal
   * or a binding; a blocked or missing URL renders a placeholder via the
   * thrown error (the renderer catches and substitutes).
   * @param {ComponentDef} def - Normalized component definition
   * @param {RenderContext} ctx - Render context
   * @returns {HTMLElement} The image element
   */
  Image(def, ctx) {
    const url = String(ctx.resolve(def.props.url ?? def.props.source) ?? '');
    if (!SAFE_IMAGE_URL.test(url)) {
      throw new Error(`Image URL blocked (unsupported scheme): ${url.slice(0, 64) || '(empty)'}`);
    }
    const el = document.createElement('img');
    el.className = 'a2ui-image';
    el.src = url;
    el.alt = ctx.text(def.props.alt ?? def.props.description);
    el.style.maxWidth = '100%';
    return el;
  },

  /**
   * Button — the interactive primitive. Clicking dispatches the component's
   * declared `action` through the render callbacks; the payload contract
   * (fire-and-forget vs wantResponse) is the tool layer's concern.
   * @param {ComponentDef} def - Normalized component definition
   * @param {RenderContext} ctx - Render context
   * @returns {HTMLElement} The button element
   */
  Button(def, ctx) {
    const el = document.createElement('button');
    el.className = 'a2ui-button';
    el.type = 'button';
    const label = ctx.text(def.props.label ?? def.props.text);
    if (label) {
      el.textContent = label;
    } else {
      // A Button may carry child components (e.g. an Icon + Text pair)
      // instead of a plain label.
      ctx.renderChildren(def, el);
    }
    if (ctx.resolve(def.props.disabled) === true) el.disabled = true;
    el.addEventListener('click', () => ctx.dispatchAction(def));
    return el;
  }
};
