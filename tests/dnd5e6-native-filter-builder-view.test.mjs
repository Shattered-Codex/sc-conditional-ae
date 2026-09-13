import assert from "node:assert/strict";
import test from "node:test";

/**
 * A DOM small enough to describe the builder: the view only creates elements,
 * sets text, attributes and datasets, and re-reads its own key label.
 */
class FakeElement {
  constructor(tagName, ownerDocument) {
    this.tagName = String(tagName).toUpperCase();
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.attributes = new Map();
    this.dataset = {};
    this.classList = createClassList();
    this.hidden = false;
    this.listeners = new Map();
    this.text = "";
  }

  get className() {
    return Array.from(this.classList).join(" ");
  }

  set className(value) {
    this.classList = createClassList(String(value).split(/\s+/).filter(Boolean));
  }

  get textContent() {
    return this.children.length ? this.children.map(child => child.textContent).join("") : this.text;
  }

  set textContent(value) {
    this.text = String(value ?? "");
    this.children = [];
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(handler);
  }

  append(...nodes) {
    for (const node of nodes) this.children.push(node);
  }

  replaceChildren(...nodes) {
    this.children = [];
    this.append(...nodes);
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  querySelectorAll(selector) {
    const name = selector.replace(/^\./, "");
    return descendants(this).filter(node => node.classList.contains(name));
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

const ownerDocument = { createElement: tag => new FakeElement(tag, ownerDocument) };

function findAll(node, tagName) {
  return descendants(node).filter(child => child.tagName === tagName);
}

const STRINGS = {
  keyPlaceholder: "Roll-data path",
  valuePlaceholder: "Value",
  groupOperator: "Group operator",
  comparisonOperator: "Comparison operator",
  matchLabel: "Match",
  attributeColumn: "Attribute",
  operatorColumn: "Operator",
  valueColumn: "Value",
  addCondition: "Add condition",
  addGroup: "Add group",
  remove: "Remove",
  empty: "No conditions.",
  groupOperators: { AND: "Match all", OR: "Match any", NOT: "Invert", NAND: "n", NOR: "n", XOR: "x" },
  comparisonCategories: { value: "Value", text: "Text", collection: "Collection" },
  comparisonOperators: { exact: "is exactly", gte: "is at least", icontains: "contains (ignore case)" }
};

const { Dnd5e6NativeFilterBuilderView: View } = await import(
  "../scripts/applications/Dnd5e6NativeFilterBuilderView.js"
);

function build(source) {
  const builder = new FakeElement("div", ownerDocument);
  const rawEditor = { value: source };
  const view = new View({ builder, rawEditor, source, strings: STRINGS, onChange: () => {} });
  return { builder, rawEditor, view };
}

test("comparison operators are offered as labelled options grouped by category", () => {
  const { builder } = build('{"k":"attributes.hp.value","o":"gte","v":5}');
  const select = builder.querySelector(".sc-cae-filter-operator--comparison");

  assert.deepEqual(findAll(select, "OPTGROUP").map(group => group.label), ["Value", "Text", "Collection"]);

  const options = findAll(select, "OPTION");
  assert.equal(options.find(option => option.value === "gte").textContent, "≥  is at least");
  assert.equal(options.find(option => option.value === "icontains").textContent, "⊇  contains (ignore case)");
  assert.equal(options.filter(option => option.selected).map(option => option.value).join(), "gte");
});

test("group operators are offered as labelled options", () => {
  const { builder } = build('{"o":"OR","v":[{"k":"a","o":"exact","v":1}]}');
  const options = findAll(builder.querySelector(".sc-cae-filter-operator--group"), "OPTION");

  assert.equal(options.find(option => option.value === "AND").textContent, "∧  Match all");
  assert.equal(options.filter(option => option.selected).map(option => option.value).join(), "OR");
});

test("an operator the editor does not know stays selectable instead of being rewritten", () => {
  const { builder } = build('{"k":"custom.path","o":"module-operator","v":"x"}');
  const options = findAll(builder.querySelector(".sc-cae-filter-operator--comparison"), "OPTION");
  const unknown = options.find(option => option.value === "module-operator");

  assert.ok(unknown);
  assert.equal(unknown.textContent, "module-operator");
  assert.equal(unknown.selected, true);
});

test("a group listing conditions prints the column header once", () => {
  const { builder } = build('{"o":"AND","v":[{"k":"a","o":"exact","v":1},{"k":"b","o":"exact","v":2}]}');
  const headers = builder.querySelectorAll(".sc-cae-filter-columns");

  assert.equal(headers.length, 1);
  assert.deepEqual(headers[0].children.map(cell => cell.textContent), ["Attribute", "Operator", "Value", ""]);
});

test("a group holding only nested groups prints no column header", () => {
  const { builder } = build('{"o":"AND","v":[{"o":"OR","v":[]}]}');
  assert.equal(builder.querySelectorAll(".sc-cae-filter-columns").length, 0);
});

test("changing Match to NOT keeps every visible condition in the saved JSON", () => {
  const definition = { o: "OR", v: [{ k: "a", v: 1 }, { k: "b", v: 2 }] };
  const { builder, rawEditor } = build(JSON.stringify(definition));
  const select = builder.querySelector(".sc-cae-filter-operator--group");
  select.value = "NOT";
  for (const handler of select.listeners.get("change")) handler();

  assert.equal(builder.querySelectorAll(".sc-cae-filter-condition").length, 2);
  assert.deepEqual(JSON.parse(rawEditor.value), {
    o: "NOT", v: { o: "OR", v: [{ k: "a", o: "exact", v: 1 }, { k: "b", o: "exact", v: 2 }] }
  });
});

test("the add buttons in NOT never replace the existing condition", () => {
  const original = { k: "attributes.hp.value", o: "lt", v: 10 };
  for (const label of [STRINGS.addCondition, STRINGS.addGroup]) {
    const { builder, rawEditor } = build(JSON.stringify({ o: "NOT", v: original }));
    const button = findAll(builder, "BUTTON").find(button => button.getAttribute("aria-label") === label);
    for (const handler of button.listeners.get("click")) handler({ preventDefault() {} });

    const definition = JSON.parse(rawEditor.value);
    assert.deepEqual(definition.v.v[0], original);
    assert.equal(definition.v.v.length, 2);
    assert.equal(builder.querySelectorAll(".sc-cae-filter-key")[0].value, original.k);
  }
});
