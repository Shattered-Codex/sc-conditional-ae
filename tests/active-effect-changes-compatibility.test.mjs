import assert from "node:assert/strict";
import test from "node:test";

globalThis.foundry = {
  utils: { deepClone: value => structuredClone(value) }
};
globalThis.game = { system: { id: "dnd5e", version: "6.0.0" } };

const { ActiveEffectChangesCompatibility: Changes } = await import(
  "../scripts/compat/ActiveEffectChangesCompatibility.js"
);
const { ActiveEffectContextBuilder } = await import(
  "../scripts/helpers/ActiveEffectContextBuilder.js"
);

test("reads and writes the dnd5e 6 system.changes shape", () => {
  const effect = { system: { changes: [{ _id: "v6", key: "system.test" }] } };

  assert.equal(Changes.get(effect)[0]._id, "v6");
  assert.deepEqual(Changes.buildUpdate(Changes.clone(effect), effect), {
    "system.changes": [{ _id: "v6", key: "system.test" }]
  });
});

test("preserves the legacy changes shape used by dnd5e 5.3", () => {
  game.system.version = "5.3.3";
  try {
    const effect = { changes: [{ key: "system.legacy" }] };
    assert.deepEqual(Changes.buildUpdate(Changes.clone(effect), effect), {
      changes: [{ key: "system.legacy" }]
    });
  } finally {
    game.system.version = "6.0.0";
  }
});

test("change signatures preserve the v6 string type instead of treating every type as CUSTOM", () => {
  assert.deepEqual(ActiveEffectContextBuilder.getChangeSignature([
    { key: "system.a", type: "add" },
    { key: "system.b", type: "override" }
  ]), [
    { key: "system.a", mode: "add" },
    { key: "system.b", mode: "override" }
  ]);
});

test("a numeric mode and the v6 type it stands for produce the same signature", () => {
  globalThis.CONST = {
    ACTIVE_EFFECT_MODES: { CUSTOM: 0, MULTIPLY: 1, ADD: 2, DOWNGRADE: 3, UPGRADE: 4, OVERRIDE: 5 }
  };

  // Legacy source data (a compendium entry, a socket payload, another module)
  // carries only the numeric mode; the live document carries the string type.
  // Matching one against the other is the whole point of a signature.
  const legacy = ActiveEffectContextBuilder.getChangeSignature([
    { key: "system.a", mode: 2 },
    { key: "system.b", mode: 5 },
    { key: "system.c", mode: 0 }
  ]);
  const document = ActiveEffectContextBuilder.getChangeSignature([
    { key: "system.a", type: "add" },
    { key: "system.b", type: "override" },
    { key: "system.c", type: "custom" }
  ]);

  assert.deepEqual(legacy, document);
});

test("a change with neither mode nor type still yields a comparable signature", () => {
  assert.deepEqual(
    ActiveEffectContextBuilder.getChangeSignature([{ key: "system.a" }]),
    [{ key: "system.a", mode: "" }]
  );
});

test("dnd5e 7 keeps the system.changes path the dnd5e 6 migration introduced", () => {
  game.system.version = "7.0.0";
  try {
    assert.equal(Changes.usesSystemPath(), true);
  } finally {
    game.system.version = "6.0.0";
  }
});
