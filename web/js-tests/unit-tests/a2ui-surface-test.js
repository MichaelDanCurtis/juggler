//     ▄▄ ▄▄ ▄▄  ▄▄▄▄  ▄▄▄▄ ▄▄    ▄▄▄▄▄ ▄▄▄▄
//     ██ ██ ██ ██ ▄▄ ██ ▄▄ ██    ██▄▄  ██▄█▄   Copyright (c) 2026 Julian Storer
//   ▄▄█▀ ▀███▀ ▀███▀ ▀███▀ ██▄▄▄ ██▄▄▄ ██ ██   AGPL-3.0-or-later - see LICENSE

/**
 * A2UI surface item + tools tests (increment 2 of the A2UI design).
 *
 * The a2ui_* tools create and mutate a standalone `a2ui-surface` context item
 * whose whole state lives under `data`, upserted only through the sanctioned
 * addContextItem/updateContextItem path. These tests anchor: the
 * create/update/delete lifecycle against a REAL message thread, validation
 * contracts, LLM-facing summaries and context text, the standalone-card
 * rendering path (getStatusUI with no args → live surface DOM), and the
 * context-item-message element re-rendering when the item's data changes
 * (the observer added for exactly this).
 * @module unit-tests/a2ui-surface
 */

import {
  initializeRegistries,
  createTestSession,
  createTestConversation,
  assert
} from '../utilities/test-helpers.js';
import A2uiSurfaceContextItem from '../../extensions/juggler-a2ui/context-items/a2ui-surface-context-item.js';
import '../../js/components/context-item-message.js';

/**
 * @typedef {object} TestResult
 * @property {number} passed - Count of assertions that passed.
 * @property {number} failed - Count of assertions that failed.
 * @property {string[]} errors - Messages from failed assertions.
 */

/**
 * Build a tool-executing instance bound to a real thread.
 * @param {string} toolName - The a2ui_* tool this instance executes
 * @param {object} env - {session, conversation, messageThread}
 * @returns {A2uiSurfaceContextItem} The instance
 */
function makeTool(toolName, env) {
  return new A2uiSurfaceContextItem(/** @type {any} */ ({
    id: `exec_${toolName}`,
    session: env.session,
    conversation: env.conversation,
    messageThread: env.messageThread,
    toolName
  }));
}

/**
 * Run all A2UI surface item/tool tests.
 * @returns {Promise<TestResult>} Test results
 */
