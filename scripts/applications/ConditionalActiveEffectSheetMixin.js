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
  const evaluation = buildConditionEvaluationContext(sheet, condition, validation);

  return {
    tab: getConditionTab(sheet, context),
    condition,
    conditionInputValue,
    conditionFlagPath: Constants.CONDITION_FLAG_PATH,
    conditionWikiUrl: `${Constants.MODULE_WIKI_URL}#active-effect-condition`,
    conditionInvalid: !validation.valid,
    validationMessage: validation.error?.message ?? "",
    evaluation,
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
      evaluationHeading: Constants.localize("SCConditionalAE.ConditionTab.Evaluation.Heading", "Current evaluation"),
      evaluationEmpty: Constants.localize(
        "SCConditionalAE.ConditionTab.Evaluation.Empty",
        "No condition configured. The effect is available."
      ),
      evaluationTrue: Constants.localize(
        "SCConditionalAE.ConditionTab.Evaluation.True",
        "The condition currently resolves to true. The effect is available."
      ),
      evaluationFalse: Constants.localize(
        "SCConditionalAE.ConditionTab.Evaluation.False",
        "The condition currently resolves to false. The effect is suppressed."
      ),
      evaluationError: Constants.localize(
        "SCConditionalAE.ConditionTab.Evaluation.Error",
        "The condition threw an error while being evaluated."
      ),
      evaluationResult: Constants.localize("SCConditionalAE.ConditionTab.Evaluation.Result", "Returned value"),
      evaluationContext: Constants.localize("SCConditionalAE.ConditionTab.Evaluation.Context", "Evaluated against"),
      evaluationEffectState: Constants.localize("SCConditionalAE.ConditionTab.Evaluation.EffectState", "Effect state"),
      wiki: Constants.localize("SCConditionalAE.ConditionTab.Wiki", "Open wiki"),
      invalid: Constants.localize("SCConditionalAE.ConditionTab.Invalid", "This condition has invalid code.")
    }
  };
}

function buildConditionEvaluationContext(sheet, condition, validation) {
  const trimmedCondition = String(condition ?? "").trim();
  if (!trimmedCondition.length) {
    return {
      state: "empty",
      available: true,
      isEmpty: true,
      isTrue: false,
      isFalse: false,
      isError: false,
      hasResult: false,
      resultLabel: "",
      contextLabel: getEvaluationContextLabel(sheet.document),
      effectStateLabel: getEffectStateLabel(sheet.document)
    };
  }

  if (!validation.valid) {
    return {
      state: "error",
      available: false,
      isEmpty: false,
      isTrue: false,
      isFalse: false,
      isError: true,
      hasResult: false,
      resultLabel: "",
      contextLabel: getEvaluationContextLabel(sheet.document),
      effectStateLabel: getEffectStateLabel(sheet.document),
      errorMessage: validation.error?.message ?? ""
    };
  }

  const evaluation = ActiveEffectConditionService.evaluate(sheet.document);
  return {
    state: evaluation.error ? "error" : (evaluation.available ? "true" : "false"),
    available: evaluation.available,
    isEmpty: false,
    isTrue: !evaluation.error && evaluation.available,
    isFalse: !evaluation.error && !evaluation.available,
    isError: Boolean(evaluation.error),
    hasResult: !evaluation.error,
    resultLabel: formatConditionResult(evaluation.result),
    contextLabel: getEvaluationContextLabel(sheet.document),
    effectStateLabel: getEffectStateLabel(sheet.document),
    errorMessage: evaluation.error?.message ?? ""
  };
}

function formatConditionResult(value) {
  if (value === undefined) {
    return "undefined";
  }

  if (typeof value === "string") {
    return JSON.stringify(value);
  }

  if (typeof value === "function") {
    return "[Function]";
  }

  if (typeof value === "object" && value !== null) {
    try {
      const serialized = JSON.stringify(value);
      return serialized.length > 180 ? `${serialized.slice(0, 177)}...` : serialized;
    } catch {
      return "[Object]";
    }
  }

  return String(value);
}

function getEvaluationContextLabel(effect) {
  const parent = effect?.parent;
  if (parent instanceof CONFIG.Actor.documentClass) {
    return parent.name ?? parent.uuid ?? "";
  }

  if (parent instanceof CONFIG.Item.documentClass) {
    const actor = parent.actor ?? parent.parent ?? null;
    if (actor instanceof CONFIG.Actor.documentClass) {
      return `${actor.name ?? actor.uuid ?? ""} / ${parent.name ?? parent.uuid ?? ""}`;
    }

    return parent.name ?? parent.uuid ?? "";
  }

  return effect?.name ?? effect?.uuid ?? "";
}

function getEffectStateLabel(effect) {
  const states = [];

  if (effect?.disabled === true) {
    states.push("disabled");
  }

  if (effect?.isSuppressed === true) {
    states.push("suppressed");
  }

  if (effect?.active === false) {
    states.push("inactive");
  }

  if (!states.length) {
    states.push("active");
  }

  return states.join(", ");
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
    DaeCompatibility.applyConditionSubmitData(submitData, "");
    return;
  }

  const existingCondition = ActiveEffectConditionService.getCondition(sheet.document);
  const fallbackMode = DaeCompatibility.getCompatibilityMode(existingCondition);
  DaeCompatibility.applyConditionSubmitData(submitData, trimmedCondition, fallbackMode);
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
