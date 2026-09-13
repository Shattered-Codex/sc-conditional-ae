import assert from "node:assert/strict";
import test from "node:test";

/**
 * A DOM small enough to describe a Changes tab: the adapter only reads element
 * children, class names, a couple of attributes and the computed grid style.
 */
class FakeElement {
  constructor(tagName) {
    this.tagName = String(tagName).toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.attributes = new Map();
    this.style = {};
    this.hidden = false;
    this.classList = createClassList();
  }

  get className() {
    return Array.from(this.classList).join(" ");
  }

  set className(value) {
    this.classList = createClassList(String(value).split(/\s+/).filter(Boolean));
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  append(...nodes) {
    for (const node of nodes) {
      node.parentElement = this;
      this.children.push(node);
    }
  }

  before(node) {
    const siblings = this.parentElement.children;
    node.parentElement = this.parentElement;
    siblings.splice(siblings.indexOf(this), 0, node);
  }

  remove() {
    const siblings = this.parentElement?.children ?? [];
    siblings.splice(siblings.indexOf(this), 1);
    this.parentElement = null;
  }

  matches(selector) {
    return splitSelectors(selector).some(part => matchesCompound(this, part));
  }

  closest(selector) {
    for (let node = this; node; node = node.parentElement) {
      if (node.matches(selector)) {
        return node;
      }
    }
    return null;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  querySelectorAll(selector) {
    const matched = [];
    for (const part of splitSelectors(selector)) {
      const scoped = part.startsWith(":scope >");
      const compound = scoped ? part.slice(":scope >".length).trim() : part;
      const candidates = scoped ? this.children : descendants(this);
      for (const candidate of candidates) {
        if (matchesCompound(candidate, compound) && !matched.includes(candidate)) {
          matched.push(candidate);
        }
      }
    }
    return matched;
  }
}

function createClassList(initial = []) {
  const classes = new Set(initial);
  return {
    add: (...names) => names.forEach(name => classes.add(name)),
    contains: name => classes.has(name),
    [Symbol.iterator]: () => classes[Symbol.iterator]()
  };
}

function descendants(node) {
  return node.children.flatMap(child => [child, ...descendants(child)]);
}

function splitSelectors(selector) {
  return String(selector).split(",").map(part => part.trim()).filter(Boolean);
}

function matchesCompound(node, selector) {
  const attribute = selector.match(/\[([^\]=]+)(?:=(?:'([^']*)'|"([^"]*)"))?\]/);
  const [tag, ...classes] = selector.replace(/\[[^\]]*\]/g, "").split(".");

  if (tag && node.tagName !== tag.toUpperCase()) {
    return false;
  }
  if (classes.some(name => name && !node.classList.contains(name))) {
    return false;
  }
  if (!attribute) {
    return true;
  }

  const value = node.getAttribute(attribute[1]);
  const expected = attribute[2] ?? attribute[3];
  return value !== null && (expected === undefined || value === expected);
}

function element(tag, { classes = [], attributes = {}, children = [], ...properties } = {}) {
  const node = new FakeElement(tag);
  node.classList.add(...classes);
  for (const [name, value] of Object.entries(attributes)) {
    node.setAttribute(name, value);
  }
  Object.assign(node, properties);
  node.append(...children);
  return node;
}

function cell(className, child) {
  return element("div", { classes: [className], children: child ? [child] : [] });
}

globalThis.HTMLElement = FakeElement;
globalThis.document = { createElement: tag => new FakeElement(tag) };
globalThis.requestAnimationFrame = callback => callback();
globalThis.MutationObserver = class {
  observe() {}
  disconnect() {}
};

/** The 6 tracks this module's own stylesheet declares for DAE's sheet. */
const SIX_TRACKS = "400px 110px 250px 44px 60px 16px";
const SEVEN_TRACKS = [
  "minmax(0, 2.2fr)",
  "minmax(0, 0.9fr)",
  "minmax(0, 1.5fr)",
  "2.75rem",
  "minmax(0, 0.8fr)",
  "minmax(0, 0.55fr)",
  "max-content"
].join(" ");

function stubComputedStyle({ display = "grid", tracks = SIX_TRACKS } = {}) {
  globalThis.getComputedStyle = node => {
    if (node.tagName === "OL") {
      return { display, gridTemplateColumns: tracks };
    }
    if (node.tagName === "LI") {
      return { display: display === "grid" ? "contents" : "block" };
    }
    return { display: "block", gridTemplateColumns: "none" };
  };
}

/** The tab as dnd5e 5.3 renders it with DAE's Phase column and this module's. */
function buildChangesTab({ headerCells, rowExtras = [] } = {}) {
  const header = element("header", {
    children: headerCells.map(name => element("div", { classes: [name] }))
  });

  const row = element("li", {
    children: [
      cell("key", element("input", { attributes: { name: "changes.0.key" } })),
      cell("type", element("select", { attributes: { name: "changes.0.type" } })),
      cell("value", element("input", { attributes: { name: "changes.0.value" } })),
      cell("sc-cae-formula-column", element("button")),
      cell("phase", element("select", { attributes: { name: "changes.0.phase" } })),
      cell("priority", element("input", { attributes: { name: "changes.0.priority" } })),
      cell("controls", element("button")),
      element("input", { type: "hidden", attributes: { name: "changes.0.phase" } }),
      ...rowExtras
    ]
  });

  const list = element("ol", { children: [row] });
  const section = element("section", { classes: ["tab", "changes"], children: [header, list] });
  const root = element("div", { children: [section] });
  return { root, section, header, list, row };
}

const { ChangesGridLayoutAdapter } = await import("../scripts/applications/ChangesGridLayoutAdapter.js");

test("gives every cell of the row a track of its own", () => {
  stubComputedStyle();
  const { root, section, header, list } = buildChangesTab({
    headerCells: ["key", "type", "value", "sc-cae-formula-header", "phase", "priority", "controls"]
  });

  ChangesGridLayoutAdapter.scheduleAdapt({}, root);

  assert.equal(list.style.gridTemplateColumns, SEVEN_TRACKS);
  assert.equal(header.style.gridTemplateColumns, SEVEN_TRACKS);
  assert.equal(section.classList.contains("sc-cae-changes-grid"), true);
});

test("neither the hidden phase input nor a collapsed formula row takes a track", () => {
  stubComputedStyle();
  const { root, list } = buildChangesTab({
    headerCells: ["key", "type", "value", "sc-cae-formula-header", "phase", "priority", "controls"],
    rowExtras: [element("div", { classes: ["sc-cae-formula-expansion"], hidden: true })]
  });

  ChangesGridLayoutAdapter.scheduleAdapt({}, root);

  assert.equal(ChangesGridLayoutAdapter.countTracks(list.style.gridTemplateColumns), 7);
});

test("fills in a header label a module added a cell without", () => {
  stubComputedStyle();
  const { root, header } = buildChangesTab({
    headerCells: ["key", "type", "value", "sc-cae-formula-header", "priority", "controls"]
  });

  ChangesGridLayoutAdapter.scheduleAdapt({}, root);

  assert.deepEqual(
    header.children.map(child => child.className),
    ["key", "type", "value", "sc-cae-formula-header", "priority", "sc-cae-changes-spacer", "controls"]
  );
});

test("leaves a tab that already fits its cells alone", () => {
  stubComputedStyle({ tracks: SEVEN_TRACKS });
  const { root, section, list } = buildChangesTab({
    headerCells: ["key", "type", "value", "sc-cae-formula-header", "phase", "priority", "controls"]
  });

  ChangesGridLayoutAdapter.scheduleAdapt({}, root);

  assert.equal(list.style.gridTemplateColumns, undefined);
  assert.equal(section.classList.contains("sc-cae-changes-grid"), false);
});

test("leaves a tab that is not laid out as a grid alone", () => {
  stubComputedStyle({ display: "flex" });
  const { root, section, list } = buildChangesTab({
    headerCells: ["key", "type", "value", "priority", "controls"]
  });

  ChangesGridLayoutAdapter.scheduleAdapt({}, root);

  assert.equal(list.style.gridTemplateColumns, undefined);
  assert.equal(section.classList.contains("sc-cae-changes-grid"), false);
});
