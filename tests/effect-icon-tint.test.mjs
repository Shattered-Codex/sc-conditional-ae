import assert from "node:assert/strict";
import test from "node:test";

const { EffectIconTint } = await import("../scripts/helpers/EffectIconTint.js");

test("the core default white is not a tint", () => {
  // ActiveEffect.tint is ColorField({nullable: false, initial: "#ffffff"}) in
  // both Foundry v13 and v14, so every effect carries a colour. Painting the
  // identity tint would wrap every icon in the list for no visible change.
  assert.equal(EffectIconTint.resolve({ tint: "#ffffff" }), null);
  assert.equal(EffectIconTint.resolve({ tint: "#FFF" }), null);
});

test("a chosen colour is normalized and returned", () => {
  assert.equal(EffectIconTint.resolve({ tint: "#b31919" }), "#b31919");
  assert.equal(EffectIconTint.resolve({ tint: "  #B31919  " }), "#b31919");
  assert.equal(EffectIconTint.resolve({ tint: "#0f0" }), "#0f0");
});

test("anything that is not a hex colour paints nothing", () => {
  for (const tint of [undefined, null, "", "red", "rgb(1,2,3)", "#12345", "javascript:alert(1)", {}]) {
    assert.equal(EffectIconTint.resolve({ tint }), null, `${JSON.stringify(tint)} should not paint`);
  }
});

test("a Color object is read through its css representation", () => {
  assert.equal(EffectIconTint.resolve({ tint: { css: "#336699" } }), "#336699");
});

class FakeIcon {
  constructor(tag = "img") {
    this.tagName = tag.toUpperCase();
    this.className = "";
    this.attributes = new Map();
    this.parent = null;
    this.style = {
      properties: new Map(),
      setProperty(name, value) { this.properties.set(name, value); },
      removeProperty(name) { this.properties.delete(name); }
    };
    this.ownerDocument = {
      createElement: tag => new FakeIcon(tag),
      defaultView: { getComputedStyle: () => ({ borderRadius: "8px" }) }
    };
  }

  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  append(node) { node.parent = this; this.child = node; }
  closest(selector) {
    const attribute = selector.replace(/^\[|\]$/g, "");
    return this.parent?.attributes.has(attribute) ? this.parent : null;
  }
  replaceWith(node) { if (this.parent) this.parent.child = node; node.parent = this.parent; }
}

test("a raster icon is wrapped and clipped to its own corner radius", () => {
  const icon = new FakeIcon("img");

  EffectIconTint.paint(icon, "#b40e0e");
  const wrapper = icon.parent;

  assert.equal(wrapper.className, "sc-cae-effect-icon-tint");
  assert.equal(wrapper.style.properties.get("--sc-cae-effect-tint"), "#b40e0e");
  // The sheet portrait is rounded; a square overlay would show at the corners.
  assert.equal(wrapper.style.borderRadius, "8px");
});

test("an SVG icon takes the colour through dnd5e's own fill variable", () => {
  const icon = new FakeIcon("dnd5e-icon");

  EffectIconTint.paint(icon, "#336699");

  assert.equal(icon.style.properties.get("--icon-fill"), "#336699");
  assert.equal(icon.parent, null, "an SVG needs no wrapper");
});

test("clearing the tint leaves no wrapper behind", () => {
  const icon = new FakeIcon("img");
  EffectIconTint.paint(icon, "#b40e0e");
  const wrapper = icon.parent;

  EffectIconTint.paint(icon, null);

  assert.equal(wrapper.child, icon, "the icon takes the wrapper's place again");
});
