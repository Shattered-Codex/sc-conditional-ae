import assert from "node:assert/strict";
import test from "node:test";

const { Dnd5e6NativeFilterBuilderModel: Model } = await import(
  "../scripts/models/Dnd5e6NativeFilterBuilderModel.js"
);

test("builder exposes every operator supported by dnd5e 6", () => {
  assert.deepEqual(Model.GROUP_OPERATORS, ["AND", "NAND", "OR", "NOR", "XOR", "NOT"]);
  assert.deepEqual(Model.COMPARISON_OPERATORS, [
    "exact", "contains", "icontains", "startswith", "istartswith", "endswith", "iendswith",
    "empty", "has", "hasany", "hasall", "subsetof", "in", "gt", "gte", "lt", "lte"
  ]);
});

test("builder round-trips nested filters and typed values", () => {
  const source = {
    o: "OR",
    v: [
      { k: "attributes.hp.value", o: "gt", v: 0 },
      { o: "NOT", v: { k: "statuses", o: "has", v: "dead" } },
      { k: "traits.di.value", o: "hasany", v: ["fire", "cold"] }
    ]
  };

  assert.deepEqual(Model.toDefinition(Model.parse(source), true), source);
});

test("a root comparison becomes an editable AND group without changing its meaning", () => {
  const node = Model.parse('{"k":"attributes.hp.value","o":"gte","v":5}');
  assert.equal(node.kind, "group");
  assert.equal(node.children[0].key, "attributes.hp.value");
  assert.deepEqual(Model.toDefinition(node, true), {
    o: "AND",
    v: [{ k: "attributes.hp.value", o: "gte", v: 5 }]
  });
});

test("value parsing keeps ordinary text and recognizes JSON literals", () => {
  assert.equal(Model.parseValue("fire"), "fire");
  assert.equal(Model.parseValue("true"), true);
  assert.equal(Model.parseValue("5"), 5);
  assert.deepEqual(Model.parseValue('["fire","cold"]'), ["fire", "cold"]);
});

test("formatted strings remain strings even when their contents look like JSON", () => {
  for (const value of ["5", "true", "null", "[1]", '{"a":1}', 'a "quoted" value']) {
    assert.equal(Model.parseValue(Model.formatValue(value)), value);
  }
});

test("empty defaults to the native true value instead of an empty string", () => {
  assert.equal(Model.normalizeValueForOperator("empty", ""), true);
  assert.equal(Model.normalizeValueForOperator("empty", false), false);
});

test("builder preserves an unknown comparison operator instead of rewriting stored JSON", () => {
  const source = { k: "custom.path", o: "module-operator", v: "value" };
  const definition = Model.toDefinition(Model.parse(source), true);

  assert.equal(definition.v[0].o, "module-operator");
});

test("builder rejects unknown group-shaped JSON instead of flattening it", () => {
  assert.throws(
    () => Model.parse({ o: "FUTURE_GROUP", v: [{ k: "path", o: "exact", v: 1 }] }),
    /Unsupported group operator/
  );
});

test("every comparison operator belongs to exactly one editor category", () => {
  const categorized = Model.COMPARISON_OPERATOR_CATEGORIES.flatMap(category => category.operators);
  assert.equal(categorized.length, new Set(categorized).size);
  assert.deepEqual([...categorized].sort(), [...Model.COMPARISON_OPERATORS].sort());
});

test("every operator carries the glyph dnd5e prints in its own filter breakdown", () => {
  for (const operator of [...Model.GROUP_OPERATORS, ...Model.COMPARISON_OPERATORS]) {
    assert.notEqual(Model.symbolFor(operator), "", `missing symbol for ${operator}`);
  }
  assert.equal(Model.symbolFor("gte"), "≥");
  assert.equal(Model.symbolFor("module-operator"), "");
});

test("emptying the root again clears the filter instead of persisting an empty AND", () => {
  const root = Model.parse("{}");
  const condition = Model.createCondition();
  root.children.push(condition);
  root.empty = false;

  assert.deepEqual(Model.toDefinition(root, true), { o: "AND", v: [{ k: "", o: "exact", v: "" }] });

  assert.equal(Model.removeChild(root, condition, { isRoot: true }), true);
  assert.deepEqual(Model.toDefinition(root, true), {});
  assert.equal(Model.removeChild(root, condition, { isRoot: true }), false);
});

test("emptying a nested group keeps it, since an empty OR is not an absent filter", () => {
  const root = Model.parse('{"o":"AND","v":[{"o":"OR","v":[{"k":"a","o":"exact","v":1}]}]}');
  const group = root.children[0];

  assert.equal(Model.removeChild(group, group.children[0], { isRoot: false }), true);
  assert.deepEqual(Model.toDefinition(root, true), { o: "AND", v: [{ o: "OR", v: [] }] });
});

test("switching a multi-condition group to NOT preserves the entire original group", () => {
  for (const operator of ["AND", "OR", "NAND", "NOR", "XOR"]) {
    const definition = {
      o: operator,
      v: [{ k: "a", o: "exact", v: 1 }, { k: "b", o: "lt", v: 10 }]
    };
    const root = Model.parse(definition);
    Model.setGroupOperator(root, "NOT");
    assert.deepEqual(JSON.parse(Model.stringify(root)), { o: "NOT", v: definition });

    Model.setGroupOperator(root, "AND");
    assert.deepEqual(JSON.parse(Model.stringify(root)), { o: "AND", v: [definition] });
  }
});

test("adding a condition or group inside NOT retains its existing child", () => {
  const original = { k: "attributes.hp.value", o: "lt", v: 10 };
  for (const child of [Model.createCondition(), Model.createGroup("OR")]) {
    const root = Model.parse({ o: "NOT", v: original });
    Model.addChild(root, child);
    assert.deepEqual(JSON.parse(Model.stringify(root)), {
      o: "NOT",
      v: { o: "AND", v: [original, Model.toDefinition(child)] }
    });
  }
});
