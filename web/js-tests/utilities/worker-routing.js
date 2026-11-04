// Copyright (c) 2026 Julian Storer
// AGPL-3.0-or-later - see LICENSE

/** @type {WeakSet<import('../../js/services/websocket.js').WebSocketService>} */
const installed = new WeakSet();

/**
 * Mixed unit/integration lanes share one transport for their whole lifecycle.
 * Register once across entrypoints so worker requests cannot receive duplicate
 * answers when the lane switches from one suite type to the other.
 * @param {import('../../js/services/websocket.js').WebSocketService} service
 * @param {{handleWorkerMessageFromWS: (data: any) => void}} manager Worker envelope boundary.
 * @returns {void}
 */
export function installTestWorkerRouting(service, manager) {
  if (installed.has(service)) return;
  installed.add(service);
  service.on('message', (/** @type {any} */ data) => {
    if (data.type === 'worker-message') manager.handleWorkerMessageFromWS(data);
  });
}
