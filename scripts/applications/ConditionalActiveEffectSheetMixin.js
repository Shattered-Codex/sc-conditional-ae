import { Constants } from "../constants/Constants.js";
import { ConditionTabContextBuilder } from "./ConditionTabContextBuilder.js";
import { EffectSheetSubmitDataHandler } from "./EffectSheetSubmitDataHandler.js";
import { FormulaColumnRenderer } from "./FormulaColumnRenderer.js";
import { ModuleSettings } from "../settings/ModuleSettings.js";

const TEMPLATE_PATH = `modules/${Constants.MODULE_ID}/templates/active-effect-condition-tab.hbs`;
const MINIMUM_SHEET_WIDTH = 1080;
const DAE_MINIMUM_SHEET_WIDTH = 1080;

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

      return foundry.utils.mergeObject(context ?? {}, ConditionTabContextBuilder.build(this, context), { inplace: false });
    }

    _processFormData(...args) {
      const submitData = typeof super._processFormData === "function"
        ? super._processFormData(...args)
        : EffectSheetSubmitDataHandler.findSubmitDataArgument(args);
      EffectSheetSubmitDataHandler.clean(this, submitData);
      return submitData;
    }

    _prepareSubmitData(...args) {
      const submitData = typeof super._prepareSubmitData === "function"
        ? super._prepareSubmitData(...args)
        : EffectSheetSubmitDataHandler.findSubmitDataArgument(args);
      EffectSheetSubmitDataHandler.clean(this, submitData);
      return submitData;
    }

    _processSubmitData(...args) {
      return typeof super._processSubmitData === "function"
        ? super._processSubmitData(...args)
        : this.document.update(EffectSheetSubmitDataHandler.findSubmitDataArgument(args));
    }

    _onRender(...args) {
      super._onRender?.(...args);
      ensureMinimumSheetWidth(this);
      activateBadgeLabelCounter(this);
      activateApplyBehaviorHint(this);
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

  const minimumWidth = getMinimumSheetWidth({ options });
  const configuredWidth = Number(options.position?.width);
  const width = Number.isFinite(configuredWidth)
    ? Math.max(configuredWidth, minimumWidth)
    : minimumWidth;

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
  const minimumWidth = getMinimumSheetWidth({ sheet, root });
  const currentWidth = root?.getBoundingClientRect?.().width ?? 0;
  if (currentWidth >= minimumWidth) {
    return;
  }

  if (typeof sheet.setPosition === "function") {
    sheet.setPosition({ width: minimumWidth });
    return;
  }

  if (root) {
    root.style.width = `${minimumWidth}px`;
  }
}

function getMinimumSheetWidth({ sheet, root, options } = {}) {
  return hasDaeSheetClass(root, sheet, options)
    ? DAE_MINIMUM_SHEET_WIDTH
    : MINIMUM_SHEET_WIDTH;
}

function hasDaeSheetClass(root, sheet, options) {
  if (root?.classList?.contains("dae")) {
    return true;
  }

  const classes = getConfiguredSheetClasses(sheet, options);
  return classes.includes("dae");
}

function getConfiguredSheetClasses(sheet, options) {
  const candidates = [
    options?.classes,
    sheet?.options?.classes,
    sheet?.constructor?.DEFAULT_OPTIONS?.classes
  ];

  for (const value of candidates) {
    if (Array.isArray(value)) {
      return value;
    }
  }

  return [];
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

function activateBadgeLabelCounter(sheet) {
  const root = FormulaColumnRenderer.getSheetRoot(sheet) ?? sheet.element;
  if (!root) {
    return;
  }

  const input = root.querySelector(".sc-cae-badge-label-input");
  const counter = root.querySelector(".sc-cae-badge-label-counter");
  if (!input || !counter) {
    return;
  }

  const maxLength = Constants.CONDITION_BADGE_LABEL_MAX_LENGTH;
  counter.textContent = `${input.value.length}/${maxLength}`;
  input.addEventListener("input", () => {
    counter.textContent = `${input.value.length}/${maxLength}`;
  });
}

function activateApplyBehaviorHint(sheet) {
  const root = FormulaColumnRenderer.getSheetRoot(sheet) ?? sheet.element;
  if (!root) {
    return;
  }

  const select = root.querySelector(`select[name="${Constants.APPLY_BEHAVIOR_FLAG_PATH}"]`);
  const hint = root.querySelector("[data-sc-cae-apply-behavior-hint]");
  if (!select || !hint) {
    return;
  }

  const syncHint = () => {
    hint.textContent = ConditionTabContextBuilder.getApplyBehaviorDescription(String(select.value ?? ""));
  };

  syncHint();
  select.addEventListener("change", syncHint);
}
