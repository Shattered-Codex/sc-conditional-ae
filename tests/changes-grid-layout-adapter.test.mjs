import assert from "node:assert/strict";
import test from "node:test";

import { ChangesGridLayoutAdapter } from "../scripts/applications/ChangesGridLayoutAdapter.js";

test("counts the tracks a stylesheet declares", () => {
  assert.equal(ChangesGridLayoutAdapter.countTracks("12rem 7rem 7rem 4rem 1rem"), 5);
  assert.equal(ChangesGridLayoutAdapter.countTracks("192px 112px 112px 64px 16px"), 5);
});

test("ignores the spaces inside functions and line names", () => {
  assert.equal(
    ChangesGridLayoutAdapter.countTracks("minmax(0, 2.2fr) minmax(0, 0.9fr) max-content"),
    3
  );
  assert.equal(ChangesGridLayoutAdapter.countTracks("[full-start] 1fr [full-end] 2fr"), 2);
});

test("reports no tracks when the tab does not use a grid", () => {
  assert.equal(ChangesGridLayoutAdapter.countTracks("none"), 0);
  assert.equal(ChangesGridLayoutAdapter.countTracks(""), 0);
  assert.equal(ChangesGridLayoutAdapter.countTracks(undefined), 0);
});

test("identifies the system columns by class", () => {
  assert.equal(ChangesGridLayoutAdapter.resolveColumnId({ classNames: ["key"] }), "key");
  assert.equal(ChangesGridLayoutAdapter.resolveColumnId({ classNames: ["priority"] }), "priority");
  assert.equal(ChangesGridLayoutAdapter.resolveColumnId({ classNames: ["controls"] }), "controls");
});

test("identifies this module's own cells before the system ones", () => {
  assert.equal(
    ChangesGridLayoutAdapter.resolveColumnId({ classNames: ["sc-cae-formula-column", "value"] }),
    "formula"
  );
  assert.equal(
    ChangesGridLayoutAdapter.resolveColumnId({ classNames: ["sc-cae-formula-header"] }),
    "formula"
  );
});

test("falls back to the field name when a cell carries no known class", () => {
  assert.equal(
    ChangesGridLayoutAdapter.resolveColumnId({ classNames: ["dae-cell"], fieldName: "changes.0.phase" }),
    "phase"
  );
  assert.equal(
    ChangesGridLayoutAdapter.resolveColumnId({ classNames: [], fieldName: "system.changes.2.value" }),
    "value"
  );
});

test("leaves an unrecognised column unidentified", () => {
  assert.equal(
    ChangesGridLayoutAdapter.resolveColumnId({ classNames: ["mystery"], fieldName: "flags.x.y" }),
    ""
  );
});

test("builds one track per cell, in the order the row presents them", () => {
  const columnIds = ["key", "type", "value", "formula", "phase", "priority", "controls"];

  assert.equal(
    ChangesGridLayoutAdapter.buildTrackList(columnIds),
    "minmax(0, 2.2fr) minmax(0, 0.9fr) minmax(0, 1.5fr) 2.75rem minmax(0, 0.8fr) minmax(0, 0.55fr) max-content"
  );
});

test("gives the always-visible formula field a real share of the row", () => {
  assert.equal(
    ChangesGridLayoutAdapter.buildTrackList(["value", "formula-field"]),
    "minmax(0, 1.5fr) minmax(0, 1.2fr)"
  );
});

test("pads unknown and missing columns so the header keeps its alignment", () => {
  assert.equal(
    ChangesGridLayoutAdapter.buildTrackList(["key", ""], 3),
    "minmax(0, 2.2fr) minmax(0, 0.8fr) minmax(0, 0.8fr)"
  );
});
