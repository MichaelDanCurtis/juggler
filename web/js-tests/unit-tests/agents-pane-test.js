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

  run('brief survives template replacement and uses the edited stage card', () => {
    const pane = new FacetAgentsPane();
    const definition = { name: 'audit', stages: ['discover', 'code'] };
    pane.innerHTML = pane._renderTemplate(definition) + pane._renderTemplate(definition);
    pane._wire();
    const fields = pane.querySelectorAll('textarea');
    fields[1].value = 'Keep this draft <intact>';
    fields[1].dispatchEvent(new Event('input'));
    pane.innerHTML = pane._renderTemplate(definition);
    assert(pane.querySelector('textarea').value === 'Keep this draft <intact>', 'draft lost on refresh');
    assert(pane._briefs.get('audit') === 'Keep this draft <intact>', 'second stage card ignored');
  });

  run('missing journal data never claims no tools ran', () => {
    const pane = new FacetAgentsPane();
    const markup = pane._renderJournal({ calls_used: 12 });
    assert(markup.includes('not available'), 'missing journal presented as empty history');
  });

  run('terminal cards show their outcome and do not offer cancellation', () => {
    const pane = new FacetAgentsPane();
    pane._expanded.add(7);
    for (const status of ['succeeded', 'failed', 'cancelled']) {
      pane.innerHTML = pane._renderRun({ id: 7, status, result: 'Result <safe>', error_detail: 'Failure <safe>' });
      assert(!pane.querySelector('[data-cancel]'), `${status} still offers Stop`);
      assert(pane.textContent.includes('Result <safe>'), `${status} hides result`);
      assert(pane.textContent.includes('Failure <safe>'), `${status} hides error`);
    }
    pane.innerHTML = pane._renderRun({ id: 7, status: 'running' });
    assert(!!pane.querySelector('[data-cancel]'), 'running agent cannot be stopped');
  });

  run('blocked answer and option selection survive replacement', () => {
    const pane = new FacetAgentsPane();
    const blocked = { id: 7, status: 'blocked', blocked_payload: { options: ['Review first'] } };
    pane.innerHTML = pane._renderRun(blocked);
    pane._wire();
    const field = pane.querySelector('textarea');
    field.value = 'My answer <safe>';
    field.dispatchEvent(new Event('input'));
    pane.innerHTML = pane._renderRun(blocked);
    pane._wire();
    assert(pane.querySelector('textarea').value === 'My answer <safe>', 'typed answer lost');
    pane.querySelector('[data-answer-option]').click();
    pane.innerHTML = pane._renderRun(blocked);
    assert(pane.querySelector('textarea').value === 'Review first', 'selected option lost');
  });

  run('finished disclosure survives roster replacement', () => {
    const pane = new FacetAgentsPane();
    pane._target = () => ({ base: '/audit', token: '', programId: 7 });
    pane._runs = [{ id: 7, status: 'succeeded' }];
    pane._render();
    const finished = pane.querySelector('details');
    finished.open = true;
    pane.querySelector('[data-toggle]').click();
    assert(pane.querySelector('details').open, 'finished disclosure collapsed');
  });

  const originalFetch = globalThis.fetch;
  try {
    const pane = new FacetAgentsPane();
    pane._target = () => ({ base: '/audit-agents', token: '', programId: 7 });
    pane._render = () => {};
    globalThis.fetch = async (url, options) => {
      if (String(url).startsWith('/audit-agents/')) {
        return String(url).includes('/definitions')
          ? new globalThis.Response('{}', { status: 401 }) : new globalThis.Response('[]');
      }
      return originalFetch(url, options);
    };
    await pane._load();
    run('a successful run load cannot hide a definitions authorization error', () => {
      assert(pane._error.includes('Not authorized'), `authorization error lost: ${pane._error}`);
    });
    pane._get = async () => [];
    pane._draftProgramId = 7;
    pane._answers.set('7', 'old answer');
    await pane._load();
    run('answers clear when their run leaves blocked state', () => {
      assert(pane._answers.size === 0, 'stale answer retained');
    });
    pane._briefs.set('audit', 'old program brief');
    pane._answers.set('7', 'old program answer');
    pane._draftProgramId = 8;
    await pane._load();
    run('drafts do not cross program boundaries', () => {
      assert(pane._briefs.size === 0 && pane._answers.size === 0, 'draft crossed program boundary');
    });
  } catch (error) {
    failed += 1;
    errors.push(`roster refresh: ${error.message}`);
  } finally {
    globalThis.fetch = originalFetch;
  }

  return { passed, failed, errors };
}
