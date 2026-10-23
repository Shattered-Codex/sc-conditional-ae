import assert from "node:assert/strict";
import test from "node:test";

/** A DOM small enough for the picker: it builds list rows, toggles attributes and listens for keys. */
class FakeElement {
  constructor(tagName, ownerDocument) {
    this.tagName = String(tagName).toUpperCase();
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.attributes = new Map();
    this.dataset = {};
    this.listeners = new Map();
    this.style = {};
    this.className = "";
    this.hidden = false;
    this.value = "";
    this.text = "";
    this.id = "";
  }

  get classList() {
    return {
      contains: name => this.className.split(" ").includes(name),
      toggle: (name, on) => {
        const names = new Set(this.className.split(" ").filter(Boolean));
        if (on) names.add(name);
        else names.delete(name);
        this.className = [...names].join(" ");
      }
    };
  }

  get textContent() {
    return this.children.length ? this.children.map(child => child.textContent).join("") : this.text;
  }

  set textContent(value) {
    this.text = String(value ?? "");
  }

  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = [...nodes]; }
  contains(node) { return node === this || this.children.some(child => child.contains(node)); }

  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(handler);
  }

  dispatchEvent(event) {
    for (const handler of this.listeners.get(event.type) ?? []) handler(event);
  }

  fire(type) {
    this.dispatchEvent({ type });
  }

  querySelectorAll(selector) {
    if (selector !== "[data-sc-cae-key-option]") throw new Error(`Unexpected selector ${selector}`);
    return this.children.filter(child => "scCaeKeyOption" in child.dataset);
  }
}

const ownerDocument = { createElement: tag => new FakeElement(tag, ownerDocument), addEventListener: () => {} };

const { Dnd5e6NativeFilterKeyTree: Tree } = await import("../scripts/models/Dnd5e6NativeFilterKeyTree.js");
const { Dnd5e6NativeFilterKeyPicker: Picker } = await import("../scripts/applications/Dnd5e6NativeFilterKeyPicker.js");

const ROLL_DATA = {
  attributes: { hp: { value: 12, max: 20 }, ac: { value: 15 } },
  details: { level: 5 },
  statuses: { prone: 1 },
  flags: { secret: 1 },
  _private: 1
};

function createTree() {
  return new Tree({
    entries: [
      { key: "attributes.hp.value", common: true },
      { key: "statuses", common: true, branch: true },
      { key: "statuses.prone", label: "Prone" },
      { key: "statuses.poisoned", label: "Poisoned" }
    ],
    data: ROLL_DATA,
    skipRoots: ["flags"],
    labelOf: key => (key === "attributes.hp.value" ? "Current Hit Points" : "")
  });
}

function createPicker() {
  const popup = new FakeElement("ul", ownerDocument);
  popup.id = "picks";
  popup.hidden = true;
  const reads = [];
  const tree = createTree();
  const picker = new Picker({
    popup,
    tree: ({ fresh }) => { reads.push(fresh); return tree; },
    strings: { common: "Common", keys: "Attributes", matches: "Elsewhere", more: "{count} more", empty: "No attribute matches." }
  });
  const input = new FakeElement("input", ownerDocument);
  const typed = [];
  input.addEventListener("input", () => typed.push(input.value));
  picker.attach(input);
  const press = key => {
    const event = { key, shiftKey: false, prevented: false, stopped: false,
      preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } };
    for (const handler of input.listeners.get("keydown")) handler(event);
    return event;
  };
  const type = text => {
    input.value = text;
    input.fire("input");
  };
  return { popup, picker, input, typed, reads, press, type };
}

test("the tree lists one level at a time from the entries and the roll data", () => {
  const tree = createTree();

  assert.deepEqual(tree.children("").map(child => child.segment), ["attributes", "details", "statuses"]);
  assert.deepEqual(tree.children("attributes.hp").map(child => [child.segment, child.branch]), [["value", false], ["max", false]]);
  assert.deepEqual(tree.children("statuses").map(child => child.segment), ["prone", "poisoned"]);
});

test("an empty query opens with the common keys, their names and what they read now", () => {
  const [common] = createTree().query("").groups;

  assert.equal(common.id, "common");
  assert.deepEqual(common.items.map(item => [item.key, item.insert, item.label, item.value, item.branch]), [
    ["attributes.hp.value", "attributes.hp.value", "Current Hit Points", "12", false],
    ["statuses", "statuses.", "", "", true]
  ]);
});

