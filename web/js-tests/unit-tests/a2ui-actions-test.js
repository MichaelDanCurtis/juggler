//     ▄▄ ▄▄ ▄▄  ▄▄▄▄  ▄▄▄▄ ▄▄    ▄▄▄▄▄ ▄▄▄▄
//     ██ ██ ██ ██ ▄▄ ██ ▄▄ ██    ██▄▄  ██▄█▄   Copyright (c) 2026 Julian Storer
//   ▄▄█▀ ▀███▀ ▀███▀ ▀███▀ ██▄▄▄ ██▄▄▄ ██ ██   AGPL-3.0-or-later - see LICENSE

/**
 * A2UI action delivery tests (increment 3 of the A2UI design).
 *
 * Clicks become `[A2UI action]` user messages via conversation.sendMessage;
 * wantResponse actions mint an actionId, mark the control busy, and resolve
 * through a2ui_respond_action writing data.actionResponses. These tests
 * anchor the message format, context resolution, the cooldown/pending
 * guards (incl. the wedge-guard expiry), the busy overlay, and the respond
 * tool's bounded response store.
 *
 * Click tests use a STUB conversation: an instance wired to the real
 * conversation would route sendMessage into a real turn (and a real LLM
 * call). The stub captures the message; the message thread stays real so the
 * respond tool exercises the true updateContextItem path.
 * @module unit-tests/a2ui-actions
 */

import {
  initializeRegistries,
  createTestSession,
  createTestConversation,
  assert
} from '../utilities/test-helpers.js';
import A2uiSurfaceContextItem from '../../extensions/juggler-a2ui/context-items/a2ui-surface-context-item.js';
import {
  formatActionMessage, resolveActionContext, registerDispatch, clearPending,
  pendingFor, reconcileResponses, ACTION_COOLDOWN_MS, RESPONSE_TIMEOUT_MS
} from '../../extensions/juggler-a2ui/a2ui/actions.js';

/**
 * @typedef {object} TestResult
 * @property {number} passed - Count of assertions that passed.
 * @property {number} failed - Count of assertions that failed.
 * @property {string[]} errors - Messages from failed assertions.
 */

