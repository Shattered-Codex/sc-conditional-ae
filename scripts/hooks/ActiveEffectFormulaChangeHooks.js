import { Constants } from "../constants/Constants.js";
import { ActiveEffectFormulaChangeService } from "../services/ActiveEffectFormulaChangeService.js";

export class ActiveEffectFormulaChangeHooks {
  static #registered = false;

  static activate() {
    if (ActiveEffectFormulaChangeHooks.#registered || !Constants.isDnd5eActive()) {
      return;
    }

    ActiveEffectFormulaChangeHooks.#registered = true;
    Hooks.on("preCreateActiveEffect", ActiveEffectFormulaChangeHooks.#onPreCreateActiveEffect);
    Hooks.on("preUpdateActiveEffect", ActiveEffectFormulaChangeHooks.#onPreUpdateActiveEffect);
    Hooks.on("createActiveEffect", ActiveEffectFormulaChangeHooks.#onCreateActiveEffect);
    Hooks.on("updateActiveEffect", ActiveEffectFormulaChangeHooks.#onUpdateActiveEffect);
  }

  static #onPreCreateActiveEffect(effect, data) {
    ActiveEffectFormulaChangeService.prepareCreateSource(effect, data);
  }

  static #onPreUpdateActiveEffect(effect, updates, options) {
    ActiveEffectFormulaChangeService.prepareUpdateSource(effect, updates, options);
  }

  static #onCreateActiveEffect(effect) {
    if (!ActiveEffectFormulaChangeHooks.#shouldRoll(effect) || !ActiveEffectFormulaChangeHooks.#isActive(effect)) {
      return;
    }

    ActiveEffectFormulaChangeHooks.#roll(effect);
  }

  static #onUpdateActiveEffect(effect, updates, options) {
    if (options?.[Constants.MODULE_ID]?.[ActiveEffectFormulaChangeService.ROLL_UPDATE_OPTION]) {
      return;
    }

    const reactivated = updates?.disabled === false;
    const formulaChangesEdited = Array.isArray(updates?.changes) && ActiveEffectFormulaChangeService.hasFormulaChanges(effect);
    if (!reactivated && !formulaChangesEdited) {
      return;
    }

    if (!ActiveEffectFormulaChangeHooks.#shouldRoll(effect) || !ActiveEffectFormulaChangeHooks.#isActive(effect)) {
      return;
    }

    ActiveEffectFormulaChangeHooks.#roll(effect);
  }

  static #shouldRoll(effect) {
    return ActiveEffectFormulaChangeService.hasFormulaChanges(effect)
      && ActiveEffectFormulaChangeService.shouldPromptForCurrentUser(effect);
  }

  static #isActive(effect) {
    return effect?.active !== false && effect?.disabled !== true;
  }

  static #roll(effect) {
    ActiveEffectFormulaChangeService.rollFormulaChanges(effect)
      .catch(error => console.warn(`[${Constants.MODULE_ID}] active effect formula change hook failed`, error));
  }
}