test("typed text filters the level before the last dot and searches everywhere without one", () => {
  const tree = createTree();

  assert.deepEqual(tree.query("attributes.h").groups[0].items.map(item => item.key), ["attributes.hp"]);
  assert.deepEqual(tree.query("ATTRIBUTES.hp.").groups[0].items.map(item => item.key), ["attributes.hp.value", "attributes.hp.max"]);
  assert.deepEqual(tree.query("level").groups.map(group => [group.id, group.items.map(item => item.key)]), [
    ["matches", ["details.level"]]
  ]);
  assert.deepEqual(tree.query("nothing.here").groups, []);
});

test("a key field opens the list on focus and Enter fills in the chosen key without reaching the form", () => {
  const { popup, picker, input, typed, reads, press } = createPicker();

  assert.deepEqual(["role", "aria-expanded", "aria-controls"].map(name => input.getAttribute(name)), ["combobox", "false", "picks"]);

  input.fire("focus");
  assert.equal(picker.isOpen, true);
  assert.equal(popup.hidden, false);
  assert.deepEqual(reads, [true]);
  assert.deepEqual(popup.children.map(row => row.className.split(" ")[0]), [
    "sc-cae-key-picker__group", "sc-cae-key-picker__option", "sc-cae-key-picker__option",
    "sc-cae-key-picker__group", "sc-cae-key-picker__option", "sc-cae-key-picker__option", "sc-cae-key-picker__option"
  ]);

  press("ArrowDown");
  const enter = press("Enter");
  assert.deepEqual([enter.prevented, enter.stopped], [true, true]);
  assert.equal(input.value, "attributes.hp.value");
  assert.deepEqual(typed, ["attributes.hp.value"]);
  assert.equal(picker.isOpen, false);
  assert.equal(popup.hidden, true);
});

test("accepting a branch adds the dot and keeps the list open one level down", () => {
  const { picker, input, press, type } = createPicker();

  type("stat");
  press("ArrowDown");
  const tab = press("Tab");

  assert.equal(tab.prevented, true);
  assert.equal(input.value, "statuses.");
  assert.equal(picker.isOpen, true);
  assert.deepEqual(picker.items.map(item => [item.key, item.label]), [["statuses.prone", "Prone"], ["statuses.poisoned", "Poisoned"]]);
});

test("text nothing matches says so, and the list closes when its field is redrawn", () => {
  const { popup, picker, input, type } = createPicker();
  const builder = new FakeElement("div", ownerDocument);
  builder.append(input);

  type("zz");
  assert.deepEqual(popup.children.map(row => row.textContent), ["No attribute matches."]);

  picker.release(new FakeElement("div", ownerDocument));
  assert.equal(picker.isOpen, true);
  picker.release(builder);
  assert.equal(picker.isOpen, false);
});

test("the key source reads the data dnd5e checks the filter against and adds every status", async () => {
  globalThis.foundry = { utils: { hasProperty: (object, key) => key.split(".").every(part => (object = object?.[part]) !== undefined) } };
  globalThis.CONFIG = { statusEffects: [{ id: "prone", name: "Prone" }, { id: "poisoned", name: "Poisoned" }, { id: "bad id" }] };
  const { Dnd5e6NativeFilterKeys } = await import("../scripts/helpers/Dnd5e6NativeFilterKeys.js");
  const actor = { getRollData: () => ROLL_DATA };
  const effect = { getReplacementData: base => ({ ...base, item: { name: "Cloak" } }) };

  const tree = Dnd5e6NativeFilterKeys.buildTree({ effect, actor });
  assert.deepEqual(tree.common().map(item => item.key), ["attributes.hp.value", "attributes.hp.max", "attributes.ac.value", "details.level", "statuses"]);
  assert.deepEqual(tree.children("").map(child => child.segment), ["attributes", "details", "item", "statuses"]);
  assert.deepEqual(tree.children("statuses").map(child => child.segment), ["prone", "poisoned"]);

  const unowned = Dnd5e6NativeFilterKeys.buildTree({ effect: null, actor: null });
  assert.equal(unowned.common().some(item => item.key === "details.cr"), true);
});
