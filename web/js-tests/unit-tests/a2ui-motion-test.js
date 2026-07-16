//     ▄▄ ▄▄ ▄▄  ▄▄▄▄  ▄▄▄▄ ▄▄    ▄▄▄▄▄ ▄▄▄▄
//     ██ ██ ██ ██ ▄▄ ██ ▄▄ ██    ██▄▄  ██▄█▄   Copyright (c) 2026 Julian Storer
//   ▄▄█▀ ▀███▀ ▀███▀ ▀███▀ ██▄▄▄ ██▄▄▄ ██ ██   AGPL-3.0-or-later - see LICENSE

/**
 * A2UI motion tests (increment 5 of the A2UI design). All motion is CSS
 * classes + keyframes wrapped in prefers-reduced-motion, so every tier is
 * assertable as plain DOM state: value-change pulses derive from a data-model
 * diff against per-surface memory, entry classes apply exactly once per
 * component, ambient pulse/flow classes tag the declared elements, and the
 * injected stylesheet is idempotent and reduced-motion-gated.
 * @module unit-tests/a2ui-motion
 */

import { assert } from '../utilities/test-helpers.js';
import { renderSurface } from '../../extensions/juggler-a2ui/a2ui/renderer.js';
import {
  applyMotion, resetMotion, ensureMotionStyles, diffChangedPaths,
  componentBoundPaths, pathAffected
} from '../../extensions/juggler-a2ui/a2ui/motion.js';

/**
 * @typedef {object} TestResult
 * @property {number} passed - Count of assertions that passed.
 * @property {number} failed - Count of assertions that failed.
 * @property {string[]} errors - Messages from failed assertions.
 */

/**
 * Render a surface and run motion over it, as the card does per repaint.
 * @param {string} surfaceId - Surface id (motion memory key)
 * @param {Record<string, object>} components - Components keyed by id
 * @param {object} dataModel - Data model
 * @returns {HTMLElement} The rendered surface with motion applied
 */
function paint(surfaceId, components, dataModel) {
  const surface = { surfaceId, rootId: Object.keys(components)[0], components, dataModel };
  const el = renderSurface(surface, {});
  applyMotion(el, surface);
  return el;
}

/**
 * Run all A2UI motion tests.
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

  // ── pure diff/paths helpers ──────────────────────────────────────────────

  check('diffChangedPaths reports changed, added, and removed paths', () => {
    const changed = diffChangedPaths(
      { cpu: 1, disk: { used: 5 }, gone: true },
      { cpu: 2, disk: { used: 5 }, fresh: 'x' }
    );
    assert(changed.has('/cpu'), 'changed leaf');
    assert(changed.has('/gone') && changed.has('/fresh'), 'removed + added');
    assert(!changed.has('/disk/used') && !changed.has('/disk'), 'unchanged subtree silent');
  });

  check('componentBoundPaths walks nested props for absolute bindings', () => {
    const paths = componentBoundPaths({
      props: {
        text: { path: '/a' },
        data: { path: '/series' },
        nested: { deep: [{ path: '/b/c' }, 'lit'] },
        relative: { path: 'no-slash' }
      }
    });
    assert(paths.includes('/a') && paths.includes('/series') && paths.includes('/b/c'), 'absolute paths found');
    assert(!paths.includes('no-slash'), 'relative paths skipped');
  });

  check('pathAffected matches exact, ancestor, and descendant overlaps', () => {
    assert(pathAffected('/a/b', new Set(['/a/b'])), 'exact');
    assert(pathAffected('/a/b', new Set(['/a'])), 'binding under a replaced subtree');
    assert(pathAffected('/a', new Set(['/a/b'])), 'binding over a changed leaf');
    assert(!pathAffected('/a/b', new Set(['/a/bc'])), 'sibling prefix is NOT an overlap');
  });

  // ── stylesheet ───────────────────────────────────────────────────────────

  check('motion stylesheet injects once and is reduced-motion gated', () => {
    ensureMotionStyles();
    ensureMotionStyles();
    const styles = document.querySelectorAll('#a2ui-motion-styles');
    assert(styles.length === 1, 'idempotent injection');
    assert(styles[0].textContent.includes('prefers-reduced-motion: no-preference'),
      'every rule sits behind the reduced-motion gate');
  });

  // ── tiers against rendered surfaces ──────────────────────────────────────

  const TEXT_BOUND = { id: 't', type: 'Text', props: { text: { path: '/msg' }, animate: { enter: 'fade' } } };

  check('entry class applies on first paint only', () => {
    resetMotion('m1');
    const first = paint('m1', { t: TEXT_BOUND }, { msg: 'a' });
    assert(first.querySelector('[data-a2ui-id="t"]').classList.contains('a2ui-enter-fade'), 'first paint enters');
    const second = paint('m1', { t: TEXT_BOUND }, { msg: 'a' });
    assert(!second.querySelector('[data-a2ui-id="t"]').classList.contains('a2ui-enter-fade'), 'repaint does not re-enter');
  });

  check('value change pulses exactly the components bound to it', () => {
    resetMotion('m2');
    const components = {
      row: { id: 'row', type: 'Row', children: ['bound', 'other'] },
      bound: { id: 'bound', type: 'Text', props: { text: { path: '/msg' } } },
      other: { id: 'other', type: 'Text', props: { text: { path: '/stable' } } }
    };
    paint('m2', components, { msg: 'a', stable: 1 });
    const el = paint('m2', components, { msg: 'b', stable: 1 });
    assert(el.querySelector('[data-a2ui-id="bound"]').classList.contains('a2ui-value-changed'), 'bound component pulses');
    assert(!el.querySelector('[data-a2ui-id="other"]').classList.contains('a2ui-value-changed'), 'unaffected component still');
    const el3 = paint('m2', components, { msg: 'b', stable: 1 });
    assert(!el3.querySelector('[data-a2ui-id="bound"]').classList.contains('a2ui-value-changed'), 'no change → no pulse');
  });

  check('first paint never pulses (entry covers it)', () => {
    resetMotion('m3');
    const el = paint('m3', { t: { id: 't', type: 'Text', props: { text: { path: '/x' } } } }, { x: 1 });
    assert(!el.querySelector('[data-a2ui-id="t"]').classList.contains('a2ui-value-changed'), 'no pulse on first paint');
  });

  check('diagram nodes with pulse:true get the heartbeat class', () => {
    resetMotion('m4');
    const el = paint('m4', {
      d: {
        id: 'd', type: 'Diagram', props: {
          nodes: [
            { id: 'fw', symbol: 'firewall', pulse: true },
            { id: 'srv', symbol: 'server' }
          ],
          edges: [{ from: 'fw', to: 'srv', flow: true }]
        }
      }
    }, {});
    assert(el.querySelector('[data-node-id="fw"]').classList.contains('a2ui-pulse'), 'pulsing node tagged');
    assert(!el.querySelector('[data-node-id="srv"]').classList.contains('a2ui-pulse'), 'quiet node untouched');
    assert(el.querySelector('line.a2ui-edge-flow'), 'flow edge carries the ambient class (animated by the stylesheet)');
  });

  check('resetMotion replays entry animations for a recreated surface', () => {
    resetMotion('m5');
    paint('m5', { t: TEXT_BOUND }, { msg: 'a' });
    resetMotion('m5');
    const el = paint('m5', { t: TEXT_BOUND }, { msg: 'a' });
    assert(el.querySelector('[data-a2ui-id="t"]').classList.contains('a2ui-enter-fade'), 'entry replayed after reset');
  });

  return { passed, failed, errors };
}
