import { Constants } from "../constants/Constants.js";
import { DaeCompatibility } from "../compat/DaeCompatibility.js";
import { ActiveEffectConditionService } from "../services/ActiveEffectConditionService.js";
import { ActiveEffectFormulaChangeService } from "../services/ActiveEffectFormulaChangeService.js";
import { FormulaColumnRenderer } from "./FormulaColumnRenderer.js";
import { ModuleSettings } from "../settings/ModuleSettings.js";

const TEMPLATE_PATH = `modules/${Constants.MODULE_ID}/templates/active-effect-condition-tab.hbs`;
const MINIMUM_SHEET_WIDTH = 650;
let formulaColumnHookRegistered = false;

export function activateFormulaColumnRenderHook() {
  if (formulaColumnHookRegistered) {
    return;
  }

  formulaColumnHookRegistered = true;
  Hooks.on("renderActiveEffectConfig", (app, html) => {
    FormulaColumnRenderer.scheduleRender(app, html);
    FormulaColumnRenderer.activateObserver(app, html);
  });
}

export function ConditionalActiveEffectSheetMixin(ActiveEffectSheet) {
  return class ConditionalActiveEffectSheet extends ActiveEffectSheet {
    static DEFAULT_OPTIONS = getExtendedDefaultOptions(super.DEFAULT_OPTIONS ?? {});

    static PARTS = getExtendedParts(super.PARTS ?? {});

    static TABS = getExtendedTabs(super.TABS ?? {});

    async _preparePartContext(partId, context, options) {
      context = await super._preparePartContext(partId, context, options);
      if (partId !== "condition") {
        return context;
      }

      return foundry.utils.mergeObject(context ?? {}, buildConditionContext(this, context), { inplace: false });
    }

    _processFormData(...args) {
      const submitData = typeof super._processFormData === "function"
        ? super._processFormData(...args)
        : findSubmitDataArgument(args);
      cleanSubmitData(this, submitData);
      return submitData;
    }

    _prepareSubmitData(...args) {
      const submitData = typeof super._prepareSubmitData === "function"
        ? super._prepareSubmitData(...args)
        : findSubmitDataArgument(args);
      cleanSubmitData(this, submitData);
      return submitData;
    }

    _processSubmitData(...args) {
      cleanSubmitData(this, findSubmitDataArgument(args));
      return typeof super._processSubmitData === "function"
        ? super._processSubmitData(...args)
        : this.document.update(findSubmitDataArgument(args));
    }

    _onRender(...args) {
      super._onRender?.(...args);
      ensureMinimumSheetWidth(this);
      if (ModuleSettings.isFormulaChangesEnabled()) {
        FormulaColumnRenderer.scheduleRender(this);
        FormulaColumnRenderer.activateObserver(this);
      }
    }

    _onClose(...args) {
      FormulaColumnRenderer.deactivateObserver(this);
      return super._onClose?.(...args);
    }
  };
}

function getExtendedDefaultOptions(options) {
  if (!ModuleSettings.isFormulaChangesEnabled()) {
    return options;
  }

  const configuredWidth = Number(options.position?.width);
  const width = Number.isFinite(configuredWidth)
    ? Math.max(configuredWidth, MINIMUM_SHEET_WIDTH)
    : MINIMUM_SHEET_WIDTH;

  return {
    ...options,
    position: {
      ...(options.position ?? {}),
      width
    }
  };
}

function ensureMinimumSheetWidth(sheet) {
  if (!ModuleSettings.isFormulaChangesEnabled()) {
    return;
  }

  const root = FormulaColumnRenderer.getSheetRoot(sheet);
  const currentWidth = root?.getBoundingClientRect?.().width ?? 0;
  if (currentWidth >= MINIMUM_SHEET_WIDTH) {
    return;
  }

  if (typeof sheet.setPosition === "function") {
    sheet.setPosition({ width: MINIMUM_SHEET_WIDTH });
    return;
  }

  if (root) {
    root.style.width = `${MINIMUM_SHEET_WIDTH}px`;
  }
}

function getExtendedParts(parts) {
  if (!ModuleSettings.isConditionTabEnabled() || parts.condition) {
    return parts;
  }

  const entries = Object.entries(parts);
  const footerIndex = entries.findIndex(([key]) => key === "footer" || key === "submit");
  const conditionEntry = ["condition", { template: TEMPLATE_PATH, scrollable: [""] }];

  if (footerIndex === -1) {
    return Object.fromEntries([...entries, conditionEntry]);
  }

  const extendedEntries = [...entries];
  extendedEntries.splice(footerIndex, 0, conditionEntry);
  return Object.fromEntries(extendedEntries);
}

function getExtendedTabs(tabs) {
  if (!ModuleSettings.isConditionTabEnabled()) {
    return tabs;
  }

  const sheetTabs = tabs.sheet ?? {
    tabs: [
      { id: "details", icon: "fa-solid fa-book" },
      { id: "duration", icon: "fa-solid fa-clock" },
      { id: "changes", icon: "fa-solid fa-gears" }
    ],
    initial: "details",
    labelPrefix: "EFFECT.TABS"
  };

  if (sheetTabs.tabs?.some(tab => tab.id === "condition")) {
    return tabs;
  }

  return {
    ...tabs,
    sheet: {
      ...sheetTabs,
      tabs: [
        ...(sheetTabs.tabs ?? []),
        {
          id: "condition",
          icon: "fa-solid fa-code",
          label: Constants.localize("SCConditionalAE.ConditionTab.Label", "Condition")
        }
      ]
    }
  };
}

