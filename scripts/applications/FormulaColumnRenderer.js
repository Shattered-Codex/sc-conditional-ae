import { Constants } from "../constants/Constants.js";
import { ActiveEffectFormulaChangeService } from "../services/ActiveEffectFormulaChangeService.js";
import { ModuleSettings } from "../settings/ModuleSettings.js";

const CHANGE_SECTION_SELECTOR = "section.changes, section[data-tab='changes'], section[data-tab='effects']";
const CHANGE_KEY_INPUT_SELECTOR = `[name*="changes"][name$=".key"], [name*="changes"][name$="[key]"]`;
const CHANGE_PRIORITY_INPUT_SELECTOR = `[name*="changes"][name$=".priority"], [name*="changes"][name$="[priority]"]`;
const CHANGE_VALUE_INPUT_SELECTOR = `[name*="changes"][name$=".value"], [name*="changes"][name$="[value]"]`;
const FORMULA_NODE_SELECTOR = ".sc-cae-formula-header, .sc-cae-formula-cell, .sc-cae-formula-column, .sc-cae-formula-input";

export class FormulaColumnRenderer {
  static #observers = new WeakMap();
  static #renderHookRegistered = false;

  static activateRenderHook() {
    if (FormulaColumnRenderer.#renderHookRegistered) {
      return;
    }

    FormulaColumnRenderer.#renderHookRegistered = true;
    Hooks.on("renderActiveEffectConfig", (app, html) => {
      if (app?.constructor?.SC_CONDITIONAL_AE_MIXED_SHEET) {
        return;
      }

      FormulaColumnRenderer.scheduleRender(app, html);
      FormulaColumnRenderer.activateObserver(app, html);
    });
  }

  static scheduleRender(sheet, rootOverride) {
    FormulaColumnRenderer.#render(sheet, rootOverride);
    requestAnimationFrame(() => FormulaColumnRenderer.#render(sheet, rootOverride));
  }

  static activateObserver(sheet, rootOverride) {
    const root = FormulaColumnRenderer.getSheetRoot(sheet, rootOverride);
    if (!root) {
      return;
    }

    const targets = FormulaColumnRenderer.#findObservedTargets(root);
    if (!targets.length) {
      FormulaColumnRenderer.deactivateObserver(sheet);
      return;
    }

    const current = FormulaColumnRenderer.#observers.get(sheet);
    if (
      current?.root === root
      && current.targets?.length === targets.length
      && current.targets.every((target, index) => target === targets[index])
    ) {
      return;
    }

    current?.observer?.disconnect();

    let queued = false;
    const queueRender = () => {
      if (queued) {
        return;
      }

      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        FormulaColumnRenderer.#render(sheet, root);
      });
    };

    const observer = new MutationObserver(mutations => {
      if (FormulaColumnRenderer.#shouldQueueRenderForMutations(mutations)) {
        queueRender();
      }
    });

    for (const target of targets) {
      observer.observe(target, { childList: true, subtree: true });
    }

