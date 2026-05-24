import { Constants } from "../constants/Constants.js";

export class ModuleSettings {
  static SETTING_SUPPORT_MENU = "supportMenu";
  static SETTING_DOCUMENTATION_MENU = "docsMenu";
  static SETTING_ENABLE_FORMULA_CHANGES = "enableFormulaChanges";
  static SETTING_SHOW_CONDITION_TAB = "showConditionTab";
  static SETTING_DEBUG_LOGGING = "debugLogging";

  static isFormulaChangesEnabled() {
    return ModuleSettings.#getBoolean(ModuleSettings.SETTING_ENABLE_FORMULA_CHANGES, true);
  }

  static isConditionTabEnabled() {
    return ModuleSettings.#getBoolean(ModuleSettings.SETTING_SHOW_CONDITION_TAB, true);
  }

  static isDebugLoggingEnabled() {
    return ModuleSettings.#getBoolean(ModuleSettings.SETTING_DEBUG_LOGGING, false);
  }

  static #getBoolean(key, fallback) {
    try {
      return game.settings.get(Constants.MODULE_ID, key) !== false;
    } catch (_error) {
      return fallback;
    }
  }
}