function buildConditionContext(sheet, context) {
  const condition = ActiveEffectConditionService.getCondition(sheet.document);
  const conditionInputValue = DaeCompatibility.toDisplayCondition(condition);
  const validation = ActiveEffectConditionService.validateCondition(condition);
  const usesDaeCompatibility = DaeCompatibility.isCompatibilityCondition(condition);

  return {
    tab: getConditionTab(sheet, context),
    condition,
    conditionInputValue,
    conditionFlagPath: Constants.CONDITION_FLAG_PATH,
    conditionWikiUrl: `${Constants.MODULE_WIKI_URL}#active-effect-condition`,
    conditionInvalid: !validation.valid,
    validationMessage: validation.error?.message ?? "",
    strings: {
      label: Constants.localize("SCConditionalAE.ConditionTab.Label", "Condition"),
      heading: Constants.localize("SCConditionalAE.ConditionTab.Heading", "Active Effect condition"),
      hint: Constants.localize(
        "SCConditionalAE.ConditionTab.Hint",
        "Use JavaScript. This Active Effect is applied only when the script returns true."
      ),
      compatibilityHint: usesDaeCompatibility
        ? Constants.localize(
          "SCConditionalAE.ConditionTab.CompatibilityHint",
          "This condition came from DAE. SC Conditional AE is adapting it automatically."
        )
        : "",
      variables: Constants.localize(
        "SCConditionalAE.ConditionTab.Variables",
        "Available variables: effect, actor, targetActor, item, origin, originActor, user, rollData, source, getProperty, hasProperty, deepClone, game."
      ),
      placeholder: Constants.localize(
        "SCConditionalAE.ConditionTab.Placeholder",
        "Example: return actor?.system?.attributes?.hp?.value > 0;"
      ),
      wiki: Constants.localize("SCConditionalAE.ConditionTab.Wiki", "Open wiki"),
      invalid: Constants.localize("SCConditionalAE.ConditionTab.Invalid", "This condition has invalid code.")
    }
  };
}

function getConditionTab(sheet, context) {
  if (context?.tabs?.condition) {
    return context.tabs.condition;
  }

  const active = sheet.tabGroups?.sheet === "condition";
  return {
    id: "condition",
    group: "sheet",
    active,
    cssClass: active ? "active" : ""
  };
}

function cleanConditionSubmitData(sheet, submitData) {
  const condition = foundry.utils.getProperty(submitData ?? {}, Constants.CONDITION_FLAG_PATH);
  if (typeof condition !== "string") {
    return;
  }

  const trimmedCondition = condition.trim();
  if (!trimmedCondition.length) {
    foundry.utils.setProperty(submitData, Constants.CONDITION_FLAG_PATH, null);
    foundry.utils.setProperty(submitData, Constants.DAE_CONDITION_FLAG_PATH, null);
    foundry.utils.setProperty(submitData, Constants.DAE_DISABLE_CONDITION_FLAG_PATH, null);
    return;
  }

  const fallbackMode = DaeCompatibility.getCompatibilityMode(
    ActiveEffectConditionService.getCondition(sheet.document)
  );
  const normalizedCondition = DaeCompatibility.normalizeSubmittedCondition(trimmedCondition, fallbackMode);

  foundry.utils.setProperty(submitData, Constants.CONDITION_FLAG_PATH, normalizedCondition);
  foundry.utils.setProperty(submitData, Constants.DAE_CONDITION_FLAG_PATH, null);
  foundry.utils.setProperty(submitData, Constants.DAE_DISABLE_CONDITION_FLAG_PATH, null);
}

function cleanSubmitData(sheet, submitData) {
  const data = submitData?.object && typeof submitData.object === "object" ? submitData.object : submitData;
  const targets = getSubmitDataTargets(submitData, data);
  for (const target of targets) {
    cleanConditionSubmitData(sheet, target);
    if (ModuleSettings.isFormulaChangesEnabled()) {
      collectFormulaSubmitData(sheet, target);
      ActiveEffectFormulaChangeService.prepareSubmitData(sheet.document, target);
    }
  }
}

function collectFormulaSubmitData(sheet, submitData) {
  const root = FormulaColumnRenderer.getSheetRoot(sheet);
  if (!root || !submitData) {
    return;
  }

  for (const input of root.querySelectorAll(".sc-cae-formula-input")) {
    if (!input.name) {
      continue;
    }

    foundry.utils.setProperty(submitData, input.name, input.value ?? "");
  }
}

function getSubmitDataTargets(submitData, primaryData) {
  const targets = new Set();
  if (primaryData && typeof primaryData === "object") {
    targets.add(primaryData);
  }

  for (const key of ["object", "updateData"]) {
    const value = submitData?.[key];
    if (value && typeof value === "object") {
      targets.add(value);
    }
  }

  if (
    targets.size === 0
    && submitData
    && typeof submitData === "object"
    && !("currentTarget" in submitData)
    && !("target" in submitData)
  ) {
    targets.add(submitData);
  }

  return targets;
}

// Foundry v13 passes submitData as args[2]; v14 changed the signature.
// This heuristic finds the correct argument across both versions and dnd5e overrides.
function findSubmitDataArgument(args) {
  if (args[2]?.object && typeof args[2].object === "object") {
    return args[2].object;
  }

  if (args[2] && typeof args[2] === "object") {
    return args[2];
  }

  for (let index = args.length - 1; index >= 0; index -= 1) {
    const arg = args[index];
    if (!arg || typeof arg !== "object") {
      continue;
    }

    if (arg.object && typeof arg.object === "object") {
      return arg.object;
    }

    if (!("currentTarget" in arg) && !("target" in arg)) {
      return arg;
    }
  }

  return {};
}