export async function runTests() {
  let passed = 0;
  let failed = 0;
  const errors = [];

  /**
   * @param {string} name - Test name
   * @param {() => Promise<void>|void} fn - Test body
   */
  const check = async (name, fn) => {
    try {
      await fn();
      passed++;
    } catch (e) {
      failed++;
      errors.push(`${name}: ${e.message}`);
    }
  };

  await initializeRegistries();
  const session = await createTestSession();
  const conversation = await createTestConversation(session);
  const messageThread = conversation.rootMessageThread;
  const env = { session, conversation, messageThread };

  const CREATE_PARAMS = {
    surfaceId: 's1',
    rootId: 'root',
    components: [
      { id: 'root', type: 'Column', children: ['title', 'value'] },
      { id: 'title', type: 'Text', props: { text: 'CPU' } },
      { id: 'value', type: 'Text', props: { text: { path: '/cpu' } } }
    ],
    dataModel: { cpu: '42%' }
  };

  // ── lifecycle against the real thread ────────────────────────────────────

  await check('a2ui_create_surface inserts a standalone a2ui-surface item', async () => {
    const result = await makeTool('a2ui_create_surface', env).execute(JSON.parse(JSON.stringify(CREATE_PARAMS)));
    assert(/** @type {any} */ (result).surfaceId === 's1', 'ack carries surfaceId');
    assert(/** @type {any} */ (result).componentCount === 3, 'ack counts components');
    const item = messageThread.getContextItem('A2UI_s1');
    assert(item && item.type === 'a2ui-surface', 'item exists with deterministic id');
    const d = /** @type {any} */ (item.data);
    assert(d.rootId === 'root' && d.surfaceId === 's1', 'identity stored');
    assert(d.components.title.props.text === 'CPU', 'components stored as id-keyed map');
    assert(d.dataModel.cpu === '42%', 'dataModel stored');
    assert(d.catalogId === 'a2ui.org/basic', 'default catalog applied');
  });

  await check('create with omitted surfaceId mints one', async () => {
    const result = /** @type {any} */ (await makeTool('a2ui_create_surface', env).execute({
      rootId: 'r', components: [{ id: 'r', type: 'Text', props: { text: 'x' } }]
    }));
    assert(typeof result.surfaceId === 'string' && result.surfaceId.length > 0, 'surfaceId minted');
    assert(messageThread.getContextItem(`A2UI_${result.surfaceId}`), 'minted surface item exists');
  });

  await check('getStatusUI() (no args) renders the live surface DOM', () => {
    const item = messageThread.getContextItem('A2UI_s1');
    const ui = /** @type {any} */ (item).getStatusUI();
    assert(ui.typeName === 'A2UI', 'typeName set');
    assert(ui.summary instanceof HTMLElement, 'summary is DOM');
    const texts = Array.from(ui.summary.querySelectorAll('.a2ui-text')).map(t => t.textContent);
    assert(texts.includes('CPU'), 'literal text rendered');
    assert(texts.includes('42%'), 'bound text resolved from dataModel');
  });

  await check('a2ui_update_data_model mutates via pointer; fresh render reflects it', async () => {
    await makeTool('a2ui_update_data_model', env).execute({ surfaceId: 's1', path: '/cpu', value: '97%' });
    const item = messageThread.getContextItem('A2UI_s1');
    assert(/** @type {any} */ (item.data).dataModel.cpu === '97%', 'dataModel updated in the doc');
    const texts = Array.from(/** @type {any} */ (item).getStatusUI().summary.querySelectorAll('.a2ui-text')).map(t => t.textContent);
    assert(texts.includes('97%'), 'fresh render shows the new value');
  });

  await check('a2ui_update_components upserts by id, preserving the rest', async () => {
    await makeTool('a2ui_update_components', env).execute({
      surfaceId: 's1',
      components: [
        { id: 'title', type: 'Text', props: { text: 'CPU load' } },
        { id: 'extra', type: 'Divider' }
      ]
    });
    const d = /** @type {any} */ (messageThread.getContextItem('A2UI_s1').data);
    assert(d.components.title.props.text === 'CPU load', 'existing component replaced');
    assert(d.components.extra.type === 'Divider', 'new component added');
    assert(d.components.value.props.text.path === '/cpu', 'untouched component preserved');
    assert(d.dataModel.cpu === '97%', 'dataModel untouched by component update');
  });

  await check('a2ui_delete_surface tombstones; card and context text say so', async () => {
    const result = /** @type {any} */ (await makeTool('a2ui_create_surface', env).execute({
      surfaceId: 'doomed', rootId: 'r', components: [{ id: 'r', type: 'Text', props: { text: 'bye' } }]
    }));
    assert(result.surfaceId === 'doomed', 'created');
    await makeTool('a2ui_delete_surface', env).execute({ surfaceId: 'doomed' });
    const item = messageThread.getContextItem('A2UI_doomed');
    assert(item && /** @type {any} */ (item.data).deleted === true, 'tombstoned, not removed');
    const ui = /** @type {any} */ (item).getStatusUI();
    assert(typeof ui.summary === 'string' && ui.summary.includes('deleted'), 'card shows deletion');
    assert(/** @type {any} */ (item).createContextText().includes('deleted'), 'context text shows deletion');
  });

  await check('updates on an unknown surface throw a helpful error', async () => {
    let message = '';
    try {
      await makeTool('a2ui_update_data_model', env).execute({ surfaceId: 'ghost', path: '/x', value: 1 });
    } catch (e) {
      message = e.message;
    }
    assert(message.includes('ghost') && message.includes('a2ui_create_surface'),
      `error names the id and the fix, got: ${message}`);
  });

  // ── validation contracts ─────────────────────────────────────────────────

  await check('validate() enforces per-tool contracts', async () => {
    const v = (toolName, input) => makeTool(toolName, env).validate(input);
    assert(!(await v('a2ui_create_surface', { components: [{ id: 'r', type: 'Text' }] })).valid, 'create needs rootId');
    assert(!(await v('a2ui_create_surface', { rootId: 'r', components: [] })).valid, 'create needs components');
    assert(!(await v('a2ui_create_surface', { rootId: 'r', components: [{ type: 'Text' }] })).valid, 'components need ids');
    assert(!(await v('a2ui_update_components', { components: [{ id: 'x', type: 'Text' }] })).valid, 'update needs surfaceId');
    assert(!(await v('a2ui_update_data_model', { surfaceId: 's1', path: 'no-slash', value: 1 })).valid, 'pointer must start with /');
    assert(!(await v('a2ui_update_data_model', { surfaceId: 's1' })).valid, 'value required');
    assert(!(await v('a2ui_update_data_model', { surfaceId: 's1', value: [1, 2] })).valid, 'whole-model replace must be an object');
    assert((await v('a2ui_update_data_model', { surfaceId: 's1', value: { a: 1 } })).valid, 'whole-model replace with object OK');
    assert(!(await v('a2ui_delete_surface', {})).valid, 'delete needs surfaceId');
  });

  await check('getSummary formats per-tool acks', () => {
    const s = (toolName, result) =>
      makeTool(toolName, env).getSummary({ success: true, result, prepared: {} }).summary;
    assert(s('a2ui_create_surface', { surfaceId: 's1', componentCount: 3, replaced: false }).includes('Rendered surface "s1"'), 'create summary');
    assert(s('a2ui_create_surface', { surfaceId: 's1', componentCount: 3, replaced: true }).includes('Replaced'), 'replace summary');
    assert(s('a2ui_update_data_model', { surfaceId: 's1', path: '/cpu' }).includes('/cpu'), 'data summary names the path');
    assert(s('a2ui_delete_surface', { surfaceId: 's1', deleted: true }).includes('Deleted'), 'delete summary');
  });

  await check('createContextText carries identity and CURRENT dataModel', () => {
    const item = messageThread.getContextItem('A2UI_s1');
    const text = /** @type {any} */ (item).createContextText();
    assert(text.includes('"s1"'), 'names the surface');
    assert(text.includes('97%'), 'carries the current dataModel');
  });

  // ── the live column card ─────────────────────────────────────────────────

  await check('context-item-message re-renders live when surface data changes', async () => {
    const el = /** @type {any} */ (document.createElement('context-item-message'));
    el.setAttribute('item-id', 'A2UI_s1');
    el.setAttribute('item-type', 'a2ui-surface');
    // The element resolves its thread by walking to the enclosing
    // conversation-area; tests mount it bare, so pin the resolver instead.
    Object.defineProperty(el, '_getMessageThread', { value: () => messageThread });
    document.body.appendChild(el);
    try {
      const rendered = () => Array.from(el.querySelectorAll('.a2ui-text')).map((/** @type {any} */ t) => t.textContent);
      assert(rendered().includes('97%'), `initial render shows current value, got ${rendered()}`);

      // Mutate through the real tool path — the element's own Yjs observer
      // must repaint without any structural re-render.
      await makeTool('a2ui_update_data_model', env).execute({ surfaceId: 's1', path: '/cpu', value: '13%' });
      assert(rendered().includes('13%'), `card repainted from observer, got ${rendered()}`);
      assert(!rendered().includes('97%'), 'stale value gone');
    } finally {
      el.remove();
    }
  });

  return { passed, failed, errors };
}
