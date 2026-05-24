import { Constants } from "../constants/Constants.js";
import { ActiveEffectFormulaChangeService } from "../services/ActiveEffectFormulaChangeService.js";
import { ActiveEffectConditionService } from "../services/ActiveEffectConditionService.js";
import { ModuleSettings } from "../settings/ModuleSettings.js";

export class ActiveEffectFormulaChangeHooks {
  static #registered = false;

  static activate() {
    if (
      ActiveEffectFormulaChangeHooks.#registered
      || !Constants.isDnd5eActive()
      || !ModuleSettings.isFormulaChangesEnabled()
    ) {
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

    if (updates?.disabled !== false) {
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
    const conditionEvaluation = ActiveEffectConditionService.evaluate(effect);
    return effect?.active !== false
      && effect?.disabled !== true
      && !conditionEvaluation.error
      && conditionEvaluation.available;
  }

  static #roll(effect) {
    ActiveEffectFormulaChangeService.rollFormulaChanges(effect)
      .catch(error => console.warn(`[${Constants.MODULE_ID}] active effect formula change hook failed`, error));
  }
}
