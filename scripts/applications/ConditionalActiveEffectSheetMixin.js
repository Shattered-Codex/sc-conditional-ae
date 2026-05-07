import { Constants } from "../constants/Constants.js";
import { DaeCompatibility } from "../compat/DaeCompatibility.js";
import { ActiveEffectConditionService } from "../services/ActiveEffectConditionService.js";
import { ActiveEffectFormulaChangeService } from "../services/ActiveEffectFormulaChangeService.js";
import { ModuleSettings } from "../settings/ModuleSettings.js";

const TEMPLATE_PATH = `modules/${Constants.MODULE_ID}/templates/active-effect-condition-tab.hbs`;
const CHANGE_SECTION_SELECTOR = "section.changes, section[data-tab='changes'], section[data-tab='effects']";
const CHANGE_KEY_INPUT_SELECTOR = `[name*="changes"][name$=".key"], [name*="changes"][name$="[key]"]`;
const CHANGE_PRIORITY_INPUT_SELECTOR = `[name*="changes"][name$=".priority"], [name*="changes"][name$="[priority]"]`;
const CHANGE_VALUE_INPUT_SELECTOR = `[name*="changes"][name$=".value"], [name*="changes"][name$="[value]"]`;
const MINIMUM_SHEET_WIDTH = 650;
const FORMULA_COLUMN_OBSERVERS = new WeakMap();
let formulaColumnHookRegistered = false;

export function activateFormulaColumnRenderHook() {
  if (formulaColumnHookRegistered) {
    return;
  }

  formulaColumnHookRegistered = true;
  Hooks.on("renderActiveEffectConfig", (app, html) => {
    scheduleFormulaColumnRender(app, html);
    activateFormulaColumnObserver(app, html);
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
        scheduleFormulaColumnRender(this);
        activateFormulaColumnObserver(this);
      }
    }

    _onClose(...args) {
      const controls = FORMULA_COLUMN_OBSERVERS.get(this);
      controls?.observer?.disconnect();
      if (controls?.root && controls?.onInput) {
        controls.root.removeEventListener("input", controls.onInput, true);
        controls.root.removeEventListener("change", controls.onInput, true);
      }
      FORMULA_COLUMN_OBSERVERS.delete(this);
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

  const root = getSheetRoot(sheet);
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
  const root = getSheetRoot(sheet);
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

function renderFormulaColumn(sheet, rootOverride) {
  if (!ModuleSettings.isFormulaChangesEnabled()) {
    return;
  }

  const root = getSheetRoot(sheet, rootOverride);
  if (!root) {
    return;
  }

  const formulaChanges = ActiveEffectFormulaChangeService.getFormulaChanges(sheet.document);
  ensureFormulaColumnForAllRows(root, formulaChanges);
}

function scheduleFormulaColumnRender(sheet, rootOverride) {
  renderFormulaColumn(sheet, rootOverride);
  requestAnimationFrame(() => renderFormulaColumn(sheet, rootOverride));
}

function activateFormulaColumnObserver(sheet, rootOverride) {
  const root = getSheetRoot(sheet, rootOverride);
  if (!root) {
    return;
  }

  const current = FORMULA_COLUMN_OBSERVERS.get(sheet);
  if (current?.root === root) {
    return;
  }

  current?.observer?.disconnect();
  if (current?.root && current?.onInput) {
    current.root.removeEventListener("input", current.onInput, true);
    current.root.removeEventListener("change", current.onInput, true);
  }

  let queued = false;
  const queueRender = () => {
    if (queued) {
      return;
    }

    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      renderFormulaColumn(sheet, root);
    });
  };
  const observer = new MutationObserver(queueRender);
  const onInput = event => {
    if (isChangeValueInput(event.target)) {
      queueRender();
    }
  };

  observer.observe(root, { childList: true, subtree: true });
  root.addEventListener("input", onInput, true);
  root.addEventListener("change", onInput, true);
  FORMULA_COLUMN_OBSERVERS.set(sheet, { observer, root, onInput });
}

