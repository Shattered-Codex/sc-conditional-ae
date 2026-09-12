import { Constants } from "../constants/Constants.js";

const FORMULA_FIELD_STYLES = Object.freeze(["expand", "popup", "single", "column"]);

/** 0.1.x shipped a two-way popup/inline choice before the row treatments landed. */
const LEGACY_FORMULA_FIELD_STYLES = Object.freeze({ inline: "column" });

export class ModuleSettings {
  static SETTING_MODULE_SETTINGS_MENU = "moduleSettingsMenu";
  static SETTING_ENABLE_FORMULA_CHANGES = "enableFormulaChanges";
  static SETTING_FORMULA_FIELD_STYLE = "formulaFieldStyle";
  static SETTING_USE_FORMULA_CHAT_CARD = "useFormulaChatCard";
  static SETTING_SHOW_CONDITION_TAB = "showConditionTab";
  static SETTING_TINT_EFFECT_ICONS = "tintEffectIcons";
  static SETTING_DEBUG_LOGGING = "debugLogging";

  static isFormulaChangesEnabled() {
    return ModuleSettings.#getBoolean(ModuleSettings.SETTING_ENABLE_FORMULA_CHANGES, true);
  }

  static get FORMULA_FIELD_STYLES() {
    return FORMULA_FIELD_STYLES;
  }

  static getFormulaFieldStyle() {
    const stored = ModuleSettings.#getString(ModuleSettings.SETTING_FORMULA_FIELD_STYLE, "expand");
    const value = LEGACY_FORMULA_FIELD_STYLES[stored] ?? stored;
    return FORMULA_FIELD_STYLES.includes(value) ? value : "expand";
  }

  static isFormulaChatCardEnabled() {
    return ModuleSettings.#getBoolean(ModuleSettings.SETTING_USE_FORMULA_CHAT_CARD, false);
  }

  static isConditionTabEnabled() {
    return ModuleSettings.#getBoolean(ModuleSettings.SETTING_SHOW_CONDITION_TAB, true);
  }

  static isEffectIconTintEnabled() {
    return ModuleSettings.#getBoolean(ModuleSettings.SETTING_TINT_EFFECT_ICONS, false);
  }

  static isDebugLoggingEnabled() {
    return ModuleSettings.#getBoolean(ModuleSettings.SETTING_DEBUG_LOGGING, false);
  }

  static #getString(key, fallback) {
    try {
      const value = game.settings.get(Constants.MODULE_ID, key);
      return typeof value === "string" && value.length ? value : fallback;
    } catch (_error) {
      return fallback;
    }
  }

  static #getBoolean(key, fallback) {
    try {
      return game.settings.get(Constants.MODULE_ID, key) !== false;
    } catch (_error) {
      return fallback;
    }
  }
}
