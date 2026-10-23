const SEGMENT = /^[A-Za-z0-9_-]+$/;

const isObject = (value) => value !== null && typeof value === "object";

/** An object the tree opens: not a list, a set, a map or a document. */
const isWalkable = (value) => isObject(value) && !Array.isArray(value) && !(value instanceof Set)
  && !(value instanceof Map) && !("documentName" in value);

/** Values the tree offers as keys: numbers, text, flags, lists and sets. */
const isLeafValue = (value) => value === null || Array.isArray(value) || value instanceof Set
  || ["number", "string", "boolean", "bigint"].includes(typeof value);

/**
 * The keys a native filter can read, as a tree the key picker walks one segment at
 * a time. Pure: it knows nothing of the DOM.
 *
 * Keys come from two places. `entries` are the system's own
 * keys, with their names, in the order they are offered; `common` ones open the
 * list. `data`, the actor's roll data, is read one level at a time as the
 * picker asks, so it has no overall limit; only what one level shows is capped.
 * `values` holds what a key reads now, shown beside it.
 */
export class Dnd5e6NativeFilterKeyTree {
  /** What one level lists, what a search finds and what the list opens with, at most. */
  static LEVEL_LIMIT = 60;
  static MATCH_LIMIT = 20;
  static COMMON_LIMIT = 12;
  static SEARCH_MIN = 2;
  /** Roll data nodes a free-text search reads at most, and how deep. */
  static SEARCH_BUDGET = 5000;
  static SEARCH_DEPTH = 8;

  #root = Dnd5e6NativeFilterKeyTree.#node();
  #data;
  #values;
  #skipRoots;
  #labelOf;
  #labels = new Map();
  #children = new Map();
  #leaves = null;

  /**
   * @param {object} [options]
   * @param {Array<{key: string, label?: string, common?: boolean, branch?: boolean, pinned?: boolean}>} [options.entries]
   * @param {object|null} [options.data]       Roll data to read keys from.
   * @param {object|null} [options.values]     Data to read values from; `data` when omitted.
   * @param {string[]} [options.skipRoots]     Roots of `data` never offered.
   * @param {Function|null} [options.labelOf]  A key's readable name, for keys without one.
   */
  constructor({ entries = [], data = null, values = null, skipRoots = [], labelOf = null } = {}) {
    this.#data = isWalkable(data) ? data : null;
    this.#values = isObject(values) ? values : this.#data;
    this.#skipRoots = new Set(skipRoots);
    this.#labelOf = typeof labelOf === "function" ? labelOf : null;
    for (const entry of entries) this.#add(entry);
  }

