// Prizmanyx fork — console context for the native Workspace/Browser panes.
// AGPL-3.0-or-later - see LICENSE

/**
 * Holds what the panel panes need to talk to Prizmanyx: the active program id,
 * a program-bound capability token (minted by the session-gated Prizmanyx
 * route, handed over the embed bridge), and the web app's origin (for
 * gateway-viewing app paths). Requests go through the fork server's /pzx
 * same-origin proxy, so the token is the ONLY credential involved.
 *
 * Persisted in the FORK SERVER's memory (/api/pzx-context, X-Facet-Token
 * gated) so the pop-out and desktop windows share it — NOT localStorage:
 * browsers partition a third-party iframe's storage, so anything the embedded
 * console wrote there would never reach a top-level fork window. Tokens are
 * program-scoped and expire server-side (reads 15 min, writes 5); a stale context degrades
 * to an honest 401 in the pane, never silent access.
 *
 * The active conversation id (the pane's "This task" scope) comes from the
 * fork's OWN session — tracked here in both embedded and standalone modes.
 */

/** @typedef {{programId: number, token: string, workspaceReadToken?: string, workspaceWriteToken?: string, agentReadToken?: string, agentWriteToken?: string, version?: number, webBase: string, expires: number}} PzxContext */

/** @type {PzxContext|null} */
let _context = null;
let _contextRevision = 0;
/** @type {string|null} */
let _activeConversationId = null;
/** @type {Set<() => void>} */
const _listeners = new Set();

/**
 *
 */
function _notify() {
  for (const listener of _listeners) listener();
}

/** @returns {Record<string, string>} Instance authentication headers. */
function _authHeaders() {
  const token = /** @type {{__facetToken?: string}} */ (globalThis).__facetToken;
  return token ? { 'X-Facet-Token': token } : {};
}

/**
 * Store a fresh context: in memory for this window, and on the fork server so
 * every OTHER fork window (pop-out, desktop) picks it up at boot.
 * @param {PzxContext} context
 */
export function setPzxContext(context) {
  _contextRevision += 1;
  _context = context;
  _notify();
  void fetch('/api/pzx-context', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ..._authHeaders() },
    body: JSON.stringify(context),
  }).catch(() => {
    /* this window still works from memory */
  });
}

/** Clear this window's capabilities and the context used by newly opened windows. */
export function clearPzxContext() {
  _contextRevision += 1;
  _context = null;
  _notify();
  void fetch('/api/pzx-context', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ..._authHeaders() },
    body: 'null',
  }).catch(() => {});
}

/** @returns {PzxContext|null} null when unconfigured or expired. */
export function getPzxContext() {
  if (!_context) return null;
  if (typeof _context.expires === 'number' && _context.expires * 1000 < Date.now()) return null;
  return _context;
}

/** @returns {string|null} The active conversation, if any. */
export function getActiveConversationId() {
  return _activeConversationId;
}

/**
 * Track the active conversation from the live session — works in the embedded
 * console AND the standalone/pop-out window — and hydrate the context from
 * the fork server (where the embedded console last stored it).
 * @param {import('../model/session.js').default} session
 */
export function initPzxContext(session) {
  _activeConversationId = session.visibleConversationId || null;
  session.subscribe((/** @type {{type?: string}} */ event) => {
    if (typeof event.type !== 'string' || !event.type.startsWith('conversation:')) return;
    const visible = session.visibleConversationId || null;
    if (visible !== _activeConversationId) {
      _activeConversationId = visible;
      _notify();
    }
  });
  const revision = _contextRevision;
  void fetch('/api/pzx-context', { headers: _authHeaders() })
    .then(async (response) => {
      if (!response.ok) return;
      const stored = await response.json();
      // A delayed startup response must never undo a program switch or clear.
      if (revision !== _contextRevision) return;
      if (stored && typeof stored.programId === 'number' && typeof stored.token === 'string') {
        _context = stored;
        _notify();
      }
    })
    .catch(() => {
      /* unconfigured until the console hands a context over */
    });
}

/**
 * @param {() => void} listener
 * @returns {() => void} Unsubscribe.
 */
export function onPzxContextChange(listener) {
  _listeners.add(listener);
  return () => _listeners.delete(listener);
}
