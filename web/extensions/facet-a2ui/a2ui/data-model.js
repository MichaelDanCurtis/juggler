// Copyright (c) 2026 Julian Storer
// Apache-2.0 - see LICENSE
// SPDX-License-Identifier: Apache-2.0

/**
 * A2UI data-model utilities: RFC 6901 JSON Pointer get/set plus the two
 * binding scopes the A2UI v1.0 spec defines — absolute pointers (`/user/name`)
 * resolved from the surface's data-model root, and relative paths
 * (`firstName`) resolved against a collection-scope base inside List
 * templates.
 *
 * Pure data — no DOM, no Yjs. The renderer resolves component property
 * bindings through {@link resolveValue}; the tool layer applies
 * `updateDataModel` messages through {@link setByPointer} (upsert semantics).
 * @module a2ui/data-model
 */

/**
 * Parse an RFC 6901 JSON Pointer into unescaped reference tokens.
 * `''` (the whole document) parses to `[]`. Escapes: `~1` → `/`, `~0` → `~`
 * (in that order, per the RFC).
 * @param {string} pointer - Absolute JSON Pointer (must be '' or start with '/')
 * @returns {string[]} Unescaped reference tokens
 * @throws {Error} If the pointer is not '' and does not start with '/'
 */
export function parsePointer(pointer) {
  if (pointer === '') return [];
  if (typeof pointer !== 'string' || !pointer.startsWith('/')) {
    throw new Error(`Invalid JSON Pointer ${JSON.stringify(pointer)}: must be "" or start with "/"`);
  }
  return pointer.slice(1).split('/').map(t => t.replace(/~1/g, '/').replace(/~0/g, '~'));
}

/**
 * Read the value at a JSON Pointer. A missing path yields `undefined` rather
 * than throwing — the renderer treats unresolved bindings as empty.
 * @param {unknown} root - The data-model root
 * @param {string} pointer - Absolute JSON Pointer ('' returns root)
 * @returns {unknown} The value at the pointer, or undefined when absent
 */
export function getByPointer(root, pointer) {
  let node = root;
  for (const token of parsePointer(pointer)) {
    if (node === null || typeof node !== 'object') return undefined;
    node = /** @type {Record<string, unknown>} */ (node)[
      Array.isArray(node) ? /** @type {any} */ (asArrayIndex(token, node)) : token
    ];
  }
  return node;
}

/**
 * Interpret a pointer token as an array index. `-` designates the
 * one-past-the-end position (RFC 6901 §4), used by set for appends.
 * @param {string} token - Reference token
 * @param {unknown[]} arr - The array being indexed
 * @returns {number} The numeric index (NaN when the token is not an index)
 */
function asArrayIndex(token, arr) {
  if (token === '-') return arr.length;
  return /^(0|[1-9][0-9]*)$/.test(token) ? Number(token) : NaN;
}

/**
 * Write a value at a JSON Pointer with **upsert semantics**: intermediate
 * containers are created as needed (an object normally; an array when the
 * next token is an array index or `-`). This is the `updateDataModel`
 * contract — updating a path that does not exist yet inserts it.
 *
 * The whole-document pointer `''` is deliberately rejected: replacing the
 * entire model swaps the root reference, which an in-place mutator cannot
 * express — the caller (the tool layer) handles the omitted-path
 * replace-everything case itself.
 * @param {Record<string, unknown>|unknown[]} root - The data-model root (mutated)
 * @param {string} pointer - Absolute JSON Pointer; must name at least one token
 * @param {unknown} value - The value to insert or replace
 * @returns {void}
 * @throws {Error} On the '' pointer, or when a traversed segment is a primitive
 */
export function setByPointer(root, pointer, value) {
  const tokens = parsePointer(pointer);
  if (tokens.length === 0) {
    throw new Error('setByPointer cannot replace the whole document; handle the empty pointer at the call site');
  }
  /** @type {any} */
  let node = root;
  for (let i = 0; i < tokens.length - 1; i++) {
    const token = tokens[i];
    const key = Array.isArray(node) ? asArrayIndex(token, node) : token;
    if (Array.isArray(node) && Number.isNaN(key)) {
      throw new Error(`Invalid array index ${JSON.stringify(token)} in pointer ${JSON.stringify(pointer)}`);
    }
    let next = node[key];
    if (next === null || typeof next !== 'object') {
      if (next !== null && next !== undefined) {
        throw new Error(`Cannot descend through primitive at "/${tokens.slice(0, i + 1).join('/')}"`);
      }
      // Create the missing container: an array when the NEXT token looks like
      // an array index, an object otherwise.
      next = /^(0|[1-9][0-9]*|-)$/.test(tokens[i + 1]) ? [] : {};
      node[key] = next;
    }
    node = next;
  }
  const last = tokens[tokens.length - 1];
  const key = Array.isArray(node) ? asArrayIndex(last, node) : last;
  if (Array.isArray(node) && Number.isNaN(key)) {
    throw new Error(`Invalid array index ${JSON.stringify(last)} in pointer ${JSON.stringify(pointer)}`);
  }
  node[key] = value;
}

/**
 * Resolve a binding path against the data model, honoring the two A2UI
 * scopes: a path starting with `/` is absolute from the model root; anything
 * else is relative to `basePointer` (the current collection-scope item —
 * empty string when not inside a template, making relative paths resolve
 * from the root).
 * @param {unknown} dataModel - The surface's data-model root
 * @param {string} path - Absolute pointer or relative path
 * @param {string} [basePointer] - Collection-scope base (absolute pointer)
 * @returns {unknown} The bound value, or undefined when absent
 */
export function resolveBoundValue(dataModel, path, basePointer = '') {
  if (path.startsWith('/')) return getByPointer(dataModel, path);
  // Relative: each `/`-separated segment is escaped per RFC 6901 before being
  // appended to the base pointer.
  const rel = path.split('/').map(s => s.replace(/~/g, '~0').replace(/\//g, '~1')).join('/');
  return getByPointer(dataModel, `${basePointer}/${rel}`);
}

/**
 * Resolve one component property value, which is either a **literal**
 * (string/number/boolean/array/object used as-is) or a **binding object**.
 * Bindings are recognized in two shapes for cross-implementation
 * compatibility (our conformance peer accepts both):
 * - v1.0: `{ path: '/user/name' }`
 * - v0.8-era typed literals: `{ literalString: s }` / `{ literalNumber: n }` /
 *   `{ literalBoolean: b }`
 * @param {unknown} value - Raw property value from the component definition
 * @param {{dataModel: unknown, basePointer?: string}} ctx - Resolution context
 * @returns {unknown} The resolved value
 */
export function resolveValue(value, ctx) {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const v = /** @type {Record<string, unknown>} */ (value);
    if (typeof v.path === 'string') {
      return resolveBoundValue(ctx.dataModel, v.path, ctx.basePointer || '');
    }
    if ('literalString' in v) return v.literalString;
    if ('literalNumber' in v) return v.literalNumber;
    if ('literalBoolean' in v) return v.literalBoolean;
  }
  return value;
}

/**
 * Convert a resolved value to display text per the spec's interpolation
 * rules: numbers and booleans stringify, null/undefined become the empty
 * string, objects/arrays stringify as JSON.
 * @param {unknown} value - A resolved binding value
 * @returns {string} Display text
 */
export function toText(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}
