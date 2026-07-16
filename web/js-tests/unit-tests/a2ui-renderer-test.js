//     ▄▄ ▄▄ ▄▄  ▄▄▄▄  ▄▄▄▄ ▄▄    ▄▄▄▄▄ ▄▄▄▄
//     ██ ██ ██ ██ ▄▄ ██ ▄▄ ██    ██▄▄  ██▄█▄   Copyright (c) 2026 Julian Storer
//   ▄▄█▀ ▀███▀ ▀███▀ ▀███▀ ██▄▄▄ ██▄▄▄ ██ ██   AGPL-3.0-or-later - see LICENSE

/**
 * A2UI renderer + data-model tests (increment 1 of the A2UI design).
 *
 * The renderer's contract is "declarative JSON in, inert DOM out": every
 * model-supplied string must land via textContent (markup stays text), URLs
 * are scheme-restricted, and anything unrenderable — unknown type, missing
 * child, cyclic adjacency list, builder error — degrades to a labeled
 * placeholder instead of throwing or hanging. The data-model module anchors
 * RFC 6901 pointer semantics (escapes, upsert creation, '-' append) and the
 * two A2UI binding scopes (absolute vs collection-relative).
 * @module unit-tests/a2ui-renderer
 */

import { assert } from '../utilities/test-helpers.js';
import {
  parsePointer, getByPointer, setByPointer, resolveBoundValue, resolveValue, toText
} from '../../sdk/a2ui.js';
import { renderSurface, normalizeComponent } from '../../sdk/a2ui.js';

/**
 * @typedef {object} TestResult
 * @property {number} passed - Count of assertions that passed.
 * @property {number} failed - Count of assertions that failed.
 * @property {string[]} errors - Messages from failed assertions.
 */

/**
 * Build a surface from a terse component map and render it.
 * @param {Record<string, object>} components - Components keyed by id
 * @param {string} rootId - Root component id
 * @param {object} [dataModel] - Surface data model
 * @param {import('../../sdk/a2ui.js').SurfaceCallbacks} [callbacks] - Interaction callbacks
 * @returns {HTMLElement} The rendered surface element
 */
function render(components, rootId, dataModel = {}, callbacks = {}) {
  return renderSurface({ surfaceId: 's1', rootId, components, dataModel }, callbacks);
}

/**
 * Run all A2UI renderer/data-model tests.
 * @returns {Promise<TestResult>} Test results
 */