  static #node() {
    return { children: new Map(), label: "", leaf: false, common: false, pinned: false, order: 0 };
  }

  /** The text a key is typed as: without spaces, a leading `@` or `system.` (roll data has no `system`). */
  static normalize(text) {
    let value = String(text ?? "").replace(/\s+/g, "");
    if (value.startsWith("@")) value = value.slice(1);
    if (/^system\./i.test(value)) value = value.slice(7);
    return value;
  }

  #add({ key, label = "", common = false, branch = false, pinned = false } = {}) {
    const parts = typeof key === "string" ? key.split(".") : [];
    if (!parts.length || !parts.every((part) => SEGMENT.test(part))) return;
    let node = this.#root;
    for (const part of parts) {
      if (!node.children.has(part)) node.children.set(part, { ...Dnd5e6NativeFilterKeyTree.#node(), order: node.children.size });
      node = node.children.get(part);
    }
    if (label && !node.label) node.label = String(label);
    if (!branch) node.leaf = true;
    node.common ||= common === true;
    node.pinned ||= pinned === true;
    this.#leaves = null;
  }

  #staticAt(path) {
    let node = this.#root;
    for (const part of path ? path.split(".") : []) {
      node = node.children.get(part);
      if (!node) return null;
    }
    return node;
  }

  #read(source, path) {
    let target = source;
    for (const part of path ? path.split(".") : []) {
      if (!isObject(target) && typeof target !== "function") return undefined;
      if (!(part in target)) return undefined;
      target = target[part];
    }
    return target;
  }

  #dataAt(path) {
    if (!this.#data) return undefined;
    if (path && this.#skipRoots.has(path.split(".")[0])) return undefined;
    return this.#read(this.#data, path);
  }

  static #listable(key) {
    return SEGMENT.test(key) && !key.startsWith("_");
  }

  /** Whether an object holds anything to list, looking one level down only. */
  static #hasKeys(value) {
    return isWalkable(value) && Object.keys(value).some((key) => Dnd5e6NativeFilterKeyTree.#listable(key)
      && (isLeafValue(value[key]) || isWalkable(value[key])));
  }

  /** The keys of a roll data object the tree lists, at the root without the skipped ones; empty objects are left out. */
  #dataKeys(value, atRoot) {
    if (!isWalkable(value)) return [];
    return Object.keys(value).filter((key) => Dnd5e6NativeFilterKeyTree.#listable(key) && !(atRoot && this.#skipRoots.has(key))
      && (isLeafValue(value[key]) || Dnd5e6NativeFilterKeyTree.#hasKeys(value[key])));
  }

  /** Whether a key has keys under it. */
  isBranch(path) {
    const node = this.#staticAt(path);
    if (node?.children.size) return true;
    const value = this.#dataAt(path);
    return path ? Dnd5e6NativeFilterKeyTree.#hasKeys(value) : this.#dataKeys(value, true).length > 0;
  }

  /** Whether a key is one the tree offers as a key. */
  isLeaf(path) {
    if (this.#staticAt(path)?.leaf) return true;
    const value = this.#dataAt(path);
    return value !== undefined && isLeafValue(value);
  }

  /**
   * The keys one level under `path`: the system's own first, in
   * their order, then roll data's. At the root, the pinned roots come
   * first and the rest are sorted.
   * @returns {Array<{segment: string, key: string, branch: boolean}>}
   */
  children(path = "") {
    if (this.#children.has(path)) return this.#children.get(path);
    const node = this.#staticAt(path);
    const entries = new Map();
    for (const [segment, child] of node?.children ?? []) {
      entries.set(segment, { segment, pinned: child.pinned, order: child.order });
    }
    const value = this.#dataAt(path);
    for (const segment of this.#dataKeys(value, !path)) {
      if (!entries.has(segment)) entries.set(segment, { segment, pinned: false, order: Infinity });
    }
    let list = [...entries.values()];
    if (!path) {
      list = [...list.filter((entry) => entry.pinned).sort((a, b) => a.order - b.order),
        ...list.filter((entry) => !entry.pinned).sort((a, b) => a.segment.localeCompare(b.segment))];
    }
    const result = Object.freeze(list.map(({ segment }) => {
      const key = path ? `${path}.${segment}` : segment;
      return Object.freeze({ segment, key, branch: this.isBranch(key) });
    }));
    this.#children.set(path, result);
    return result;
  }

  /**
   * The key typed text names, with each segment matched as written or, failing
   * that, ignoring case; null when there is none.
   */
  resolve(path) {
    let resolved = "";
    for (const part of path ? path.split(".") : []) {
      const children = this.children(resolved);
      const child = children.find((entry) => entry.segment === part)
        ?? children.find((entry) => entry.segment.toLowerCase() === part.toLowerCase());
      if (!child) return null;
      resolved = child.key;
    }
    return resolved;
  }

  /** A key's readable name: its own, else the one `labelOf` gives, remembered. */
  label(key) {
    const own = this.#staticAt(key)?.label;
    if (own) return own;
    if (!this.#labels.has(key)) {
      let label = "";
      try { label = this.#labelOf?.(key) ?? ""; }
      catch { label = ""; }
      this.#labels.set(key, typeof label === "string" ? label : "");
    }
    return this.#labels.get(key);
  }

  /** What a key reads now, as short text; empty when there is nothing to show. */
  value(key) {
    const value = this.#values ? this.#read(this.#values, key) : undefined;
    if (value === undefined || typeof value === "function") return "";
    let text;
    if (value instanceof Set || Array.isArray(value)) text = `[${Array.from(value).map((entry) => String(entry)).join(", ")}]`;
    else if (isObject(value)) return "";
    else text = typeof value === "string" ? JSON.stringify(value) : String(value);
    return text.length > 24 ? `${text.slice(0, 23)}…` : text;
  }

  item(key, branch = this.isBranch(key)) {
    return Object.freeze({
      key,
      insert: branch ? `${key}.` : key,
      label: this.label(key),
      value: branch ? "" : this.value(key),
      branch
    });
  }

  /** The keys the list opens with: the system's most used. */
  common() {
    const found = [];
    const visit = (node, path) => {
      for (const [segment, child] of node.children) {
        if (found.length >= this.constructor.COMMON_LIMIT) return;
        const key = path ? `${path}.${segment}` : segment;
        if (child.common) found.push(key);
        visit(child, key);
      }
    };
    visit(this.#root, "");
    return found.map((key) => this.item(key));
  }

  /**
   * What the picker lists for typed text. Text before the last dot names a key;
   * text after it filters that key's children, by name or readable name. With no
   * text, the common keys come first; with no dot and two characters or more,
   * keys anywhere whose path or name holds the text are listed too.
   * @returns {{text: string, base: string, filter: string, groups: Array<{id: string, items: object[]}>, more: number}}
   */
  query(raw = "") {
    const text = Dnd5e6NativeFilterKeyTree.normalize(raw);
    const dot = text.lastIndexOf(".");
    const typed = dot >= 0 ? text.slice(0, dot) : "";
    const filter = (dot >= 0 ? text.slice(dot + 1) : text).toLowerCase();
    const groups = [];
    if (!text) groups.push({ id: "common", items: this.common() });
    const base = typed ? this.resolve(typed) : "";
    if (base === null || (base && !this.isBranch(base))) return Object.freeze({ text, base: base ?? typed, filter, groups: [], more: 0 });
    const children = this.children(base);
    const matching = !filter ? [...children] : [
      ...children.filter((child) => child.segment.toLowerCase().startsWith(filter)),
      ...children.filter((child) => !child.segment.toLowerCase().startsWith(filter)
        && (child.segment.toLowerCase().includes(filter) || this.label(child.key).toLowerCase().includes(filter)))
    ];
    const shown = matching.slice(0, this.constructor.LEVEL_LIMIT);
    groups.push({ id: "keys", items: shown.map((child) => this.item(child.key, child.branch)) });
    if (!base && filter.length >= this.constructor.SEARCH_MIN) {
      const listed = new Set(shown.map((child) => child.key));
      const matches = this.search(filter).filter((item) => !listed.has(item.key));
      groups.push({ id: "matches", items: matches });
    }
    return Object.freeze({
      text, base, filter, more: matching.length - shown.length,
      groups: groups.filter((group) => group.items.length).map((group) => Object.freeze(group))
    });
  }

  /**
   * Keys anywhere whose path holds the text, or whose readable name does. Roll
   * data keys are matched by name only once they have been named, so a search
   * never asks the system to name thousands of keys.
   */
  search(text, limit = this.constructor.MATCH_LIMIT) {
    const needle = String(text ?? "").toLowerCase();
    if (!needle) return [];
    this.#leaves ??= this.#flatten();
    const found = [];
    for (const { key, named } of this.#leaves) {
      if (found.length >= limit) break;
      const label = named ? this.label(key) : (this.#labels.get(key) ?? "");
      if (key.toLowerCase().includes(needle) || label.toLowerCase().includes(needle)) found.push(this.item(key, false));
    }
    return found;
  }

  #flatten() {
    const leaves = [];
    const seen = new Set();
    const visitStatic = (node, path) => {
      for (const [segment, child] of node.children) {
        const key = path ? `${path}.${segment}` : segment;
        if (child.leaf && !seen.has(key)) {
          seen.add(key);
          leaves.push({ key, named: true });
        }
        visitStatic(child, key);
      }
    };
    visitStatic(this.#root, "");
    if (!this.#data) return leaves;
    let budget = this.constructor.SEARCH_BUDGET;
    const visited = new WeakSet();
    const walk = (value, path, depth) => {
      for (const key of this.#dataKeys(value, !path)) {
        if (budget-- <= 0) return;
        const child = value[key];
        const full = path ? `${path}.${key}` : key;
        if (isLeafValue(child)) {
          if (!seen.has(full)) {
            seen.add(full);
            leaves.push({ key: full, named: false });
          }
        } else if (depth < this.constructor.SEARCH_DEPTH && !visited.has(child)) {
          visited.add(child);
          walk(child, full, depth + 1);
        }
      }
    };
    visited.add(this.#data);
    walk(this.#data, "", 1);
    return leaves;
  }
}
