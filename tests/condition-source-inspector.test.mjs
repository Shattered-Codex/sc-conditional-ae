import assert from "node:assert/strict";
import test from "node:test";

import { ConditionSourceInspector } from "../scripts/helpers/ConditionSourceInspector.js";

test("finds identifiers in ordinary code and template expressions", () => {
  assert.equal(ConditionSourceInspector.usesIdentifier("return lightLevel === 'bright';", "lightLevel"), true);
  assert.equal(ConditionSourceInspector.usesIdentifier('return `${lightLevel}` === "bright";', "lightLevel"), true);
  assert.equal(ConditionSourceInspector.usesIdentifier("return `${token?.id}`;", "token"), true);
});

test("ignores identifiers in text, comments, regex literals, member keys, and object keys", () => {
  assert.equal(ConditionSourceInspector.usesIdentifier("return 'lightLevel';", "lightLevel"), false);
  assert.equal(ConditionSourceInspector.usesIdentifier("// lightLevel\nreturn true;", "lightLevel"), false);
  assert.equal(ConditionSourceInspector.usesIdentifier("return /lightLevel/.test(actor.name);", "lightLevel"), false);
  assert.equal(ConditionSourceInspector.usesIdentifier("return actor.system.lightLevel;", "lightLevel"), false);
  assert.equal(ConditionSourceInspector.usesIdentifier("return { lightLevel: 'bright' };", "lightLevel"), false);
});

test("does not mistake division for a regex literal", () => {
  assert.equal(
    ConditionSourceInspector.usesIdentifier("return actor.system.value / lightLevel > 1;", "lightLevel"),
    true
  );
});

test("inspects expression strings passed to DAE helpers", () => {
  assert.equal(
    ConditionSourceInspector.usesIdentifier("dae.eval(\"lightLevel === 'bright'\")", "lightLevel"),
    true
  );
  assert.equal(
    ConditionSourceInspector.usesIdentifier("dae.roll('@lightLevel') > 0", "lightLevel"),
    true
  );
  assert.equal(
    ConditionSourceInspector.usesIdentifier("other.eval('lightLevel')", "lightLevel"),
    false
  );
});