export async function runTests() {
  let passed = 0;
  let failed = 0;
  const errors = [];

  const check = (name, fn) => {
    try {
      fn();
      passed++;
    } catch (e) {
      failed++;
      errors.push(`${name}: ${e.message}`);
    }
  };

  // ── data-model: RFC 6901 pointers ────────────────────────────────────────

  check('parsePointer handles root, tokens, and ~0/~1 escapes', () => {
    assert(parsePointer('').length === 0, 'empty pointer → no tokens');
    assert(parsePointer('/a/b').join(',') === 'a,b', 'plain tokens');
    assert(parsePointer('/a~1b/c~0d').join(',') === 'a/b,c~d', '~1→/ then ~0→~');
    let threw = false;
    try {
      parsePointer('nope');
    } catch {
      threw = true;
    }
    assert(threw, 'non-rooted pointer must throw');
  });

  check('getByPointer reads nested objects and array indices', () => {
    const model = { user: { name: 'Ada' }, items: [{ n: 1 }, { n: 2 }] };
    assert(getByPointer(model, '') === model, 'empty pointer → root');
    assert(getByPointer(model, '/user/name') === 'Ada', 'nested object');
    assert(getByPointer(model, '/items/1/n') === 2, 'array index');
    assert(getByPointer(model, '/missing/deep') === undefined, 'missing path → undefined');
    assert(getByPointer(model, '/items/x') === undefined, 'non-numeric index → undefined');
  });

  check('setByPointer upserts, creating intermediate containers', () => {
    /** @type {Record<string, unknown>} */
    const model = {};
    setByPointer(model, '/user/name', 'Ada');
    assert(/** @type {any} */ (model).user.name === 'Ada', 'deep-created object path');
    setByPointer(model, '/series/0', 10);
    assert(Array.isArray(/** @type {any} */ (model).series), 'numeric next token creates an array');
    setByPointer(model, '/series/-', 20);
    assert(/** @type {any} */ (model).series.join(',') === '10,20', '"-" appends');
    setByPointer(model, '/user/name', 'Grace');
    assert(/** @type {any} */ (model).user.name === 'Grace', 'existing value replaced');
    let threw = false;
    try {
      setByPointer(model, '', {});
    } catch {
      threw = true;
    }
    assert(threw, 'whole-document pointer must throw (handled at call site)');
  });

  check('resolveBoundValue honors absolute and collection-relative scopes', () => {
    const model = { title: 'Top', rows: [{ name: 'first' }, { name: 'second' }] };
    assert(resolveBoundValue(model, '/title') === 'Top', 'absolute path');
    assert(resolveBoundValue(model, 'name', '/rows/1') === 'second', 'relative path against base');
    assert(resolveBoundValue(model, 'name') === undefined, 'relative with no base → root miss');
  });

  check('resolveValue distinguishes literals from bindings', () => {
    const ctx = { dataModel: { user: { name: 'Ada' } } };
    assert(resolveValue('plain', ctx) === 'plain', 'string literal passes through');
    assert(resolveValue(42, ctx) === 42, 'number literal passes through');
    assert(resolveValue({ path: '/user/name' }, ctx) === 'Ada', '{path} binding resolves');
    assert(resolveValue({ literalString: 'x' }, ctx) === 'x', 'typed literal compat shape');
    assert(resolveValue({ other: 1 }, ctx).other === 1, 'non-binding object stays literal');
  });

  check('toText follows the spec interpolation rules', () => {
    assert(toText('s') === 's', 'string unchanged');
    assert(toText(3) === '3' && toText(false) === 'false', 'number/boolean stringify');
    assert(toText(null) === '' && toText(undefined) === '', 'null/undefined → empty');
    assert(toText({ a: 1 }) === '{"a":1}', 'objects stringify as JSON');
  });

  // ── renderer: structure ──────────────────────────────────────────────────

  check('renders a nested fixture with correct structure and text', () => {
    const el = render({
      root: { type: 'Column', children: ['title', 'row', 'hr', 'card'] },
      title: { type: 'Text', props: { text: 'Dashboard' } },
      row: { type: 'Row', children: ['img', 'btn'] },
      img: { type: 'Image', props: { url: 'https://example.com/x.png', alt: 'pic' } },
      btn: { type: 'Button', props: { label: 'Go' } },
      hr: { type: 'Divider' },
      card: { type: 'Card', children: ['list'] },
      list: { type: 'List', children: ['t1', 't2'] },
      t1: { type: 'Text', props: { text: 'one' } },
      t2: { type: 'Text', props: { text: 'two' } }
    }, 'root');

    const column = el.querySelector('.a2ui-column');
    assert(column && column.style.flexDirection === 'column', 'Column is a column flexbox');
    assert(el.querySelector('.a2ui-row')?.style.flexDirection === 'row', 'Row is a row flexbox');
    assert(el.querySelector('.a2ui-text')?.textContent === 'Dashboard', 'Text renders its text');
    assert(el.querySelector('.a2ui-image')?.getAttribute('src') === 'https://example.com/x.png', 'Image src set');
    assert(el.querySelector('.a2ui-image')?.getAttribute('alt') === 'pic', 'Image alt set');
    assert(el.querySelector('.a2ui-button')?.textContent === 'Go', 'Button label set');
    assert(el.querySelector('hr.a2ui-divider'), 'Divider renders an hr');
    const items = el.querySelectorAll('.a2ui-card .a2ui-list .a2ui-list-item');
    assert(items.length === 2, `List wraps each child as a list item, got ${items.length}`);
    assert(items[0].getAttribute('role') === 'listitem', 'list items carry the listitem role');
  });

  check('data bindings resolve from the surface dataModel', () => {
    const el = render(
      { root: { type: 'Text', props: { text: { path: '/user/name' } } } },
      'root',
      { user: { name: 'Grace' } }
    );
    assert(el.querySelector('.a2ui-text')?.textContent === 'Grace', 'bound text rendered');
  });

  check('wire-format components ({id, component: {Type: {...}}}) render', () => {
    const norm = normalizeComponent({ id: 'x', component: { Text: { text: 'wired' } } });
    assert(norm && norm.type === 'Text' && norm.props.text === 'wired', 'normalizer maps wire shape');
    const el = renderSurface({
      surfaceId: 's1',
      rootId: 'root',
      components: [
        { id: 'root', component: { Column: { children: { explicitList: ['x'] } } } },
        { id: 'x', component: { Text: { text: 'wired' } } }
      ],
      dataModel: {}
    });
    assert(el.querySelector('.a2ui-text')?.textContent === 'wired', 'wire-shape surface renders');
  });

  // ── renderer: untrusted-input discipline ─────────────────────────────────

  check('markup in model text stays inert text', () => {
    const payload = '<img src=x onerror="window.__a2uiPwned=1"><b>bold</b>';
    const el = render({ root: { type: 'Text', props: { text: payload } } }, 'root');
    const text = el.querySelector('.a2ui-text');
    assert(text?.textContent === payload, 'markup preserved as literal text');
    assert(!text?.querySelector('img, b'), 'no elements were created from the text');
    assert(!(/** @type {any} */ (window).__a2uiPwned), 'no script effect');
  });

  check('non-http(s) image URLs are blocked with a placeholder', () => {
    const el = render({ root: { type: 'Image', props: { url: 'javascript:alert(1)' } } }, 'root');
    assert(!el.querySelector('img'), 'no img element for a blocked scheme');
    const ph = el.querySelector('.a2ui-placeholder');
    assert(ph && ph.textContent.includes('blocked'), 'placeholder explains the block');
  });

  // ── renderer: graceful degradation ───────────────────────────────────────

  check('unknown component type renders a labeled placeholder', () => {
    const el = render({ root: { type: 'Hologram', props: {} } }, 'root');
    const ph = el.querySelector('.a2ui-placeholder');
    assert(ph && ph.textContent.includes('Hologram'), 'placeholder names the unsupported type');
  });

  check('missing child id renders a placeholder, siblings still render', () => {
    const el = render({
      root: { type: 'Row', children: ['ghost', 'real'] },
      real: { type: 'Text', props: { text: 'here' } }
    }, 'root');
    assert(el.querySelector('.a2ui-placeholder')?.textContent.includes('ghost'), 'missing child named');
    assert(el.querySelector('.a2ui-text')?.textContent === 'here', 'sibling unaffected');
  });

  check('cyclic adjacency list degrades instead of recursing forever', () => {
    const el = render({
      a: { type: 'Row', children: ['b'] },
      b: { type: 'Column', children: ['a'] }
    }, 'a');
    const ph = el.querySelector('.a2ui-placeholder');
    assert(ph && ph.textContent.includes('Cyclic'), 'cycle rendered as placeholder');
  });

  check('a surface without rootId renders a placeholder, never throws', () => {
    const el = renderSurface(/** @type {any} */ ({ surfaceId: 's1', components: {} }));
    assert(el.querySelector('.a2ui-placeholder'), 'placeholder for missing rootId');
  });

  // ── renderer: interaction ────────────────────────────────────────────────

  check('Button click dispatches the declared action with component identity', () => {
    /** @type {any[]} */
    const fired = [];
    const el = render({
      root: { type: 'Button', props: { label: 'Run', action: { event: { name: 'run-it' } } } }
    }, 'root', {}, { onAction: info => fired.push(info) });
    el.querySelector('.a2ui-button').click();
    assert(fired.length === 1, 'one action fired');
    assert(fired[0].surfaceId === 's1' && fired[0].componentId === 'root', 'action carries identity');
    assert(fired[0].action.event.name === 'run-it', 'action payload passed through');
  });

  check('Button click without an onAction callback is a no-op', () => {
    const el = render({
      root: { type: 'Button', props: { label: 'Run', action: { event: { name: 'x' } } } }
    }, 'root');
    el.querySelector('.a2ui-button').click(); // must not throw
    assert(true, 'no-op click succeeded');
  });

  check('disabled binding disables the button', () => {
    const el = render({
      root: { type: 'Button', props: { label: 'Run', disabled: { path: '/busy' } } }
    }, 'root', { busy: true });
    assert(el.querySelector('.a2ui-button')?.disabled === true, 'button disabled via binding');
  });

  return { passed, failed, errors };
}