    FormulaColumnRenderer.#observers.set(sheet, { observer, root, targets });
  }

  static deactivateObserver(sheet) {
    const controls = FormulaColumnRenderer.#observers.get(sheet);
    controls?.observer?.disconnect();
    FormulaColumnRenderer.#observers.delete(sheet);
  }

  static getSheetRoot(sheet, rootOverride) {
    if (rootOverride instanceof HTMLElement) {
      return rootOverride;
    }

    if (rootOverride?.[0] instanceof HTMLElement) {
      return rootOverride[0];
    }

    return sheet.element instanceof HTMLElement ? sheet.element : sheet.element?.[0] ?? null;
  }

  static #render(sheet, rootOverride) {
    if (!ModuleSettings.isFormulaChangesEnabled()) {
      return;
    }

    const root = FormulaColumnRenderer.getSheetRoot(sheet, rootOverride);
    if (!root) {
      return;
    }

    const formulaChanges = ActiveEffectFormulaChangeService.getFormulaChanges(sheet.document);
    FormulaColumnRenderer.#ensureColumnForAllRows(root, formulaChanges);
  }

  static #ensureColumnForAllRows(root, formulaChanges) {
    for (const table of root.querySelectorAll("table")) {
      FormulaColumnRenderer.#ensureTableColumn(table, formulaChanges);
    }

    for (const section of FormulaColumnRenderer.#findChangeSections(root)) {
      FormulaColumnRenderer.#ensureListColumn(section, formulaChanges);
    }
  }

  static #findChangeSections(root) {
    const sections = new Set();
    for (const input of FormulaColumnRenderer.#getChangeValueInputs(root)) {
      const row = FormulaColumnRenderer.#findChangeRow(
        root,
        input,
        FormulaColumnRenderer.#getChangeIndexFromName(input.name)
      );
      const section = row?.closest(CHANGE_SECTION_SELECTOR);
      if (section && !row.closest("table")) {
        sections.add(section);
      }
    }
    return sections;
  }

  static #ensureTableColumn(table, formulaChanges) {
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

      const formulaCell = FormulaColumnRenderer.#ensureTableFormulaCell(row, valueCell, columnIndex);
      FormulaColumnRenderer.#updateFormulaInput(formulaCell, valueInput, row, formulaChanges, fallbackIndex);
      fallbackIndex += 1;
    }
  }

  static #ensureTableFormulaCell(row, valueCell, columnIndex) {
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

  static #ensureListColumn(section, formulaChanges) {
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

    const valueInputs = FormulaColumnRenderer.#getChangeValueInputs(section);
    for (let fallbackIndex = 0; fallbackIndex < valueInputs.length; fallbackIndex += 1) {
      const valueInput = valueInputs[fallbackIndex];
      const row = FormulaColumnRenderer.#findChangeRow(
        section,
        valueInput,
        FormulaColumnRenderer.#getChangeIndexFromName(valueInput.name)
      );
      const valueCell = FormulaColumnRenderer.#findListValueCell(valueInput, row);
      if (!row || !valueCell) {
        continue;
      }

      row.classList.add("sc-cae-formula-row");
      const formulaCell = FormulaColumnRenderer.#ensureListFormulaCell(row, valueCell);
      FormulaColumnRenderer.#updateFormulaInput(formulaCell, valueInput, row, formulaChanges, fallbackIndex);
    }
  }

  static #ensureListFormulaCell(row, valueCell) {
    const existing = row.querySelector(":scope > .sc-cae-formula-column");
    if (existing) {
      return existing;
    }

    const cell = document.createElement("div");
    cell.className = "sc-cae-formula-column";
    valueCell.insertAdjacentElement("afterend", cell);
    return cell;
  }

  static #updateFormulaInput(container, valueInput, _row, formulaChanges, fallbackIndex) {
    const index = FormulaColumnRenderer.#getChangeIndexFromName(valueInput.name) ?? String(fallbackIndex);
    if (index === undefined) {
      return;
    }

    const input = container.querySelector(".sc-cae-formula-input") ?? FormulaColumnRenderer.#createFormulaInput(index);
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

  static #createFormulaInput(index) {
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

  static #findChangeRow(root, input, index) {
    let node = input.parentElement;
    while (node && node !== root) {
      if (node.querySelector?.(CHANGE_KEY_INPUT_SELECTOR) && node.querySelector?.(CHANGE_PRIORITY_INPUT_SELECTOR)) {
        return node;
      }
      node = node.parentElement;
    }

    return input.closest("[data-index], .change, li, .form-group, tr");
  }

  static #findListValueCell(input, row) {
    const directChild = Array.from(row?.children ?? []).find(child => child.contains(input));
    if (directChild) {
      return directChild;
    }

    const cell = input.closest(".value");
    if (cell && cell !== row) {
      return cell;
    }

    return input.parentElement && input.parentElement !== row ? input.parentElement : null;
  }

  static #getChangeValueInputs(root) {
    return Array.from(root?.querySelectorAll?.(CHANGE_VALUE_INPUT_SELECTOR) ?? []);
  }

  static #findObservedTargets(root) {
    return Array.from(root?.querySelectorAll?.(CHANGE_SECTION_SELECTOR) ?? [])
      .filter(section => (
        section instanceof HTMLElement
        && (section.querySelector("header .value") || section.querySelector("thead tr"))
      ));
  }

  static #shouldQueueRenderForMutations(mutations) {
    return mutations.some(mutation => {
      if (mutation.type !== "childList") {
        return false;
      }

      return [...mutation.addedNodes, ...mutation.removedNodes]
        .some(node => FormulaColumnRenderer.#isRelevantMutationNode(node));
    });
  }

  static #isRelevantMutationNode(node) {
    if (!(node instanceof Element)) {
      return false;
    }

    return !node.matches(FORMULA_NODE_SELECTOR);
  }

  static #isChangeValueInput(input) {
    return (input instanceof HTMLInputElement
      || input instanceof HTMLTextAreaElement
      || input instanceof HTMLSelectElement)
      && /^changes(?:\.|\[)\d+(?:\.|\])/.test(input.name ?? "")
      && (String(input.name).endsWith(".value") || String(input.name).endsWith("[value]"));
  }

  static #getChangeIndexFromName(name) {
    return String(name ?? "").match(/(?:^|\.)changes(?:\.|\[)(\d+)/)?.[1];
  }
}
