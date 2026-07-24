// Copyright (c) 2026 Julian Storer
// AGPL-3.0-or-later - see LICENSE

import BaseMessage from './base-message.js';
import { renderResultStatusMessage } from '../../sdk/lib/html.js';
import { wrapWithIcon, TYPE_ICONS } from '../utils/icon-message-renderer.js';
import { iconOptionsForItem } from '../utils/item-badge.js';

/**
 * Context item message component - icon + custom content with plugin icon support
 *
 * Re-renders itself when its item's Y.Map fields change (same self-observation
 * pattern as `tool-action-message`): a context item's `data` can be mutated
 * long after insertion — `addContextItem` upserts and `updateContextItem`
 * patches in place (plan steps, A2UI surfaces) — and neither of the framework's
 * update paths reaches this element (`positionElements` only calls
 * `updateFromItem` where defined; the streaming observer targets
 * assistant/thinking/thread only). Without its own observer the card is
 * static after first paint.
 */
class ContextItemMessage extends BaseMessage {
  /** @type {(() => void)|null} @private */
  _yjsObserver = null;

  /** @type {import('../model/message-thread.js').default|null} @private */
  _observedThread = null;

  /** @type {string|null} @private */
  _lastSnapshot = null;

  static get observedAttributes() {
    return ['item-id', 'item-type', 'error', 'color-preset', 'icon'];
  }

  connectedCallback() {
    this._setupLiveUpdate();
    super.connectedCallback();
  }

  /**
   * Observe the thread's items array and re-render when THIS item's rendered
   * fields change. Unlike tool-action-message there is no approval-churn
   * guard: a context item's re-render on `data` change is exactly the wanted
   * behavior (e.g. an A2UI surface repainting when the model streams new
   * data), and no pending-approval widget lives inside these cards.
   * @private
   */
  _setupLiveUpdate() {
    const messageThread = this._getMessageThread();
    if (!messageThread || !this.itemId) return;

    this._lastSnapshot = this._snapshot();
    this._observedThread = messageThread;
    this._yjsObserver = () => {
      const snapshot = this._snapshot();
      if (snapshot !== this._lastSnapshot) {
        this._lastSnapshot = snapshot;
        this.render();
      }
    };
    messageThread.yarray.observeDeep(this._yjsObserver);
    this.addCleanup(() => {
      if (this._observedThread && this._yjsObserver) {
        this._observedThread.yarray.unobserveDeep(this._yjsObserver);
      }
      this._yjsObserver = null;
      this._observedThread = null;
    });
  }

  /**
   * Serialize the fields whose change should trigger a re-render.
   * @returns {string|null} A comparable snapshot, or null when the item is gone
   * @private
   */
  _snapshot() {
    const item = this._observedThread?.findByItemId?.(this.itemId)
      ?? this._getMessageThread()?.findByItemId?.(this.itemId);
    if (!item) return null;
    const data = item.get('data');
    const plainData = data?.toJSON ? data.toJSON() : data;
    try {
      return JSON.stringify({ type: item.get('type'), error: item.get('error'), data: plainData });
    } catch {
      return null;
    }
  }

  get itemId() {
    return this.getAttribute('item-id');
  }

  get itemType() {
    return this.getAttribute('item-type') || 'unknown';
  }

  get error() {
    return this.getAttribute('error');
  }

  get colorPreset() {
    return this.getAttribute('color-preset') || 'slate';
  }

  get icon() {
    return this.getAttribute('icon');
  }

  render() {
    const article = document.createElement('article');
    article.className = 'context-item';

    // Get context item instance for enhanced rendering
    const messageThread = this._getMessageThread();
    const contextItem = this.itemId ? messageThread?.getContextItem(this.itemId) : null;
    const itemType = contextItem?.type || this.itemType;
    const manifestName = contextItem?.getManifest?.()?.name || itemType;

    // Handle error case
    if (this.error) {
      const content = renderResultStatusMessage({ typeName: manifestName, summary: this.error, status: 'error' });
      article.appendChild(wrapWithIcon(content, {
        color: 'red',
        iconSvg: TYPE_ICONS.error
      }));
      this.replaceChildren(article);
      return;
    }

    const title = contextItem?.getTitle?.() || '';

    // Icon + colour from the one shared resolver, so this tile and the
    // properties-panel header always paint the same badge.
    const iconOptions = contextItem
      ? iconOptionsForItem(contextItem, { messageThread })
      : { color: this.colorPreset, iconClass: this.icon || undefined, iconSvg: this.icon ? undefined : TYPE_ICONS.context };

    // Build status content via getStatusUI → renderResultStatusMessage
    const statusConfig = contextItem?.getStatusUI?.() ?? { typeName: manifestName, summary: title };
    const content = renderResultStatusMessage(statusConfig);

    article.appendChild(wrapWithIcon(content, iconOptions));

    this.replaceChildren(article);
  }
}

customElements.define('context-item-message', ContextItemMessage);

export default ContextItemMessage;