function getSheetRoot(sheet, rootOverride) {
  if (rootOverride instanceof HTMLElement) {
    return rootOverride;
  }

  if (rootOverride?.[0] instanceof HTMLElement) {
    return rootOverride[0];
  }

  return sheet.element instanceof HTMLElement ? sheet.element : sheet.element?.[0] ?? null;
}

function ensureFormulaColumnForAllRows(root, formulaChanges) {
  for (const table of root.querySelectorAll("table")) {
    ensureTableFormulaColumn(table, formulaChanges);
  }

  for (const section of findChangeSections(root)) {
    ensureListFormulaColumn(section, formulaChanges);
  }
}

function findChangeSections(root) {
  const sections = new Set();
  for (const input of getChangeValueInputs(root)) {
    const row = findChangeRow(root, input, getChangeIndexFromName(input.name));
    const section = row?.closest(CHANGE_SECTION_SELECTOR);
    if (section && !row.closest("table")) {
      sections.add(section);
    }
  }

  return sections;
}

function ensureTableFormulaColumn(table, formulaChanges) {
  const rows = Array.from(table.querySelectorAll("tbody tr"));
  const firstValueInput = rows
    .map(row => row.querySelector(CHANGE_VALUE_INPUT_SELECTOR))
    .find(Boolean);
  const firstValueCell = firstValueInput?.closest("td");
  const firstRow = firstValueCell?.closest("tr");
  if (!firstValueCell || !firstRow) {
    return;
  }

  const columnIndex = Array.from(firstRow.children).indexOf(firstValueCell) + 1;
  const headerRow = table.tHead?.rows?.[0] ?? table.querySelector("thead tr");
  if (headerRow && !headerRow.querySelector(".sc-cae-formula-header")) {
    const headerCell = document.createElement("th");
    headerCell.className = "sc-cae-formula-header";
    headerCell.textContent = Constants.localize("SCConditionalAE.FormulaChange.Column", "Formula");
    headerCell.dataset.tooltip = Constants.localize(
      "SCConditionalAE.FormulaChange.ColumnHint",
      "Formula rolled when this Active Effect is activated."
    );
    headerCell.dataset.tooltipDirection = "UP";
    const referenceCell = headerRow.children[columnIndex];
    if (referenceCell) {
      referenceCell.before(headerCell);
    } else {
      headerRow.append(headerCell);
    }
  }

  let fallbackIndex = 0;
  for (const row of rows) {
    const valueInput = row.querySelector(CHANGE_VALUE_INPUT_SELECTOR);
    const valueCell = valueInput?.closest("td");
    if (!valueInput || !valueCell) {
      continue;
    }

    const formulaCell = ensureTableFormulaCell(row, valueCell, columnIndex);
    updateFormulaInput(formulaCell, valueInput, row, formulaChanges, fallbackIndex);
    fallbackIndex += 1;
  }
}

function ensureTableFormulaCell(row, valueCell, columnIndex) {
  const existing = row.querySelector(":scope > .sc-cae-formula-cell");
  if (existing) {
    return existing;
  }

  const cell = document.createElement("td");
  cell.className = "sc-cae-formula-cell";
  const referenceCell = row.children[columnIndex] ?? valueCell.nextElementSibling;
  if (referenceCell) {
    referenceCell.before(cell);
  } else {
    row.append(cell);
  }
  return cell;
}

