import { Constants } from "../constants/Constants.js";
import { ConditionalActiveEffectSheetMixin } from "./ConditionalActiveEffectSheetMixin.js";

export class ActiveEffectSheetRegistrar {
  static #mixedSheetCache = new WeakMap();

  static registerSheets() {
    if (!Constants.isDnd5eActive()) {
      return;
    }

    const types = Array.from(ActiveEffectSheetRegistrar.#getActiveEffectTypes());
    Constants.debug("registering Active Effect sheets", {
      types,
      foundryVersion: game.version,
      system: game.system?.id,
      modules: {
        dae: game.modules.get("dae")?.active ?? false,
        auraeffects: game.modules.get("auraeffects")?.active ?? false
      },
      before: ActiveEffectSheetRegistrar.#getSheetSummary()
    });

    for (const type of types) {
      ActiveEffectSheetRegistrar.#registerSheet(type);
    }

    Constants.debug("finished Active Effect sheet registration", {
      after: ActiveEffectSheetRegistrar.#getSheetSummary()
    });
  }

  static #registerSheet(type) {
    const baseSheet = ActiveEffectSheetRegistrar.#getDefaultSheetClass(type);
    const sheetClass = ActiveEffectSheetRegistrar.#getMixedSheet(baseSheet);
    Constants.debug(`registering sheet for ActiveEffect type "${type}"`, {
      baseSheet: baseSheet?.name,
      mixedSheet: sheetClass?.name,
      parts: Object.keys(sheetClass?.PARTS ?? {}),
      tabs: sheetClass?.TABS?.sheet?.tabs?.map(tab => tab.id) ?? []
    });

    foundry.applications.apps.DocumentSheetConfig.registerSheet(
      ActiveEffect,
      Constants.MODULE_ID,
      sheetClass,
      {
        label: "SCConditionalAE.Sheets.ActiveEffect",
        types: [type],
        makeDefault: true,
        canBeDefault: true,
        canConfigure: true
      }
    );

    ActiveEffectSheetRegistrar.#forceDefaultSheet(type, sheetClass);
  }

  static #getActiveEffectTypes() {
    const types = new Set(game.documentTypes?.ActiveEffect ?? []);
    for (const type of Object.keys(CONFIG.ActiveEffect?.sheetClasses ?? {})) {
      types.add(type);
    }
    for (const type of Object.keys(CONFIG.ActiveEffect?.dataModels ?? {})) {
      types.add(type);
    }
    return types.size ? types : new Set(["base"]);
  }

  static #getDefaultSheetClass(type) {
    const sheetConfigs = Object.values(CONFIG.ActiveEffect?.sheetClasses?.[type] ?? {});
    return sheetConfigs.find(sheet => sheet.default)?.cls
      ?? sheetConfigs[sheetConfigs.length - 1]?.cls
      ?? foundry.applications.sheets.ActiveEffectConfig;
  }

  static #getMixedSheet(sheetClass) {
    if (ActiveEffectSheetRegistrar.#isConditionalSheet(sheetClass)) {
      return sheetClass;
    }

    const cached = ActiveEffectSheetRegistrar.#mixedSheetCache.get(sheetClass);
    if (cached) {
      return cached;
    }

    const mixedSheet = ConditionalActiveEffectSheetMixin(sheetClass);
    ActiveEffectSheetRegistrar.#mixedSheetCache.set(sheetClass, mixedSheet);
    return mixedSheet;
  }

  static #isConditionalSheet(sheetClass) {
    return Boolean(sheetClass?.PARTS?.condition && sheetClass?.TABS?.sheet?.tabs?.some(tab => tab.id === "condition"));
  }

  static #forceDefaultSheet(type, sheetClass) {
    const sheetConfigs = CONFIG.ActiveEffect?.sheetClasses?.[type];
    if (!sheetConfigs) {
      Constants.debug(`could not force default for "${type}": no sheet config found`);
      return;
    }

    const registeredSheet = Object.values(sheetConfigs).find(sheet => sheet.cls === sheetClass);
    if (!registeredSheet) {
      Constants.debug(`could not force default for "${type}": registered sheet not found`, {
        expectedClass: sheetClass?.name,
        available: Object.values(sheetConfigs).map(sheet => ({
          id: sheet.id,
          label: sheet.label,
          className: sheet.cls?.name,
          default: sheet.default
        }))
      });
      return;
    }

    for (const sheet of Object.values(sheetConfigs)) {
      sheet.default = false;
    }
    registeredSheet.default = true;
    Constants.debug(`forced default sheet for "${type}"`, {
      id: registeredSheet.id,
      label: registeredSheet.label,
      className: registeredSheet.cls?.name
    });
  }

  static #getSheetSummary() {
    const summary = {};
    for (const [type, sheetConfigs] of Object.entries(CONFIG.ActiveEffect?.sheetClasses ?? {})) {
      summary[type] = Object.values(sheetConfigs ?? {}).map(sheet => ({
        id: sheet.id,
        label: sheet.label,
        className: sheet.cls?.name,
        default: sheet.default,
        hasConditionPart: Boolean(sheet.cls?.PARTS?.condition),
        tabs: sheet.cls?.TABS?.sheet?.tabs?.map(tab => tab.id) ?? []
      }));
    }
    return summary;
  }
}
