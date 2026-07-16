//     ▄▄ ▄▄ ▄▄  ▄▄▄▄  ▄▄▄▄ ▄▄    ▄▄▄▄▄ ▄▄▄▄
//     ██ ██ ██ ██ ▄▄ ██ ▄▄ ██    ██▄▄  ██▄█▄   Copyright (c) 2026 Julian Storer
//   ▄▄█▀ ▀███▀ ▀███▀ ▀███▀ ██▄▄▄ ██▄▄▄ ██ ██   Apache-2.0 - see LICENSE
// SPDX-License-Identifier: Apache-2.0

import ContextItem from 'juggler/context-item';

/**
 * A2UI surfaces — agent-driven declarative UI rendered natively in the
 * conversation (see `scratch/a2ui/design.md` for the full approved design and
 * https://a2ui.org for the protocol).
 *
 * **Increment 1 (current):** the extension scaffold plus the pure renderer
 * modules under `../a2ui/` (data model, basic catalog, surface renderer),
 * exercised by the `unit:a2ui-renderer` suite. This class registers the
 * capability but deliberately declares **no tools yet** — the model cannot
 * create surfaces until the doc-backed `a2ui-surface` item type lands.
 *
 * **Increment 2 (next):** the `a2ui-surface` item type (SCHEMA.md +
 * document.go mirror) and the tool suite (`a2ui_create_surface`,
 * `a2ui_update_components`, `a2ui_update_data_model`, `a2ui_delete_surface`),
 * with this class fronting all of them (the MCP-bridge one-class/many-tools
 * pattern) and rendering surfaces in the Miller column via the renderer.
 * @augments ContextItem
 */
class A2uiSurfaceContextItem extends ContextItem {
  static MANIFEST = {
    id: 'a2ui-surface',
    name: 'A2UI Surfaces',
    version: '0.1.0',
    description: 'Agent-driven interactive UI surfaces (A2UI protocol) rendered natively in the conversation',
    author: 'Juggler Team'
  };

  /** @returns {string} Short type label shown on item cards and the permissions popup */
  static getTypeName() {
    return 'A2UI';
  }

  /**
   * No tools in increment 1: the base class's empty default applies. The
   * override exists purely to anchor this comment where increment 2 will add
   * the surface tool suite.
   * @returns {Array<object>} No tool definitions yet
   */
  static getToolDefinitions() {
    return [];
  }

  /**
   * Format an action outcome. Unreachable while no tools are declared, but
   * the framework contract requires a well-formed summary for any outcome.
   * @param {import('juggler/context-item').Outcome} outcome - Action outcome
   * @returns {import('juggler/context-item').ItemSummary} Formatted result
   */
  getSummary(outcome) {
    if (!outcome.success) {
      return { summary: outcome.error || 'A2UI operation failed', details: '', success: false, icon: '✗' };
    }
    return { summary: 'A2UI operation completed', details: '', success: true, icon: '✓' };
  }
}

export default A2uiSurfaceContextItem;
