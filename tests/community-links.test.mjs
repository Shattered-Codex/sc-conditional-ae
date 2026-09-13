import assert from "node:assert/strict";
import test from "node:test";

class FakeElement {
  constructor(tag = "div") {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.dataset = {};
    this.attributes = new Map();
    this.className = "";
    this.listeners = [];
    this.textContent = "";
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  matches(selector) {
    const [name, value] = selector.replace(/^\[|\]$/g, "").split("=");
    return this.attributes.get(name) === value?.replace(/^"|"$/g, "");
  }

  append(...nodes) {
    this.children.push(...nodes);
  }

  addEventListener(type, handler) {
    this.listeners.push({ type, handler });
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  // ApplicationRoot duck-types the root on querySelectorAll, so the fake needs it.
  querySelectorAll(selector) {
    const all = [...this.children, ...this.children.flatMap(child => child.children)];
    if (selector.startsWith(".")) {
      return all.filter(node => node.className.split(/\s+/).includes(selector.slice(1)));
    }
    return all.filter(node => node.matches?.(selector));
  }
}

const opened = [];
globalThis.document = { createElement: tag => new FakeElement(tag) };
globalThis.window = { open: url => opened.push(url) };
globalThis.game = { i18n: { localize: key => key }, system: { id: "dnd5e", version: "6.0.0" } };

const { CommunityLinks } = await import("../scripts/settings/CommunityLinks.js");
const { Constants } = await import("../scripts/constants/Constants.js");

test("offers wiki, Patreon and Discord, each with a real URL", () => {
  const links = CommunityLinks.links();
  assert.deepEqual(links.map(link => link.id), ["wiki", "patreon", "discord"]);
  for (const link of links) {
    assert.match(link.url, /^https:\/\//, `${link.id} should point somewhere`);
  }
});

test("the strip lands at the end of this module's own settings section", () => {
  const section = new FakeElement("section");
  section.setAttribute("data-category", Constants.MODULE_ID);
  const root = new FakeElement("form");
  root.append(section);

  const strip = CommunityLinks.inject(root);

  assert.ok(strip);
  assert.equal(section.children.at(-1), strip);
  assert.equal(strip.children.length, 3);
  // Re-rendering the settings sheet must not stack a second strip.
  assert.equal(CommunityLinks.inject(root), null);
});

test("another package's section is left untouched", () => {
  const section = new FakeElement("section");
  section.setAttribute("data-category", "some-other-module");
  const root = new FakeElement("form");
  root.append(section);

  assert.equal(CommunityLinks.inject(root), null);
  assert.equal(section.children.length, 0);
});

test("a click opens the link without submitting the settings form", () => {
  opened.length = 0;
  const section = new FakeElement("section");
  section.setAttribute("data-category", Constants.MODULE_ID);
  const root = new FakeElement("form");
  root.append(section);

  const strip = CommunityLinks.inject(root);
  const [button] = strip.children;
  let defaultPrevented = false;
  let propagationStopped = false;
  button.listeners[0].handler({
    preventDefault: () => { defaultPrevented = true; },
    stopPropagation: () => { propagationStopped = true; }
  });

  assert.equal(defaultPrevented, true);
  assert.equal(propagationStopped, true);
  assert.deepEqual(opened, [Constants.MODULE_WIKI_URL]);
});
