import { Constants } from "../constants/Constants.js";

const CARD_FLAG = "formulaChatCard";
const ROLLED_INDEXES_FLAG = `${CARD_FLAG}.rolledIndexes`;
const BUTTON_SELECTOR = ".sc-cae-formula-request-button";
const INLINE_BUTTON_SELECTOR = ".sc-cae-formula-request-button--inline";
const ROLL_ALL_BUTTON_SELECTOR = `.sc-cae-formula-request-actions ${BUTTON_SELECTOR}`;
const ROLLED_ENTRY_CLASS = "sc-cae-formula-request-entry--rolled";

/**
 * Remembers which formulas a roll request card has already rolled, so each one
 * can only be rolled once from that card.
 *
 * The state lives in the chat message flags, so every client and every
 * re-render agrees. A user who may not update the message (a player answering a
 * card the GM posted) still gets the lock, but only on their own client.
 */
export class FormulaChatCardRollLock {
  static #localRolls = new Map();

  static isRequestCard(message) {
    return Boolean(message?.getFlag?.(Constants.MODULE_ID, CARD_FLAG));
  }

  /** Every change index the card was posted for. */
  static getCardIndexes(card) {
    const raw = card?.querySelector(ROLL_ALL_BUTTON_SELECTOR)?.dataset.changeIndexes;
    return String(raw ?? "")
      .split(",")
      .filter(Boolean)
      .map(Number)
      .filter(Number.isInteger);
  }

  static getRolledIndexes(message) {
    const stored = message?.getFlag?.(Constants.MODULE_ID, ROLLED_INDEXES_FLAG);
    return FormulaChatCardRollLock.#normalize([
      ...(Array.isArray(stored) ? stored : []),
      ...(FormulaChatCardRollLock.#localRolls.get(message?.id) ?? [])
    ]);
  }

  static getPendingIndexes(indexes, rolledIndexes) {
    const rolled = new Set(rolledIndexes);
    return indexes.filter(index => !rolled.has(index));
  }

  static async markRolled(message, indexes) {
    const rolledIndexes = FormulaChatCardRollLock.#normalize([
      ...FormulaChatCardRollLock.getRolledIndexes(message),
      ...indexes
    ]);

    if (message.canUserModify?.(game.user, "update")) {
      try {
        await message.setFlag(Constants.MODULE_ID, ROLLED_INDEXES_FLAG, rolledIndexes);
        return rolledIndexes;
      } catch (error) {
        console.warn(`[${Constants.MODULE_ID}] formula chat card lock could not be saved`, error);
      }
    }

    FormulaChatCardRollLock.#localRolls.set(message.id, rolledIndexes);
    return rolledIndexes;
  }

  /** Blocks the whole card while one of its rolls is in progress. */
  static setBusy(card) {
    for (const button of card.querySelectorAll(BUTTON_SELECTOR)) {
      button.disabled = true;
    }
  }

  static apply(card, rolledIndexes) {
    const rolled = new Set(rolledIndexes);
    for (const button of card.querySelectorAll(INLINE_BUTTON_SELECTOR)) {
      const isRolled = rolled.has(Number(button.dataset.changeIndex));
      button.disabled = isRolled;
      button.closest(".sc-cae-formula-request-entry")?.classList.toggle(ROLLED_ENTRY_CLASS, isRolled);
      if (isRolled) {
        button.textContent = Constants.localize("SCConditionalAE.FormulaChange.ChatCardRolledButton", "Rolled");
      }
    }

    const rollAllButton = card.querySelector(ROLL_ALL_BUTTON_SELECTOR);
    if (!rollAllButton) {
      return;
    }

    const allRolled = !FormulaChatCardRollLock.getPendingIndexes(
      FormulaChatCardRollLock.getCardIndexes(card),
      rolledIndexes
    ).length;
    rollAllButton.disabled = allRolled;
    if (allRolled) {
      rollAllButton.textContent = Constants.localize(
        "SCConditionalAE.FormulaChange.ChatCardAllRolledButton",
        "All formulas rolled"
      );
    }
  }

  static #normalize(indexes) {
    return [...new Set(indexes.map(Number).filter(Number.isInteger))].sort((left, right) => left - right);
  }
}
