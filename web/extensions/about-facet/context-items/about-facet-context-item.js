//     ▄▄ ▄▄ ▄▄  ▄▄▄▄  ▄▄▄▄ ▄▄    ▄▄▄▄▄ ▄▄▄▄
//     ██ ██ ██ ██ ▄▄ ██ ▄▄ ██    ██▄▄  ██▄█▄   Copyright (c) 2026 Julian Storer
//   ▄▄█▀ ▀███▀ ▀███▀ ▀███▀ ██▄▄▄ ██▄▄▄ ██ ██   Apache-2.0 - see LICENSE
// SPDX-License-Identifier: Apache-2.0

import ContextItem from 'facet/context-item';
import keyShortcutManager, { isMac, formatBindingForPlatform } from '../../../js/services/key-shortcut-manager.js';
import CORPUS from '../corpus.js';

/**
 * The platform's real log directory, mirroring internal/logpaths/logpaths.go so
 * the manual points a user at the right place. Kept as a small pure table rather
 * than an app call because execute() has no filesystem/env access.
 * @param {string} platform - session.platform: 'darwin' | 'linux' | 'windows'
 * @returns {string} A human-readable log location for that platform
 */
function logLocationFor(platform) {
  switch (platform) {
    case 'darwin': return '~/Library/Logs/Facet';
    case 'windows': return '%LOCALAPPDATA%\\Facet\\Logs';
    case 'linux': return '$XDG_STATE_HOME/facet/logs (default ~/.local/state/facet/logs)';
    default: return 'your platform\u2019s standard log directory';
  }
}

/**
 * Render the live keyboard-shortcut table as markdown, each binding formatted
 * for the given platform. Sourced from the app's own KeyShortcutManager, so it
 * always matches the real key map (and any future user overrides) instead of a
 * frozen copy in the corpus.
 * @param {boolean} mac - True to render macOS glyphs, false for Ctrl+ style
 * @returns {string} Markdown: one bulleted list per shortcut category
 */
function shortcutsMarkdownFor(mac) {
  const lines = [];
  for (const group of keyShortcutManager.byCategory()) {
    lines.push(`**${group.category}**`, '');
    for (const def of group.shortcuts) {
      const binding = keyShortcutManager.getBinding(def.id);
      const combo = binding ? formatBindingForPlatform(binding, mac) : '(unbound)';
      lines.push(`- ${combo} — ${def.label}: ${def.description}`);
    }
    lines.push('');
  }
  return lines.join('\n').trim();
}

/**
 * Fill the corpus's platform placeholders from the live session platform.
 * @param {string} platform - session.platform ('' when not yet hydrated)
 * @returns {string} The fully-resolved manual
 */
function buildCorpus(platform) {
  // session.platform is authoritative for the host; fall back to a navigator
  // sniff only when it is absent (e.g. a not-yet-hydrated session).
  const mac = platform ? platform === 'darwin' : isMac();
  return CORPUS
    .replace('{{KEYBOARD_SHORTCUTS}}', shortcutsMarkdownFor(mac))
    .replace('{{LOG_LOCATION}}', logLocationFor(platform));
}

/**
 * @typedef {object} AboutFacetParams
 * @property {string} [question] - Optional: what the user wants to know about
 *   Facet. Recorded for display only; the whole manual is returned regardless.
 */

/**
 * @typedef {object} AboutFacetResult
 * @property {string} corpus - The full About-Facet reference manual (markdown)
 * @property {string} [question] - The question the model passed, if any
 */

/**
 * AboutFacetContextItem — answer questions about Facet itself.
 *
 * A deliberately tiny, on-demand tool: its only cost on a normal turn is its
 * one-line tool definition (billed at the cache-read rate). The reference manual
 * (imported CORPUS) enters context ONLY when the model actually calls the tool,
 * so it is free unless a chat genuinely needs it. Shipped as its own extension
 * (@facet/about), on by default; disabling the extension removes this tool and
 * unloads the corpus entirely.
 *
 * The manual is BUNDLED with the app, not read from the user's project — the
 * read tool is path-scoped to the project and cannot reach shipped docs, so the
 * corpus travels as an imported module instead. The imported corpus is a generic
 * cross-platform base; execute() fills its platform placeholders (the keyboard
 * shortcut table and log location) from the live session's platform, so the
 * answer is correct for the machine being described.
 * @class
 * @augments ContextItem
 */
