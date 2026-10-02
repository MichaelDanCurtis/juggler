// Copyright (c) 2026 Julian Storer
// AGPL-3.0-or-later - see LICENSE

/**
 * Agents pane unit test (Prizmanyx roster slice 4).
 *
 * The roster's two load-bearing claims are density and honesty, and both are
 * testable without a running Prizmanyx:
 *
 *  - BLAST RADIUS is derived from the definition, never written by hand, so a
 *    template card cannot promise a narrower agent than it starts. An agent
 *    that deposits nothing must SAY it deposits nothing — the default, and the
 *    one a consultant is most likely to skim past.
 *  - ELAPSED degrades rather than lies: a missing or unparseable timestamp
 *    renders as nothing, never as "NaNs" or a wrong duration on a card someone
 *    is using to decide whether an agent is stuck.
 * @module unit-tests/agents-pane-test
 */

import { FacetAgentsPane, blastRadius, elapsed, groupByStage } from '../../js/components/facet-agents-pane.js';
import { FacetWorkspacePane } from '../../js/components/facet-workspace-pane.js';
import { clearPzxContext, getPzxContext, setPzxContext } from '../../js/utils/prizmanyx-context.js';

/**
 * @param {any} _ctx
 * @returns {Promise<{passed: number, failed: number, errors: string[]}>} The suite result.
 */
export async function runTests(_ctx) {
  let passed = 0;
  let failed = 0;
  const errors = [];

  /**
   * @param {string} name
   * @param {() => void} fn
   * @returns {void} Nothing; failures are collected.
   */
  function run(name, fn) {
    try {
      fn();
      passed += 1;
    } catch (error) {
      failed += 1;
      errors.push(`${name}: ${error && error.message ? error.message : error}`);
    }
  }

  /**
   * @param {boolean} condition
   * @param {string} message
   * @returns {void} Nothing; throws on failure.
   */
  function assert(condition, message) {
    if (!condition) throw new Error(message);
  }

  run('blast radius names what the agent SAVES, not just what it reads', () => {
    const text = blastRadius({
      tool_ids: ['discovery.listGaps', 'knowledge.search'],
      deposit_kinds: ['finding'],
      default_budget_calls: 300,
    });
    assert(text.includes('READS 2 tools'), `reads: ${text}`);
    assert(text.includes('SAVES finding'), `saves: ${text}`);
    assert(text.includes('BUDGET 300'), `budget: ${text}`);
  });

  run('an agent that deposits nothing says so explicitly', () => {
    // The default. Silence here would read as "unknown" on the card that is
    // meant to tell you the blast radius BEFORE you start the agent.
    const text = blastRadius({ tool_ids: ['knowledge.search'], deposit_kinds: [], default_budget_calls: 50 });
    assert(text.includes('SAVES nothing'), `expected an explicit nothing: ${text}`);
    assert(text.includes('READS 1 tool'), `singular tool: ${text}`);
  });

  run('a missing budget renders a question mark, never undefined', () => {
    const text = blastRadius({ tool_ids: [], deposit_kinds: [] });
    assert(!text.includes('undefined'), `leaked undefined: ${text}`);
    assert(text.includes('BUDGET ?'), `budget: ${text}`);
  });

  run('elapsed formats seconds, minutes and hours', () => {
    const now = Date.now();
    assert(elapsed(new Date(now - 30_000).toISOString()).endsWith('s'), 'seconds');
    assert(elapsed(new Date(now - 300_000).toISOString()) === '5m', 'minutes');
    assert(elapsed(new Date(now - 3_900_000).toISOString()) === '1h5m', 'hours');
  });

  run('elapsed degrades to empty rather than lying', () => {
    // A card showing "NaNs" is worse than one showing nothing: the operator is
    // reading it to judge whether an agent is stuck.
    assert(elapsed(null) === '', 'null');
    assert(elapsed('') === '', 'empty');
    assert(elapsed('not a date') === '', 'garbage');
  });

  run('templates group under every stage they serve', () => {
    const groups = groupByStage([
      { name: 'a', stages: ['discover', 'code'] },
      { name: 'b', stages: ['deploy'] },
      { name: 'c', stages: [] },
    ]);
    assert(groups.discover.length === 1, 'discover');
    assert(groups.code.length === 1, 'an agent serving two stages appears under both');
    assert(groups.deploy.length === 1, 'deploy');
    assert(groups.unassigned.length === 1, 'a stageless agent is still reachable, not hidden');
  });

  run('an unknown stage does not silently swallow an agent', () => {
    // The binding is suggestive, and the server enforces the vocabulary with a
    // CHECK — but a definition written before a stage was renamed must not
    // vanish from the only surface that can start it.
    const groups = groupByStage([{ name: 'a', stages: ['nonsense'] }]);
    assert(groups.unassigned.length === 1, 'an agent with only unknown stages falls back');
  });

  run('a missing stages field is tolerated, not thrown on', () => {
    const groups = groupByStage([{ name: 'a' }, null]);
    assert(groups.unassigned.length === 1, 'undefined stages behaves like []');
  });

  const originalFetch = window.fetch;
  const originalContext = getPzxContext();
  /** @type {Array<{url: string, init: RequestInit}>} */
  const requests = [];
  window.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    return new window.Response(JSON.stringify({ files: [] }), { status: 200 });
  };
  try {
    const context = {
      programId: 7, version: 2, token: 'gateway-read', webBase: location.origin,
      expires: Math.floor(Date.now() / 1000) + 300,
      workspaceReadToken: 'workspace-read', workspaceWriteToken: 'workspace-write',
      agentReadToken: 'agent-read', agentWriteToken: 'agent-write',
    };
    setPzxContext(context);
    const workspace = new FacetWorkspacePane();
    const agents = new FacetAgentsPane();
    assert(workspace._target()?.token === 'workspace-read', 'workspace read scope');
    assert(agents._target()?.token === 'agent-read', 'agent read scope');
    workspace._load = async () => {};
    workspace._render = () => {};
    agents._load = async () => {};
    agents._render = () => {};
    const transfer = new window.DataTransfer();
    transfer.items.add(new window.File(['{}'], 'fixture.json'));
    await workspace._upload(transfer.files);
    await workspace._delete('fixture.json');
    for (const path of ['/spawn', '/runs/1/answer', '/runs/1/cancel']) await agents._post(path, {});
    const mutations = requests.filter((request) => request.url.startsWith('/pzx/'));
    assert(mutations.length === 5, 'all workspace and agent mutations were exercised');
    for (const request of mutations) {
      assert(!request.url.includes('t='), 'a write capability escaped into a URL');
      const expected = request.url.includes('/workspace/') ? 'workspace-write' : 'agent-write';
      assert(new window.Headers(request.init.headers).get('Authorization') === `Bearer ${expected}`, 'write Bearer scope');
    }
    setPzxContext({ ...context, workspaceWriteToken: undefined, agentWriteToken: undefined });
    const before = requests.length;
    await workspace._delete('fixture.json');
    await agents._post('/spawn', {});
    assert(requests.length === before, 'read-only contexts must never attempt a mutation');
    clearPzxContext();
    assert(getPzxContext() === null, 'switching programs clears old capabilities');
    passed += 1;
  } catch (error) {
    failed += 1;
    errors.push(`scoped capabilities: ${error instanceof Error ? error.message : error}`);
  } finally {
    if (originalContext) setPzxContext(originalContext);
    else clearPzxContext();
    window.fetch = originalFetch;
  }
  return { passed, failed, errors };
}
