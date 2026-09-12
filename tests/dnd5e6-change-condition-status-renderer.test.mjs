import assert from "node:assert/strict";
import test from "node:test";

function getProperty(object, path) {
  return String(path ?? "").split(".").filter(Boolean)
    .reduce((value, key) => value?.[key], object);
}

function setProperty(object, path, value) {
  const parts = String(path).split(".");
  const property = parts.pop();
  let target = object;
  for (const part of parts) target = target[part] ??= {};
  target[property] = value;
  return true;
}

/** A DOM small enough to describe one Changes tab row. */
class FakeElement {
  constructor(tagName, ownerDocument) {
    this.tagName = String(tagName).toUpperCase();
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.parentElement = null;
    this.attributes = new Map();
    this.dataset = {};
    this.className = "";
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

  insertAdjacentElement(position, node) {
    assert.equal(position, "afterbegin");
    node.parentElement = this;
    this.children.unshift(node);
    return node;
  }

  remove() {
    const siblings = this.parentElement?.children ?? [];
    siblings.splice(siblings.indexOf(this), 1);
    this.parentElement = null;
  }

  matches(selector) {
    if (selector.startsWith(".")) return this.className.split(/\s+/).includes(selector.slice(1));
    const attribute = selector.replace(/^\[|\]$/g, "");
    return this.attributes.has(attribute)
      || (attribute === "data-change-id" && this.dataset.changeId !== undefined);
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  querySelectorAll(selector) {
    return descendants(this).filter(node => node.matches(selector));
  }
}

function descendants(node) {
  return node.children.flatMap(child => [child, ...descendants(child)]);
}

const ownerDocument = { createElement: tag => new FakeElement(tag, ownerDocument) };

function element(tag, { className = "", changeId } = {}) {
  const node = new FakeElement(tag, ownerDocument);
  node.className = className;
  if (changeId !== undefined) node.dataset.changeId = changeId;
  return node;
}

class FakeActor {
  constructor() {
    this.system = { attributes: { hp: { value: 8 } } };
  }

  getRollData() {
    return { attributes: this.system.attributes };
  }
}

globalThis.CONFIG = {
  Actor: { documentClass: FakeActor },
  Item: { documentClass: class FakeItem {} },
  ActiveEffect: { documentClass: class FakeActiveEffect {}, changeTypes: {} },
  Macro: { documentClass: class FakeMacro {} }
};
globalThis.CONST = { ACTIVE_EFFECT_MODES: { CUSTOM: 0 } };
globalThis.foundry = {
  utils: {
    deepClone: value => structuredClone(value),
    getProperty,
    hasProperty: (object, path) => getProperty(object, path) !== undefined,
    isEmpty: object => !object || Object.keys(object).length === 0,
    setProperty
  }
};
globalThis.game = {
  system: { id: "dnd5e", version: "6.0.0" },
  modules: new Map([["dae", { active: false }]]),
  settings: { get: (_module, key) => key === "showConditionTab" },
  user: { id: "user" }
};
globalThis.canvas = { tokens: { placeables: [] } };
globalThis.ui = { notifications: { warn() {} } };

const { Dnd5e6ChangeConditionStatusRenderer: Renderer } = await import(
  "../scripts/applications/Dnd5e6ChangeConditionStatusRenderer.js"
);

function createEffect({ changeConditions = {}, nativeChangeFilters = {} } = {}) {
  const changes = [
    { _id: "first", key: "system.first", conditions: nativeChangeFilters.first ?? null },
    { _id: "second", key: "system.second", conditions: nativeChangeFilters.second ?? null }
  ];
  const effect = {
    id: "effect",
    parent: new FakeActor(),
    system: { changes, conditions: null },
    flags: { "sc-conditional-ae": { condition: "", changeConditions } },
    getFlag(moduleId, key) {
      return this.flags[moduleId]?.[key];
    },
    getReplacementData(data) {
      return data;
    },
    toObject() {
      return structuredClone({
        system: { changes: this.system.changes.map(({ _id, key }) => ({ _id, key })) },
        flags: this.flags
      });
    }
  };
  effect.changes = changes;
  return effect;
}

function createSheet(effect) {
  const list = element("ol");
  for (const change of effect.system.changes) {
    const row = element("li", { className: "item change", changeId: change._id });
    const itemRow = element("div", { className: "item-row change-row" });
    itemRow.append(element("div", { className: "item-detail item-controls" }));
    row.append(itemRow);
    list.append(row);
  }
  const root = new FakeElement("form", ownerDocument);
  root.append(list);
  return root;
}

function badgeOf(root, changeId) {
  const row = root.querySelectorAll("[data-change-id]").find(node => node.dataset.changeId === changeId);
  return row.querySelector("[data-sc-cae-change-status]");
}

test("a conditioned change is badged with its own evaluated state", () => {
  const effect = createEffect({
    changeConditions: { first: "return false;" },
    nativeChangeFilters: { second: { check: () => true } }
  });
  const root = createSheet(effect);

  Renderer.render({ document: effect }, root);

  assert.equal(badgeOf(root, "first").dataset.state, "fail");
  assert.equal(badgeOf(root, "second").dataset.state, "pass");
  assert.equal(badgeOf(root, "first").children[0].className, "fa-solid fa-circle-xmark");
});

test("a change with no condition of its own is left unmarked", () => {
  const root = createSheet(createEffect());
  Renderer.render({ document: createEffect() }, root);

  assert.equal(badgeOf(root, "first"), null);
  assert.equal(badgeOf(root, "second"), null);
});

test("a condition that does not compile is badged as an error and names it in the tooltip", () => {
  const effect = createEffect({ changeConditions: { first: "return (" } });
  const root = createSheet(effect);

  Renderer.render({ document: effect }, root);
  const badge = badgeOf(root, "first");

  assert.equal(badge.dataset.state, "error");
  assert.ok(badge.dataset.tooltip.includes("<br>"));
  assert.equal(badge.dataset.tooltip.includes("<script"), false);
});

test("re-rendering the sheet replaces the badge instead of stacking copies", () => {
  const effect = createEffect({ changeConditions: { first: "return true;" } });
  const root = createSheet(effect);

  Renderer.render({ document: effect }, root);
  Renderer.render({ document: effect }, root);

  const row = root.querySelectorAll("[data-change-id]").find(node => node.dataset.changeId === "first");
  assert.equal(row.querySelectorAll("[data-sc-cae-change-status]").length, 1);
});

test("a control elsewhere that carries a change id is not badged as a Changes row", () => {
  const effect = createEffect({ changeConditions: { first: "return false;" } });
  const root = createSheet(effect);

  // The Condition tab's summary buttons name their change too. Treating one as
  // a row dropped the status badge inside the button.
  const stray = element("button", { className: "sc-cae-condition-summary__filter", changeId: "first" });
  root.append(stray);

  Renderer.render({ document: effect }, root);

  assert.equal(stray.children.length, 0);
  assert.equal(badgeOf(root, "first").dataset.state, "fail");
});