function ensureListFormulaColumn(section, formulaChanges) {
  section.classList.add("sc-cae-formula-section");

  const header = section.querySelector("header");
  const valueHeader = header?.querySelector(".value");
  if (header && valueHeader && !header.querySelector(".sc-cae-formula-header")) {
    const headerCell = document.createElement("div");
    headerCell.className = "sc-cae-formula-header";
    headerCell.textContent = Constants.localize("SCConditionalAE.FormulaChange.Column", "Formula");
    headerCell.dataset.tooltip = Constants.localize(
      "SCConditionalAE.FormulaChange.ColumnHint",
      "Formula rolled when this Active Effect is activated."
    );
    headerCell.dataset.tooltipDirection = "UP";
    valueHeader.insertAdjacentElement("afterend", headerCell);
  }

  const valueInputs = getChangeValueInputs(section);
  for (let fallbackIndex = 0; fallbackIndex < valueInputs.length; fallbackIndex += 1) {
    const valueInput = valueInputs[fallbackIndex];
    const row = findChangeRow(section, valueInput, getChangeIndexFromName(valueInput.name));
    const valueCell = findListValueCell(valueInput, row);
    if (!row || !valueCell) {
      continue;
    }

    row.classList.add("sc-cae-formula-row");
    const formulaCell = ensureListFormulaCell(row, valueCell);
    updateFormulaInput(formulaCell, valueInput, row, formulaChanges, fallbackIndex);
  }
}

function ensureListFormulaCell(row, valueCell) {
  const existing = row.querySelector(":scope > .sc-cae-formula-column");
  if (existing) {
    return existing;
  }

  const cell = document.createElement("div");
  cell.className = "sc-cae-formula-column";
  valueCell.insertAdjacentElement("afterend", cell);
  return cell;
}

function updateFormulaInput(container, valueInput, row, formulaChanges, fallbackIndex) {
  const index = getChangeIndexFromName(valueInput.name) ?? String(fallbackIndex);
  if (index === undefined) {
    return;
  }

  const input = container.querySelector(".sc-cae-formula-input") ?? createFormulaInput(index);
  input.name = `${Constants.FORMULA_CHANGES_FLAG_PATH}.${index}.formula`;

  const formulaChange = formulaChanges[index];
  const formula = String(formulaChange?.formula ?? "");
  if (document.activeElement !== input && input.value !== formula) {
    input.value = formula;
  }

  if (!container.contains(input)) {
    container.append(input);
  }
}

function createFormulaInput(index) {
  const input = document.createElement("input");
  input.type = "text";
  input.className = "sc-cae-formula-input";
  input.name = `${Constants.FORMULA_CHANGES_FLAG_PATH}.${index}.formula`;
  input.placeholder = Constants.localize("SCConditionalAE.FormulaChange.Placeholder", "Optional formula");
  input.dataset.tooltip = Constants.localize(
    "SCConditionalAE.FormulaChange.ColumnHint",
    "Formula rolled when this Active Effect is activated."
  );
  input.dataset.tooltipDirection = "UP";
  return input;
}

function findChangeRow(root, input, index) {
  let node = input.parentElement;
  while (node && node !== root) {
    if (node.querySelector?.(CHANGE_KEY_INPUT_SELECTOR) && node.querySelector?.(CHANGE_PRIORITY_INPUT_SELECTOR)) {
      return node;
    }
    node = node.parentElement;
  }

  return input.closest("[data-index], .change, li, .form-group, tr");
}

function findListValueCell(input, row) {
  const cell = input.closest(".value");
  if (cell && cell !== row) {
    return cell;
  }

  return input.parentElement && input.parentElement !== row ? input.parentElement : null;
}

function getChangeKeyInput(row) {
  return row?.querySelector(CHANGE_KEY_INPUT_SELECTOR) ?? null;
}

function getChangeValueInputs(root) {
  return Array.from(root?.querySelectorAll?.(CHANGE_VALUE_INPUT_SELECTOR) ?? []);
}

function isChangeValueInput(input) {
  return input instanceof HTMLInputElement
    && /^changes(?:\.|\[)\d+(?:\.|\])/.test(input.name ?? "")
    && (String(input.name).endsWith(".value") || String(input.name).endsWith("[value]"));
}

function getChangeIndexFromName(name) {
  return String(name ?? "").match(/(?:^|\.)changes(?:\.|\[)(\d+)/)?.[1]
    ?? String(name ?? "").match(/^changes(?:\.|\[)(\d+)/)?.[1];
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
