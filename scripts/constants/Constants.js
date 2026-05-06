export class Constants {
  static MODULE_ID = "sc-conditional-ae";
  static MODULE_WIKI_URL = "https://wiki.shattered-codex.com/modules/sc-conditional-ae";
  static FLAG_CONDITION = "condition";
  static CONDITION_FLAG_PATH = `flags.${Constants.MODULE_ID}.${Constants.FLAG_CONDITION}`;
  static DEBUG_GLOBAL = "SC_CONDITIONAL_AE_DEBUG";

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
}