class AboutFacetContextItem extends ContextItem {
  /** @returns {{color: string, icon?: string}} Badge options */
  static getBadgeOptions() {
    return { color: 'web', icon: 'icon-search' };
  }

  static MANIFEST = {
    id: 'about-facet',
    name: 'About Facet',
    version: '1.0.0',
    description: 'Answer questions about the Facet application itself',
    author: 'Facet Team',
    requiresApproval: false
  };

  /**
   * Get tool definitions for the AboutFacet action.
   *
   * The description is intentionally tightly scoped so the model reaches for this
   * only when the user is asking about Facet itself — not about their code.
   * @returns {Array<{name: string, category: string, description: string, input_schema: object}>} Tool definitions
   */
  static getToolDefinitions() {
    const inputSchema = {
      type: 'object',
      properties: {
        question: {
          type: 'string',
          description: 'Optional: the specific thing the user wants to know about '
            + 'Facet, recorded for display. The full manual is returned regardless.'
        }
      },
      required: []
    };

    const description = 'Returns Facet\'s own reference manual: what Facet is, '
      + 'its tools, strategies, slash-commands, keyboard shortcuts, supported model '
      + 'providers, configuration and data locations, and extensions. Call this ONLY '
      + 'when the user asks about Facet itself — the application, its features, UI, '
      + 'shortcuts, config, or how to use it. Do NOT call it for questions about the '
      + 'user\'s own code, project, or general programming. One call returns the whole manual.';

    return [
      {
        name: 'AboutFacet',
        category: 'read',
        description,
        input_schema: inputSchema
      }
    ];
  }

  /**
   * Validate parameters. All fields are optional, so this only type-checks a
   * supplied question.
   * @override
   * @param {Record<string, unknown>} toolInput - Raw parameters from LLM
   * @returns {Promise<import('facet/context-item').ValidationResult>} Validation result
   */
  async validate(toolInput) {
    const params = /** @type {AboutFacetParams} */ (toolInput);
    if (params.question !== undefined && typeof params.question !== 'string') {
      return { valid: false, error: 'Parameter "question" must be a string' };
    }
    return { valid: true, params: toolInput };
  }

  /**
   * Execute — return the bundled corpus with its platform placeholders resolved
   * for the live session. No I/O, no network: the base manual is an imported
   * module string and the injected parts come from in-process app state.
   * @param {Record<string, unknown>} params - Prepared params
   * @returns {Promise<AboutFacetResult>} The manual (and echoed question)
   */
  async execute(params) {
    const p = /** @type {AboutFacetParams} */ (params);
    const platform = (this.session && this.session.platform) || '';
    return { corpus: buildCorpus(platform), question: p.question };
  }

  /**
   * Format the outcome for the LLM tool_result and simple display. The corpus is
   * the tool_result content.
   * @param {import('facet/context-item').Outcome} outcome - Action outcome
   * @returns {import('facet/context-item').ItemSummary} Formatted result
   */
  getSummary(outcome) {
    if (!outcome.success) {
      return {
        summary: outcome.error || 'Failed to load the Facet manual',
        details: '',
        success: false,
        icon: '✗'
      };
    }

    const result = /** @type {AboutFacetResult} */ (outcome.result);
    return {
      summary: result.corpus || buildCorpus(''),
      details: '',
      success: true,
      icon: '✓'
    };
  }

  /**
   * Status UI: a small lozenge summarising the lookup.
   * @override
   * @param {import('../../../js/services/action-executor.js').ActionStatus|null} actionStatus - Action execution status
   * @param {Record<string, unknown>} toolInput - Original tool input parameters
   * @returns {import('facet/context-item').ResultStatusMessage|null} Status message config
   */
  getStatusUI(actionStatus, toolInput) {
    if (!actionStatus) {
      return null;
    }

    const question = toolInput && typeof toolInput.question === 'string' ? toolInput.question : '';

    /** @type {import('facet/context-item').ResultStatus|undefined} */
    let status;
    let summary;
    if (actionStatus.pending) {
      summary = 'Looking up Facet\u2026';
      status = 'running';
    } else if (actionStatus.success) {
      summary = question ? question : 'About Facet';
      status = 'success';
    } else {
      ({ summary, status } = this.resolveTerminalStatus(actionStatus, 'Failed'));
    }

    return { typeName: 'About Facet', summary, status };
  }

  /**
   * @override
   * @param {string} _toolName
   * @returns {string} Section label
   */
  static getResultSectionLabel(_toolName) {
    return 'Manual';
  }
}

export default AboutFacetContextItem;
