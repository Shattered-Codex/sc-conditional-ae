export class Constants {
  static MODULE_ID = "sc-conditional-ae";
  static MODULE_WIKI_URL = "https://wiki.shattered-codex.com/modules/sc-conditional-ae";
  static PATREON_URL = "https://www.patreon.com/c/shatteredcodex?utm_source=sc-conditional-ae&utm_medium=foundry_module&utm_campaign=support_button";
  static FLAG_CONDITION = "condition";
  static FLAG_FORMULA_CHANGES = "formulaChanges";
  static FLAG_CONDITION_BADGE_LABEL = "conditionBadgeLabel";
  static FLAG_CONDITION_BEHAVIOR = "conditionBehavior";
  static FLAG_CONDITION_MANAGED_DISABLED = "conditionManagedDisabled";
  static FLAG_APPLY_BEHAVIOR = "applyBehavior";
  static CONDITION_FLAG_PATH = `flags.${Constants.MODULE_ID}.${Constants.FLAG_CONDITION}`;
  static FORMULA_CHANGES_FLAG_PATH = `flags.${Constants.MODULE_ID}.${Constants.FLAG_FORMULA_CHANGES}`;
  static CONDITION_BADGE_LABEL_FLAG_PATH = `flags.${Constants.MODULE_ID}.${Constants.FLAG_CONDITION_BADGE_LABEL}`;
  static CONDITION_BEHAVIOR_FLAG_PATH = `flags.${Constants.MODULE_ID}.${Constants.FLAG_CONDITION_BEHAVIOR}`;
  static CONDITION_MANAGED_DISABLED_FLAG_PATH = `flags.${Constants.MODULE_ID}.${Constants.FLAG_CONDITION_MANAGED_DISABLED}`;
  static APPLY_BEHAVIOR_FLAG_PATH = `flags.${Constants.MODULE_ID}.${Constants.FLAG_APPLY_BEHAVIOR}`;
  static CONDITION_BADGE_LABEL_MAX_LENGTH = 45;
  static CONDITION_BEHAVIOR_SUPPRESS = "suppress";
  static CONDITION_BEHAVIOR_DISABLE = "disable";
  static DAE_CONDITION_FLAG_PATH = "flags.dae.enableCondition";
  static DAE_DISABLE_CONDITION_FLAG_PATH = "flags.dae.disableCondition";
  static DAE_CONDITION_PREFIX = "dae:";
  static DAE_DISABLE_CONDITION_PREFIX = "dae-disable:";
  static DEBUG_GLOBAL = "SC_CONDITIONAL_AE_DEBUG";
  static MACRO_EXECUTE_CHANGE_KEY = "cae.macro.execute";
  static LEGACY_MACRO_EXECUTE_CHANGE_KEY = `${Constants.MODULE_ID}.macro.execute`;
  static DAE_MACRO_EXECUTE_CHANGE_KEY = "macro.execute";

  static debug(message, data = undefined) {
    if (!globalThis[Constants.DEBUG_GLOBAL]) {
      return;
    }

    const prefix = `[${Constants.MODULE_ID}] ${message}`;
    if (data === undefined) {
      console.debug(prefix);
      return;
    }

    console.debug(prefix, data);
  }

  static localize(key, fallback = key) {
    const localized = typeof game?.i18n?.localize === "function" ? game.i18n.localize(key) : undefined;
    return (localized && localized !== key) ? localized : (fallback ?? key);
  }

  static isDnd5eActive() {
    return game?.system?.id === "dnd5e";
  }

  static isDaeActive() {
    return game?.modules?.get("dae")?.active === true;
  }
}
