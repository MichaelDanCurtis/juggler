//     ▄▄ ▄▄ ▄▄  ▄▄▄▄  ▄▄▄▄ ▄▄    ▄▄▄▄▄ ▄▄▄▄
//     ██ ██ ██ ██ ▄▄ ██ ▄▄ ██    ██▄▄  ██▄█▄   Copyright (c) 2026 Julian Storer
//   ▄▄█▀ ▀███▀ ▀███▀ ▀███▀ ██▄▄▄ ██▄▄▄ ██ ██   AGPL-3.0-or-later - see LICENSE

/**
 * Integration Tests: A2UI surface tools
 *
 * End-to-end through the REAL pipeline (only the LLM mocked): the model calls
 * a2ui_create_surface / a2ui_update_data_model, the user approves, and a
 * standalone `a2ui-surface` item lands in the doc — created by the first tool
 * and mutated in place (same itemId, same position) by the second. This is
 * the proof that the extension's tools are registered, approval-gated, and
 * persist their surface through the sanctioned context-item path.
 * @module integration-tests/a2ui-tests
 */

import { textResponse, toolUseResponse } from '../utilities/integration-test-runner.js';

/**
 * A minimal dashboard surface: a bound Text the second test mutates.
 * @param {string} surfaceId - Surface id to create
 * @returns {object} a2ui_create_surface params
 */
function dashboardParams(surfaceId) {
  return {
    surfaceId,
    rootId: 'root',
    components: [
      { id: 'root', type: 'Column', children: ['title', 'cpu'] },
      { id: 'title', type: 'Text', props: { text: 'Status' } },
      { id: 'cpu', type: 'Text', props: { text: { path: '/cpu' } } }
    ],
    dataModel: { cpu: '42%' }
  };
}

/**
 * Creating a surface requires approval and lands a standalone item.
 * @type {import('../utilities/integration-test-runner.js').IntegrationTestDefinition}
 */
export const a2uiCreateSurfaceTest = {
  name: 'a2ui-create-surface',
  description: 'a2ui_create_surface is approval-gated and inserts a standalone a2ui-surface item',
  fixture: 'unit-test-fixture',

  llmResponses: [
    toolUseResponse('call_1', 'a2ui_create_surface', dashboardParams('dash'), 'Rendering a status surface.'),
    textResponse('Surface is up.')
  ],

  operations: [
    { type: 'send-message', message: 'Show me a status dashboard' },
    { type: 'wait-for-approval', toolUseId: 'call_1' },
    { type: 'approve', toolUseId: 'call_1' }
  ],

  expectedItems: [
    { type: 'system-prompt' },
    { type: 'user', content: 'Show me a status dashboard' },
    { type: 'assistant', content: 'Rendering a status surface.' },
    { type: 'tool-action', toolName: 'a2ui_create_surface', state: 'completed' },
    // itemId is 'A2UI_dash' in the doc, but the comparator normalizes ids to
    // $ITEM_N placeholders, so only the type is asserted here; the
    // deterministic-id contract is anchored by the unit suite.
    { type: 'a2ui-surface' },
    { type: 'assistant', content: 'Surface is up.' }
  ]
};

/**
 * A later tool call mutates the SAME item in place — the long-lived-surface
 * contract: same itemId, same doc position, new data.
 * @type {import('../utilities/integration-test-runner.js').IntegrationTestDefinition}
 */
export const a2uiUpdateDataModelTest = {
  name: 'a2ui-update-data-model',
  description: 'a2ui_update_data_model mutates the existing surface item in place',
  fixture: 'unit-test-fixture',

  llmResponses: [
    toolUseResponse('call_1', 'a2ui_create_surface', dashboardParams('live'), 'Rendering.'),
    toolUseResponse('call_2', 'a2ui_update_data_model', { surfaceId: 'live', path: '/cpu', value: '97%' }, 'Updating the reading.'),
    textResponse('Updated.')
  ],

  operations: [
    { type: 'send-message', message: 'Show live CPU' },
    { type: 'wait-for-approval', toolUseId: 'call_1' },
    { type: 'approve', toolUseId: 'call_1' },
    { type: 'wait-for-approval', toolUseId: 'call_2' },
    { type: 'approve', toolUseId: 'call_2' }
  ],

  expectedItems: [
    { type: 'system-prompt' },
    { type: 'user', content: 'Show live CPU' },
    { type: 'assistant', content: 'Rendering.' },
    { type: 'tool-action', toolName: 'a2ui_create_surface', state: 'completed' },
    // The surface stays at its creation position: call_2 mutated it in place.
    // A second a2ui-surface item anywhere would shift every later position
    // and fail the assertions below.
    { type: 'a2ui-surface' },
    { type: 'assistant', content: 'Updating the reading.' },
    { type: 'tool-action', toolName: 'a2ui_update_data_model', state: 'completed' },
    { type: 'assistant', content: 'Updated.' }
  ]
};

export const tests = [a2uiCreateSurfaceTest, a2uiUpdateDataModelTest];
