import assert from "node:assert/strict";
import test from "node:test";

globalThis.game = { user: { id: "player" } };

const { FormulaChatCardRollLock } = await import("../scripts/helpers/FormulaChatCardRollLock.js");

const MODULE_ID = "sc-conditional-ae";
const ROLL_ALL_SELECTOR = ".sc-cae-formula-request-actions .sc-cae-formula-request-button";

function createMessage({ id, rolledIndexes, canUpdate = true, failSave = false }) {
  const card = { effectUuid: "Actor.a.ActiveEffect.e" };
  if (rolledIndexes) {
    card.rolledIndexes = rolledIndexes;
  }

  return {
    id,
    writes: [],
    flags: { [MODULE_ID]: { formulaChatCard: card } },
    getFlag(scope, key) {
      return key.split(".").reduce((value, part) => value?.[part], this.flags[scope]);
    },
    canUserModify: () => canUpdate,
    async setFlag(scope, key, value) {
      if (failSave) {
        throw new Error("permission denied");
      }
      this.writes.push({ scope, key, value });
      this.flags[scope].formulaChatCard.rolledIndexes = value;
    }
  };
}

/** Only the selectors the lock reads: the inline buttons, their entries and "Roll all". */
function createCard(indexes) {
  const entries = indexes.map(() => {
    const classes = new Set();
    return { classes, classList: { toggle: (name, force) => (force ? classes.add(name) : classes.delete(name)) } };
  });
  const inline = indexes.map((index, position) => ({
    dataset: { changeIndex: String(index) },
    disabled: false,
    textContent: "Roll",
    closest: selector => (selector === ".sc-cae-formula-request-entry" ? entries[position] : null)
  }));
  const rollAll = { dataset: { changeIndexes: indexes.join(",") }, disabled: false, textContent: "Roll all formulas" };

  return {
    entries,
    inline,
    rollAll,
    querySelector: selector => (selector === ROLL_ALL_SELECTOR ? rollAll : null),
    querySelectorAll(selector) {
      if (selector === ".sc-cae-formula-request-button--inline") return inline;
      if (selector === ".sc-cae-formula-request-button") return [...inline, rollAll];
      return [];
    }
  };
}

test("only messages posted as a formula request card are locked", () => {
  assert.equal(FormulaChatCardRollLock.isRequestCard(createMessage({ id: "request" })), true);
  assert.equal(FormulaChatCardRollLock.isRequestCard({ getFlag: () => undefined }), false);
});

test("a card only rolls the formulas it has not rolled yet", () => {
  const card = createCard([0, 2, 3]);
  const message = createMessage({ id: "pending", rolledIndexes: [2] });
  const rolled = FormulaChatCardRollLock.getRolledIndexes(message);

  assert.deepEqual(FormulaChatCardRollLock.getCardIndexes(card), [0, 2, 3]);
  assert.deepEqual(FormulaChatCardRollLock.getPendingIndexes(FormulaChatCardRollLock.getCardIndexes(card), rolled), [0, 3]);
  assert.deepEqual(FormulaChatCardRollLock.getPendingIndexes([2], rolled), []);
});

test("rolled formulas are saved on the message so every client sees the lock", async () => {
  const message = createMessage({ id: "saved", rolledIndexes: [0] });

  const rolled = await FormulaChatCardRollLock.markRolled(message, [3, 0]);

  assert.deepEqual(rolled, [0, 3]);
  assert.deepEqual(message.writes, [{ scope: MODULE_ID, key: "formulaChatCard.rolledIndexes", value: [0, 3] }]);
  assert.deepEqual(FormulaChatCardRollLock.getRolledIndexes(message), [0, 3]);
});

test("a user who cannot update the message still keeps the lock on their own client", async () => {
  const message = createMessage({ id: "gm-card", canUpdate: false });

  await FormulaChatCardRollLock.markRolled(message, [1]);

  assert.deepEqual(message.writes, []);
  assert.deepEqual(FormulaChatCardRollLock.getRolledIndexes(message), [1]);
});

test("a lock that fails to save is still kept locally", async () => {
  const message = createMessage({ id: "failed-save", failSave: true });
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    await FormulaChatCardRollLock.markRolled(message, [4]);
  } finally {
    console.warn = originalWarn;
  }

  assert.deepEqual(FormulaChatCardRollLock.getRolledIndexes(message), [4]);
});

test("a rolled formula locks its own button while the rest become available again", () => {
  const card = createCard([0, 1]);

  FormulaChatCardRollLock.setBusy(card);
  assert.equal([...card.inline, card.rollAll].every(button => button.disabled), true);

  FormulaChatCardRollLock.apply(card, [0]);

  assert.equal(card.inline[0].disabled, true);
  assert.equal(card.inline[0].textContent, "Rolled");
  assert.equal(card.entries[0].classes.has("sc-cae-formula-request-entry--rolled"), true);
  assert.equal(card.inline[1].disabled, false);
  assert.equal(card.inline[1].textContent, "Roll");
  assert.equal(card.rollAll.disabled, false);
  assert.equal(card.rollAll.textContent, "Roll all formulas");
});

test("roll all locks once every formula on the card has been rolled", () => {
  const card = createCard([0, 1]);

  FormulaChatCardRollLock.apply(card, [0, 1]);

  assert.equal(card.rollAll.disabled, true);
  assert.equal(card.rollAll.textContent, "All formulas rolled");
});
