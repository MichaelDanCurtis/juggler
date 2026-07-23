// Prizmanyx fork — Facet embed bridge.
// AGPL-3.0-or-later - see LICENSE

/**
 * When Facet runs inside the Prizmanyx shell's iframe (?embed=1), the parent
 * renders our conversation tabs in ITS section sidebar. This module mirrors
 * the conversation list out via postMessage and applies select/new commands
 * coming back — the iframe itself runs chrome-less (html.embed-mode hides the
 * header and conversation bar; see prizmanyx-theme.css).
 *
 * SECURITY: does nothing outside an iframe. The PARENT initiates with
 * 'facet:hello'; we validate its origin against window.FACET_EMBED_PARENTS
 * (the same CSP-style source list that grants frame-ancestors, templated by
 * the server from FACET_EMBED_ANCESTORS) and lock EVERY outgoing postMessage
 * to that one validated origin — never '*'. Commands are only honoured from
 * the handshaken origin.
 */

import workerManager from '../services/worker-manager.js';

/** @type {import('../model/session.js').default|null} */
let _session = null;
/** @type {string|null} The handshaken parent origin; outgoing target. */
let _parentOrigin = null;

/**
 * Prizmanyx investigation seed (facet:seed): create + activate a conversation
 * and send the prompt as its first user message — the ask goes out, the
 * consultant watches. If the worker isn't ready within ~10s the prompt is
 * PRE-FILLED in the input box instead (visible, unsent) — a seed is never
 * silently dropped.
 * @param {string} title
 * @param {string} prompt
 */
async function seedConversation(title, prompt) {
  if (!_session) return;
  // createConversation resolves with the new conversation's id (a string).
  const id = await _session.createConversation(title, {
    activate: true,
    origin: 'prizmanyx-seed',
  });
  const conversation = _session.conversations.get(id);
  if (!conversation) return;
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    // sendMessage returns null when accepted and a refusal STRING while the
    // app is still hydrating (strategy plugins, provider cache) — a seed
    // fired right after the handshake races that startup, so retry the send
    // itself rather than only polling worker readiness.
    if (workerManager.isWorkerReady(id)) {
      const refusal = await conversation.sendMessage(prompt);
      if (refusal === null) return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  // Honest degrade: the worker never came up — leave the ask visible and
  // unsent so the consultant can read it and press Enter themselves.
  // (_getInputBox is fork-internal; the bridge and conversation ship together.)
  const box = conversation._getInputBox();
  if (box) {
    box.value = prompt;
    box.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

/**
 * Whether an origin matches the server-granted embed source list. Supports
 * the CSP port-wildcard form we use in dev ("http://localhost:*").
 * @param {string} origin
 * @returns {boolean}
 */
function originAllowed(origin) {
  const raw = /** @type {string} */ ((/** @type {any} */ (window).FACET_EMBED_PARENTS) || '');
  for (const pattern of raw.split(/\s+/).filter(Boolean)) {
    if (pattern === origin) return true;
    if (pattern.endsWith(':*')) {
      const base = pattern.slice(0, -2);
      if (origin === base || origin.startsWith(base + ':')) return true;
    }
  }
  return false;
}

/** @returns {Array<{id: string, name: string, active: boolean}>} */
function snapshot() {
  if (!_session) return [];
  const visibleId = _session.visibleConversationId;
  return Array.from(_session.conversations.values()).map((conv) => ({
    id: conv.id,
    name: conv.name || 'Untitled',
    active: conv.id === visibleId,
  }));
}

function send() {
  if (!_parentOrigin) return;
  window.parent.postMessage({ type: 'facet:conversations', items: snapshot() }, _parentOrigin);
}

/**
 * @param {MessageEvent} event
 */
function onMessage(event) {
  if (!originAllowed(event.origin)) return;
  const msg = event.data;
  if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') return;
  if (msg.type === 'facet:hello') {
    _parentOrigin = event.origin;
    send();
    return;
  }
  // Commands are accepted only from the origin that said hello.
  if (event.origin !== _parentOrigin || !_session) return;
  if (msg.type === 'facet:select' && typeof msg.id === 'string') {
    _session.switchConversation(msg.id);
  } else if (msg.type === 'facet:new') {
    void _session.createConversation('', { activate: true, origin: 'embed-bridge' });
  } else if (msg.type === 'facet:seed' && typeof msg.prompt === 'string') {
    void seedConversation(
      typeof msg.title === 'string' && msg.title.trim() ? msg.title : 'Prizmanyx investigation',
      msg.prompt,
    );
  }
}

/**
 * Wire the bridge to the live session. Safe to call unconditionally — it is
 * a no-op when the page is not embedded.
 * @param {import('../model/session.js').default} session
 */
export function initEmbedBridge(session) {
  if (window.self === window.top) return;
  _session = session;
  session.subscribe((/** @type {{type?: string}} */ event) => {
    if (typeof event.type === 'string' && event.type.startsWith('conversation:')) send();
  });
  window.addEventListener('message', onMessage);
  // If the parent said hello before the session finished loading, it gets
  // the list on the first conversation:* event; nothing to replay here.
}
