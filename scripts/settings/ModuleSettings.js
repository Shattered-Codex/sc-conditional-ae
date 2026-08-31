import { Constants } from "../constants/Constants.js";

const FORMULA_FIELD_STYLES = Object.freeze(["expand", "popup", "single", "column"]);

/** 0.1.x shipped a two-way popup/inline choice before the row treatments landed. */
const LEGACY_FORMULA_FIELD_STYLES = Object.freeze({ inline: "column" });

export class ModuleSettings {
  static SETTING_MODULE_SETTINGS_MENU = "moduleSettingsMenu";
  static SETTING_SUPPORT_MENU = "supportMenu";
  static SETTING_DOCUMENTATION_MENU = "docsMenu";
  static SETTING_ENABLE_FORMULA_CHANGES = "enableFormulaChanges";
  static SETTING_FORMULA_FIELD_STYLE = "formulaFieldStyle";
  static SETTING_USE_FORMULA_CHAT_CARD = "useFormulaChatCard";
  static SETTING_SHOW_CONDITION_TAB = "showConditionTab";
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

  /** 1a — an icon in the row expands a full-width formula field underneath it. */
  static isFormulaFieldExpandable() {
    return ModuleSettings.getFormulaFieldStyle() === "expand";
  }

  /** 1b — an fx button in the row opens the dedicated editor. */
  static isFormulaFieldPopup() {
    return ModuleSettings.getFormulaFieldStyle() === "popup";
  }

  /** 1c — the change's own Value field switches between a number and a formula. */
  static isFormulaFieldSingle() {
    return ModuleSettings.getFormulaFieldStyle() === "single";
  }

  /** The original treatment: a labelled Formula column with a field in every row. */
  static isFormulaFieldColumn() {
    return ModuleSettings.getFormulaFieldStyle() === "column";
  }

  static isFormulaChatCardEnabled() {
    return ModuleSettings.#getBoolean(ModuleSettings.SETTING_USE_FORMULA_CHAT_CARD, false);
  }

  static isConditionTabEnabled() {
    return ModuleSettings.#getBoolean(ModuleSettings.SETTING_SHOW_CONDITION_TAB, true);
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