/**
 * Run all A2UI action tests.
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

  /**
   * A conversation stub capturing sendMessage calls; `dropReason` simulates a
   * refused send.
   * @param {string|null} [dropReason] - What sendMessage should return
   * @returns {{sent: string[], sendMessage: Function}} The stub
   */
  const makeConversationStub = (dropReason = null) => {
    /** @type {any} */
    const stub = { sent: [] };
    stub.sendMessage = async (/** @type {string} */ content) => {
      stub.sent.push(content);
      return dropReason;
    };
    return stub;
  };

  /**
   * Build a surface item instance with a stub conversation and the given
   * data, suitable for safe click tests.
   * @param {object} data - The surface data payload
   * @param {object} conversationStub - The capture stub
   * @returns {A2uiSurfaceContextItem} The instance
   */
  const makeSurface = (data, conversationStub) => {
    const item = new A2uiSurfaceContextItem(/** @type {any} */ ({
      id: `A2UI_${/** @type {any} */ (data).surfaceId}`,
      session: {},
      conversation: conversationStub,
      messageThread
    }));
    /** @type {any} */ (item).data = data;
    return item;
  };

  /**
   * @param {string} surfaceId - Surface id
   * @param {object} [buttonAction] - The Button's action payload
   * @returns {object} A minimal one-button surface data payload
   */
  const buttonSurface = (surfaceId, buttonAction = { event: { name: 'go' } }) => ({
    surfaceId,
    catalogId: 'a2ui.org/basic',
    rootId: 'btn',
    components: { btn: { id: 'btn', type: 'Button', props: { label: 'Go', action: buttonAction } } },
    dataModel: { user: { name: 'Ada' } },
    deleted: false
  });

  // ── pure helpers ─────────────────────────────────────────────────────────

  await check('formatActionMessage includes event, component, surface, context, actionId', () => {
    const full = formatActionMessage({
      surfaceId: 's1', componentId: 'btn', eventName: 'refresh',
      context: { row: 3 }, actionId: 'act_9'
    });
    assert(full.startsWith('[A2UI action]'), 'prefix present');
    assert(full.includes('"refresh"') && full.includes('"btn"') && full.includes('"s1"'), 'identities named');
    assert(full.includes('{"row":3}'), 'context serialized');
    assert(full.includes('a2ui_respond_action') && full.includes('act_9'), 'response contract named');
    const minimal = formatActionMessage({ surfaceId: 's1', componentId: 'b', eventName: 'go' });
    assert(!minimal.includes('Context:') && !minimal.includes('actionId'), 'optional parts omitted');
  });

  await check('resolveActionContext resolves nested {path} bindings', () => {
    const dataModel = { user: { name: 'Ada' }, rows: [1, 2] };
    const resolved = /** @type {any} */ (resolveActionContext(
      { who: { path: '/user/name' }, list: [{ path: '/rows/1' }, 'lit'], keep: 5 },
      dataModel
    ));
    assert(resolved.who === 'Ada', 'object binding resolved');
    assert(resolved.list[0] === 2 && resolved.list[1] === 'lit', 'array entries resolved/preserved');
    assert(resolved.keep === 5, 'literals preserved');
    assert(resolveActionContext(undefined, dataModel) === undefined, 'undefined passes through');
  });

  await check('pending lifecycle: cooldown expiry, response timeout, reconcile', () => {
    const t0 = 1000000;
    registerDispatch('sX', 'c1', undefined, t0);
    assert(pendingFor('sX', 'c1', t0 + ACTION_COOLDOWN_MS - 1), 'cooldown live before expiry');
    assert(!pendingFor('sX', 'c1', t0 + ACTION_COOLDOWN_MS), 'cooldown expires');
    registerDispatch('sX', 'c2', 'act_1', t0);
    assert(pendingFor('sX', 'c2', t0 + ACTION_COOLDOWN_MS + 1), 'wantResponse outlives cooldown');
    assert(!pendingFor('sX', 'c2', t0 + RESPONSE_TIMEOUT_MS), 'wedge guard expires pending');
    registerDispatch('sX', 'c3', 'act_2', t0);
    reconcileResponses('sX', { act_other: {} });
    assert(pendingFor('sX', 'c3', t0 + 1), 'unrelated response does not clear');
    reconcileResponses('sX', { act_2: { value: 1 } });
    assert(!pendingFor('sX', 'c3', t0 + 1), 'matching response clears pending');
    clearPending('sX', 'c1');
  });

  // ── click → message dispatch (stub conversation) ─────────────────────────

  await check('a Button click sends one [A2UI action] message; cooldown swallows the double-click', async () => {
    const stub = makeConversationStub();
    const item = makeSurface(buttonSurface('sA'), stub);
    const surfaceEl = /** @type {any} */ (item).getStatusUI().summary;
    const btn = surfaceEl.querySelector('.a2ui-button');
    btn.click();
    btn.click();
    await Promise.resolve();
    assert(stub.sent.length === 1, `expected 1 send, got ${stub.sent.length}`);
    assert(stub.sent[0].includes('Event "go" from component "btn" on surface "sA"'), `message format, got: ${stub.sent[0]}`);
    clearPending('sA', 'btn');
  });

  await check('action context resolves against the CURRENT dataModel at click time', async () => {
    const stub = makeConversationStub();
    const item = makeSurface(buttonSurface('sB', {
      event: { name: 'submit', context: { who: { path: '/user/name' } } }
    }), stub);
    /** @type {any} */ (item).getStatusUI().summary.querySelector('.a2ui-button').click();
    await Promise.resolve();
    assert(stub.sent[0].includes('Context: {"who":"Ada"}'), `resolved context, got: ${stub.sent[0]}`);
    clearPending('sB', 'btn');
  });

  await check('wantResponse mints an actionId and marks the control busy', async () => {
    const stub = makeConversationStub();
    const item = makeSurface(buttonSurface('sC', { event: { name: 'ask', wantResponse: true } }), stub);
    const btn = /** @type {any} */ (item).getStatusUI().summary.querySelector('.a2ui-button');
    btn.click();
    await Promise.resolve();
    assert(stub.sent[0].includes('a2ui_respond_action'), 'message names the response contract');
    assert(/actionId "act_[^"]+"/.test(stub.sent[0]), `actionId minted, got: ${stub.sent[0]}`);
    assert(btn.classList.contains('a2ui-action-pending') && btn.disabled, 'control busy while waiting');
    assert(pendingFor('sC', 'btn'), 'pending registered');
    clearPending('sC', 'btn');
  });

  await check('a dropped send clears the pending guard and busy state', async () => {
    const stub = makeConversationStub('conversation busy');
    const item = makeSurface(buttonSurface('sD', { event: { name: 'ask', wantResponse: true } }), stub);
    const btn = /** @type {any} */ (item).getStatusUI().summary.querySelector('.a2ui-button');
    btn.click();
    await Promise.resolve();
    await Promise.resolve();
    assert(!pendingFor('sD', 'btn'), 'pending cleared on drop');
    assert(!btn.disabled, 'busy state cleared on drop');
  });

  await check('local functionCall actions never dispatch to the agent', async () => {
    const stub = makeConversationStub();
    const item = makeSurface(buttonSurface('sE', { functionCall: { name: 'openUrl' } }), stub);
    /** @type {any} */ (item).getStatusUI().summary.querySelector('.a2ui-button').click();
    await Promise.resolve();
    assert(stub.sent.length === 0, 'functionCall stayed local');
  });

  // ── the respond tool against the real thread ─────────────────────────────

  const makeTool = (/** @type {string} */ toolName) => new A2uiSurfaceContextItem(/** @type {any} */ ({
    id: `exec_${toolName}`, session: {}, conversation: {}, messageThread, toolName
  }));

  await check('a2ui_respond_action writes the response and repaint clears the busy overlay', async () => {
    await makeTool('a2ui_create_surface').execute({
      surfaceId: 'sF', rootId: 'btn',
      components: [{ id: 'btn', type: 'Button', props: { label: 'Go', action: { event: { name: 'ask', wantResponse: true } } } }]
    });
    registerDispatch('sF', 'btn', 'act_42');
    const item = messageThread.getContextItem('A2UI_sF');
    let btn = /** @type {any} */ (item).getStatusUI().summary.querySelector('.a2ui-button');
    assert(btn.classList.contains('a2ui-action-pending'), 'busy overlay applied while pending');

    await makeTool('a2ui_respond_action').execute({ surfaceId: 'sF', actionId: 'act_42', value: { ok: true } });
    const d = /** @type {any} */ (messageThread.getContextItem('A2UI_sF').data);
    assert(d.actionResponses.act_42.value.ok === true, 'response stored in the doc');

    btn = /** @type {any} */ (messageThread.getContextItem('A2UI_sF')).getStatusUI().summary.querySelector('.a2ui-button');
    assert(!btn.classList.contains('a2ui-action-pending'), 'repaint reconciled the response and cleared busy');
    assert(!pendingFor('sF', 'btn'), 'pending entry gone');
  });

  await check('a2ui_respond_action with error stores the error; response store is bounded', async () => {
    await makeTool('a2ui_respond_action').execute({ surfaceId: 'sF', actionId: 'act_err', error: 'no such row' });
    let d = /** @type {any} */ (messageThread.getContextItem('A2UI_sF').data);
    assert(d.actionResponses.act_err.error === 'no such row', 'error stored');
    for (let i = 0; i < 6; i++) {
      await makeTool('a2ui_respond_action').execute({ surfaceId: 'sF', actionId: `act_bulk_${i}`, value: i });
    }
    d = /** @type {any} */ (messageThread.getContextItem('A2UI_sF').data);
    const keys = Object.keys(d.actionResponses);
    assert(keys.length === 5, `store bounded to 5, got ${keys.length}`);
    assert(!keys.includes('act_42') && !keys.includes('act_err'), 'oldest pruned first');
    assert(keys.includes('act_bulk_5'), 'newest kept');
  });

  await check('validate() enforces the respond contract', async () => {
    assert(!(await makeTool('a2ui_respond_action').validate({ surfaceId: 'sF' })).valid, 'actionId required');
    assert(!(await makeTool('a2ui_respond_action').validate({ actionId: 'a' })).valid, 'surfaceId required');
    assert((await makeTool('a2ui_respond_action').validate({ surfaceId: 'sF', actionId: 'a' })).valid, 'value optional');
  });

  return { passed, failed, errors };
}
