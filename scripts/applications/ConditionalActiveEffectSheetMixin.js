import { Constants } from "../constants/Constants.js";
import { ActiveEffectConditionService } from "../services/ActiveEffectConditionService.js";
import { ActiveEffectFormulaChangeService } from "../services/ActiveEffectFormulaChangeService.js";

const TEMPLATE_PATH = `modules/${Constants.MODULE_ID}/templates/active-effect-condition-tab.hbs`;

export function ConditionalActiveEffectSheetMixin(ActiveEffectSheet) {
  return class ConditionalActiveEffectSheet extends ActiveEffectSheet {
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
      restoreFormulaChangeInputs(this);
    }
  };
}

function getExtendedParts(parts) {
  if (parts.condition) {
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
  const validation = ActiveEffectConditionService.validateCondition(condition);

  return {
    tab: getConditionTab(sheet, context),
    condition,
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

function cleanConditionSubmitData(submitData) {
  const condition = foundry.utils.getProperty(submitData ?? {}, Constants.CONDITION_FLAG_PATH);
  if (typeof condition === "string" && !condition.trim().length) {
    foundry.utils.setProperty(submitData, Constants.CONDITION_FLAG_PATH, null);
  }
}

function cleanSubmitData(sheet, submitData) {
  const data = submitData?.object && typeof submitData.object === "object" ? submitData.object : submitData;
  cleanConditionSubmitData(data);
  ActiveEffectFormulaChangeService.prepareSubmitData(sheet.document, data);
}

function restoreFormulaChangeInputs(sheet) {
  const formulaChanges = ActiveEffectFormulaChangeService.getFormulaChanges(sheet.document);
  const root = sheet.element instanceof HTMLElement ? sheet.element : sheet.element?.[0];
  for (const [index, formulaChange] of Object.entries(formulaChanges)) {
    const input = root?.querySelector?.(`[name="changes.${index}.value"], [name="changes[${index}][value]"]`);
    if (!input || typeof formulaChange?.formula !== "string") {
      continue;
    }

    input.value = formulaChange.formula;
  }
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
