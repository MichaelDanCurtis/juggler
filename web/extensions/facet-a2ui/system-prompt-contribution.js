// Copyright (c) 2026 Julian Storer
// Apache-2.0 - see LICENSE
// SPDX-License-Identifier: Apache-2.0

/**
 * System-prompt contribution for `@facet/a2ui`. Terse by contract: this text
 * lives in every turn's cached prompt. It teaches the two things tool
 * descriptions cannot: when to reach for a surface at all, and how to read
 * the `[A2UI action]` user messages that clicks produce.
 * @param {{enabledPluginIds: string[]}} ctx - Enabled-plugin set
 * @returns {string} Prompt section (may be empty)
 */
export default function systemPromptContribution({ enabledPluginIds }) {
  if (!enabledPluginIds.includes('a2ui-surface')) return '';
  return [
    '## A2UI surfaces',
    'The a2ui_* tools render persistent interactive UI (dashboards, status cards, structured layouts) inline in the conversation. Prefer a surface over prose when the user asks to "show", monitor, or interact with structured data; update it across turns with a2ui_update_data_model rather than re-creating it.',
    'A user message starting with "[A2UI action]" is a click on such a surface — it names the event, component, surface, and resolved context. React by updating the surface (or answering). When it carries an actionId, the control is waiting: call a2ui_respond_action with that actionId promptly.'
  ].join('\n');
}
