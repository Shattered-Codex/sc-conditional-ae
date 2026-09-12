import { ApplicationRoot } from "../helpers/ApplicationRoot.js";
import { Constants } from "../constants/Constants.js";
import { ActiveEffectFormulaChangeService } from "../services/ActiveEffectFormulaChangeService.js";
import { FormulaEditorDialog } from "./FormulaEditorDialog.js";
import { ModuleSettings } from "../settings/ModuleSettings.js";

const CHANGE_SECTION_SELECTOR = "section.changes, section[data-tab='changes'], section[data-tab='effects']";
const CHANGE_KEY_INPUT_SELECTOR = `[name*="changes"][name$=".key"], [name*="changes"][name$="[key]"]`;
const CHANGE_PRIORITY_INPUT_SELECTOR = `[name*="changes"][name$=".priority"], [name*="changes"][name$="[priority]"]`;
const CHANGE_VALUE_INPUT_SELECTOR = `[name*="changes"][name$=".value"], [name*="changes"][name$="[value]"]`;
const FORMULA_NODE_SELECTOR = [
  ".sc-cae-formula-header",
  ".sc-cae-formula-cell",
  ".sc-cae-formula-column",
  ".sc-cae-formula-input",
  ".sc-cae-formula-open",
  ".sc-cae-formula-expansion",
  ".sc-cae-formula-expansion-row",
  ".sc-cae-formula-single",
  ".sc-cae-formula-mode"
].join(", ");
const FORMULA_CONTAINER_SELECTOR = ".sc-cae-formula-cell, .sc-cae-formula-column";
const FORMULA_ROW_SELECTOR = "tr, .sc-cae-formula-row";

/**
 * Renders a change's formula in the Changes tab. Four treatments are offered:
 * `expand` puts a full-width field under the row, `popup` opens the dedicated
 * editor, `single` turns the change's own Value field into the formula field,
 * and `column` preserves the original always-visible formula column.
 */
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
    return ApplicationRoot.resolve(sheet, rootOverride);
  }

  static #render(sheet, rootOverride) {
    if (!ModuleSettings.isFormulaChangesEnabled()) {
      return;
    }

    const root = FormulaColumnRenderer.getSheetRoot(sheet, rootOverride);
    if (!root) {
      return;
    }

    const style = ModuleSettings.getFormulaFieldStyle();
    // Resolved by key, so a reordered change still shows its own formula rather
    // than whatever the stored position now points at.
    const formulaChanges = Object.fromEntries(
      ActiveEffectFormulaChangeService.getFormulaChangeEntries(sheet.document)
        .map(entry => [entry.index, { formula: entry.formula, key: entry.key }])
    );
    FormulaColumnRenderer.#ensureColumnForAllRows(root, formulaChanges, style);
    FormulaColumnRenderer.#activateDelegation(root, sheet);
  }

  static #ensureColumnForAllRows(root, formulaChanges, style) {
    for (const table of root.querySelectorAll("table")) {
      FormulaColumnRenderer.#ensureTableColumn(table, formulaChanges, style);
    }

    for (const section of FormulaColumnRenderer.#findChangeSections(root)) {
      FormulaColumnRenderer.#ensureListColumn(section, formulaChanges, style);
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

  static #ensureTableColumn(table, formulaChanges, style) {
    FormulaColumnRenderer.#cleanupTableExpansions(table, style);
    if (style !== "single") {
      FormulaColumnRenderer.#restoreSingleFields(table);
    }
    const rows = Array.from(table.querySelectorAll("tbody tr"));
    const firstValueInput = rows
      .map(row => row.querySelector(CHANGE_VALUE_INPUT_SELECTOR))
      .find(Boolean);
    const firstValueCell = firstValueInput?.closest("td");
    const firstRow = firstValueCell?.closest("tr");
    if (!firstValueCell || !firstRow) {
      return;
    }

    const usesOwnCell = style !== "single";
    const columnIndex = Array.from(firstRow.children).indexOf(firstValueCell) + 1;
    const headerRow = table.tHead?.rows?.[0] ?? table.querySelector("thead tr");
    const headerCell = headerRow?.querySelector(".sc-cae-formula-header");
    if (headerRow && usesOwnCell && !headerCell) {
      const cell = document.createElement("th");
      cell.className = "sc-cae-formula-header";
      FormulaColumnRenderer.#labelHeaderCell(cell, style);
      const referenceCell = headerRow.children[columnIndex];
      if (referenceCell) {
        referenceCell.before(cell);
      } else {
        headerRow.append(cell);
      }
    } else if (headerCell && !usesOwnCell) {
      headerCell.remove();
    } else if (headerCell) {
      FormulaColumnRenderer.#labelHeaderCell(headerCell, style);
    }

    let fallbackIndex = 0;
    for (const row of rows) {
      const valueInput = row.querySelector(CHANGE_VALUE_INPUT_SELECTOR);
      const valueCell = valueInput?.closest("td");
      if (!valueInput || !valueCell) {
        continue;
      }

      row.classList.add("sc-cae-formula-row");
      const container = usesOwnCell
        ? FormulaColumnRenderer.#ensureTableFormulaCell(row, valueCell, columnIndex)
        : FormulaColumnRenderer.#ensureSingleField(valueCell, valueInput);
      if (!usesOwnCell) {
        FormulaColumnRenderer.#removeObsoleteFormulaContainer(
          row.querySelector(":scope > .sc-cae-formula-cell"),
          container
        );
      }

      FormulaColumnRenderer.#updateFormulaField({
        container,
        valueInput,
        row,
        formulaChanges,
        fallbackIndex,
        style
      });
      fallbackIndex += 1;
    }
  }

  static #cleanupTableExpansions(table, style) {
    for (const expansionRow of table.querySelectorAll("tbody > tr.sc-cae-formula-expansion-row")) {
      if (style !== "expand") {
        expansionRow.remove();
        continue;
      }

      const expansion = expansionRow.querySelector(".sc-cae-formula-expansion");
      const owner = expansionRow.previousElementSibling;
      const ownerInput = owner?.querySelector?.(CHANGE_VALUE_INPUT_SELECTOR);
      const ownerIndex = FormulaColumnRenderer.#getChangeIndexFromName(ownerInput?.name);
      if (!ownerInput || expansion?.dataset.scCaeFormulaChangeIndex !== ownerIndex) {
        expansionRow.remove();
      }
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

  static #ensureListColumn(section, formulaChanges, style) {
    if (style !== "single") {
      FormulaColumnRenderer.#restoreSingleFields(section);
    }
    const usesOwnCell = style !== "single";
    section.classList.toggle("sc-cae-formula-section", usesOwnCell);
    for (const candidate of ModuleSettings.FORMULA_FIELD_STYLES) {
      section.classList.toggle(`sc-cae-formula-section--${candidate}`, candidate === style);
    }

    const header = section.querySelector("header");
    const valueHeader = header?.querySelector(".value");
    const headerCell = header?.querySelector(".sc-cae-formula-header");
    if (header && valueHeader && usesOwnCell && !headerCell) {
      const cell = document.createElement("div");
      cell.className = "sc-cae-formula-header";
      FormulaColumnRenderer.#labelHeaderCell(cell, style);
      valueHeader.insertAdjacentElement("afterend", cell);
    } else if (headerCell && !usesOwnCell) {
      headerCell.remove();
    } else if (headerCell) {
      FormulaColumnRenderer.#labelHeaderCell(headerCell, style);
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
      const container = usesOwnCell
        ? FormulaColumnRenderer.#ensureListFormulaCell(row, valueCell)
        : FormulaColumnRenderer.#ensureSingleField(valueCell, valueInput);
      if (!usesOwnCell) {
        FormulaColumnRenderer.#removeObsoleteFormulaContainer(
          row.querySelector(":scope > .sc-cae-formula-column"),
          container
        );
      }

      FormulaColumnRenderer.#updateFormulaField({
        container,
        valueInput,
        row,
        formulaChanges,
        fallbackIndex,
        style
      });
    }
  }

  static #removeObsoleteFormulaContainer(obsolete, destination) {
    if (!obsolete) {
      return;
    }

    const input = obsolete.querySelector(".sc-cae-formula-input");
    if (input && destination && !destination.contains(input)) {
      destination.append(input);
    }
    obsolete.remove();
  }

  static #restoreSingleFields(root) {
    for (const wrapper of root.querySelectorAll(".sc-cae-formula-single")) {
      const parent = wrapper.parentElement;
      const valueInput = wrapper.querySelector(CHANGE_VALUE_INPUT_SELECTOR);
      const formulaInput = wrapper.querySelector(".sc-cae-formula-input");
      if (valueInput) {
        valueInput.classList.remove("sc-cae-formula-value--hidden");
        wrapper.before(valueInput);
      }
      if (formulaInput) {
        wrapper.before(formulaInput);
      }
      wrapper.remove();
      parent?.classList.remove("sc-cae-formula-value-cell");
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

  /** 1c keeps the change's own Value cell and puts the mode switch inside it. */
  static #ensureSingleField(valueCell, valueInput) {
    const existing = valueInput.closest(".sc-cae-formula-single");
    if (existing) {
      return existing;
    }

    const wrapper = document.createElement("div");
    wrapper.className = "sc-cae-formula-single";
    valueInput.insertAdjacentElement("beforebegin", wrapper);
    wrapper.append(FormulaColumnRenderer.#createModeButton(), valueInput);
    valueCell.classList.add("sc-cae-formula-value-cell");
    return wrapper;
  }

  static #updateFormulaField({ container, valueInput, row, formulaChanges, fallbackIndex, style }) {
    const index = FormulaColumnRenderer.#getChangeIndexFromName(valueInput.name) ?? String(fallbackIndex);
    if (index === undefined) {
      return;
    }

    const stored = String(formulaChanges[index]?.formula ?? "");
    const input = FormulaColumnRenderer.#resolveFormulaInput(container, row, style);
    input.name = `${Constants.FORMULA_CHANGES_FLAG_PATH}.${index}.formula`;

    if (input.dataset.scCaeFormulaPending === "true") {
      if (input.value === stored) {
        delete input.dataset.scCaeFormulaPending;
      }
    } else if (document.activeElement !== input && input.value !== stored) {
      input.value = stored;
    }

    switch (style) {
      case "expand":
        FormulaColumnRenderer.#syncExpandField(container, row, input, index);
        return;
      case "single":
        FormulaColumnRenderer.#syncSingleField(container, valueInput, input);
        return;
      case "column":
        FormulaColumnRenderer.#syncColumnField(container, row, input);
        return;
      default:
        FormulaColumnRenderer.#syncPopupField(container, row, input);
    }
  }

  /**
   * The formula input lives in the cell for `popup`/`single` and inside the
   * expansion for `expand`, so it is looked up across the whole row.
   */
  static #resolveFormulaInput(container, row, style) {
    const existing = container.querySelector(".sc-cae-formula-input")
      ?? FormulaColumnRenderer.#findExpansion(row)?.querySelector(".sc-cae-formula-input")
      ?? row?.querySelector(".sc-cae-formula-input");
    const input = existing ?? FormulaColumnRenderer.#createFormulaInput();

    if (style === "expand") {
      return input;
    }

    if (!container.contains(input)) {
      container.append(input);
    }

    return input;
  }

  static #syncPopupField(container, row, input) {
    FormulaColumnRenderer.#removeExpansion(row);
    container.querySelector(".sc-cae-formula-mode")?.remove();
    input.type = "hidden";
    input.classList.remove("sc-cae-formula-input--visible");

    const button = container.querySelector(".sc-cae-formula-open")
      ?? FormulaColumnRenderer.#createPopupButton();
    if (!container.contains(button)) {
      container.append(button);
    }

    FormulaColumnRenderer.#syncTrigger(button, input.value);
  }

  /** The original treatment: the formula is always visible in its own labelled column. */
  static #syncColumnField(container, row, input) {
    FormulaColumnRenderer.#removeExpansion(row);
    container.querySelector(".sc-cae-formula-mode")?.remove();
    container.querySelector(".sc-cae-formula-open")?.remove();

    input.type = "text";
    input.classList.add("sc-cae-formula-input--visible");
    input.placeholder = Constants.localize("SCConditionalAE.FormulaChange.Placeholder", "Optional formula");
    input.dataset.tooltip = Constants.localize(
      "SCConditionalAE.FormulaChange.ColumnHint",
      "Formula rolled when this Active Effect is activated."
    );
  }

  static #syncExpandField(container, row, input, index) {
    container.querySelector(".sc-cae-formula-mode")?.remove();
    input.type = "text";
    input.classList.add("sc-cae-formula-input--visible");
    input.placeholder = Constants.localize("SCConditionalAE.FormulaChange.Placeholder", "Optional formula");

    const button = container.querySelector(".sc-cae-formula-open")
      ?? FormulaColumnRenderer.#createExpandButton();
    if (!container.contains(button)) {
      container.append(button);
    }

    const expansion = FormulaColumnRenderer.#ensureExpansion(row, input);
    expansion.dataset.scCaeFormulaChangeIndex = index;
    if (expansion.dataset.scCaeFormulaExpanded === undefined) {
      expansion.dataset.scCaeFormulaExpanded = String(input.value.length > 0);
    }

    FormulaColumnRenderer.#setExpanded(expansion, expansion.dataset.scCaeFormulaExpanded === "true");
    button.setAttribute("aria-expanded", expansion.dataset.scCaeFormulaExpanded);
    FormulaColumnRenderer.#syncTrigger(button, input.value);
  }

  static #ensureExpansion(row, input) {
    const existing = FormulaColumnRenderer.#findExpansion(row);
    if (existing) {
      if (!existing.contains(input)) {
        existing.querySelector(".sc-cae-formula-expansion__field")?.append(input);
      }
      return existing;
    }

    const expansion = document.createElement("div");
    expansion.className = "sc-cae-formula-expansion";

    const field = document.createElement("div");
    field.className = "sc-cae-formula-expansion__field";

    const label = document.createElement("label");
    label.className = "sc-cae-formula-expansion__label";
    label.textContent = Constants.localize("SCConditionalAE.FormulaChange.Column", "Formula");

    const close = document.createElement("button");
    close.type = "button";
    close.className = "sc-cae-formula-collapse";
    close.dataset.scCaeFormulaCollapse = "";
    close.innerHTML = '<i class="fa-solid fa-xmark"></i>';
    close.setAttribute("aria-label", Constants.localize("Cancel", "Cancel"));

    field.append(label, input);
    expansion.append(field, close);
    FormulaColumnRenderer.#attachExpansion(row, expansion);
    return expansion;
  }

  /** A table row cannot host a block child, so the expansion gets a spanning row of its own. */
  static #attachExpansion(row, expansion) {
    if (!row?.matches?.("tr")) {
      row.append(expansion);
      return;
    }

    const expansionRow = document.createElement("tr");
    expansionRow.className = "sc-cae-formula-expansion-row";
    const cell = document.createElement("td");
    cell.colSpan = row.children.length;
    cell.append(expansion);
    expansionRow.append(cell);
    row.after(expansionRow);
  }

  static #findExpansion(row) {
    if (!row) {
      return null;
    }

    if (row.matches?.("tr")) {
      const next = row.nextElementSibling;
      return next?.classList?.contains("sc-cae-formula-expansion-row")
        ? next.querySelector(".sc-cae-formula-expansion")
        : null;
    }

    return row.querySelector(":scope > .sc-cae-formula-expansion");
  }

  static #removeExpansion(row) {
    const expansion = FormulaColumnRenderer.#findExpansion(row);
    (expansion?.closest("tr.sc-cae-formula-expansion-row") ?? expansion)?.remove();
  }

  static #setExpanded(expansion, expanded) {
    expansion.dataset.scCaeFormulaExpanded = String(expanded);
    const host = expansion.closest("tr.sc-cae-formula-expansion-row") ?? expansion;
    host.hidden = !expanded;
  }

  static #syncSingleField(container, valueInput, input) {
    container.querySelector(".sc-cae-formula-expansion")?.remove();
    container.querySelector(".sc-cae-formula-open")?.remove();

    const button = container.querySelector(".sc-cae-formula-mode")
      ?? FormulaColumnRenderer.#createModeButton();
    if (!container.contains(button)) {
      container.prepend(button);
    }

    if (container.dataset.scCaeFormulaFieldMode === undefined) {
      container.dataset.scCaeFormulaFieldMode = input.value.length ? "formula" : "number";
    }

    const isFormula = container.dataset.scCaeFormulaFieldMode === "formula";
    input.type = isFormula ? "text" : "hidden";
    input.classList.toggle("sc-cae-formula-input--visible", isFormula);
    input.placeholder = Constants.localize("SCConditionalAE.FormulaChange.Placeholder", "Optional formula");
    valueInput.classList.toggle("sc-cae-formula-value--hidden", isFormula);

    button.innerHTML = isFormula
      ? '<i class="fa-solid fa-code"></i>'
      : '<i class="fa-solid fa-hashtag"></i>';
    button.classList.toggle("sc-cae-formula-mode--formula", isFormula);
    button.dataset.tooltip = Constants.localize(
      "SCConditionalAE.FormulaChange.ToggleValueMode",
      "Switch between a fixed value and a formula."
    );
    button.dataset.tooltipDirection = "UP";
    button.setAttribute("aria-label", button.dataset.tooltip);
  }

  /** Only the `column` treatment labels its column; the others need a bare spacer. */
  static #labelHeaderCell(headerCell, style) {
    const label = Constants.localize("SCConditionalAE.FormulaChange.Column", "Formula");
    const hint = Constants.localize(
      "SCConditionalAE.FormulaChange.ColumnHint",
      "Formula rolled when this Active Effect is activated."
    );
    headerCell.textContent = style === "column" ? label : "";
    headerCell.dataset.tooltip = `${label} — ${hint}`;
    headerCell.dataset.tooltipDirection = "UP";
    headerCell.setAttribute("aria-label", label);
  }

  static #createFormulaInput() {
    const input = document.createElement("input");
    input.className = "sc-cae-formula-input";
    input.dataset.tooltipDirection = "UP";
    return input;
  }

  static #createPopupButton() {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "sc-cae-formula-open sc-cae-formula-open--popup";
    button.dataset.scCaeFormulaOpen = "";
    button.dataset.tooltipDirection = "UP";
    button.textContent = Constants.localize("SCConditionalAE.FormulaChange.ColumnShort", "fx");
    return button;
  }

  static #createExpandButton() {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "sc-cae-formula-open sc-cae-formula-open--expand";
    button.dataset.scCaeFormulaExpand = "";
    button.dataset.tooltipDirection = "UP";
    button.setAttribute("aria-expanded", "false");
    button.innerHTML = '<i class="fa-solid fa-code"></i>';
    return button;
  }

  static #createModeButton() {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "sc-cae-formula-mode";
    button.dataset.scCaeFormulaMode = "";
    button.innerHTML = '<i class="fa-solid fa-hashtag"></i>';
    return button;
  }

  static #syncTrigger(button, formula) {
    const value = String(formula ?? "");
    const hasFormula = value.length > 0;
    button.classList.toggle("sc-cae-formula-open--set", hasFormula);
    button.dataset.tooltip = hasFormula
      ? value
      : Constants.localize(
        "SCConditionalAE.FormulaChange.ColumnHint",
        "Formula rolled when this Active Effect is activated."
      );
    button.setAttribute(
      "aria-label",
      Constants.localize("SCConditionalAE.FormulaChange.EditorOpen", "Edit formula")
    );
  }

  static #activateDelegation(root, sheet) {
    if (!root || root.dataset.scCaeFormulaEditorBound === "true") {
      return;
    }

    root.dataset.scCaeFormulaEditorBound = "true";
    root.addEventListener("click", event => {
      const target = event.target?.closest?.(
        "[data-sc-cae-formula-open], [data-sc-cae-formula-expand], [data-sc-cae-formula-collapse], [data-sc-cae-formula-mode]"
      );
      if (!target || !root.contains(target)) {
        return;
      }

      event.preventDefault();
      if (target.dataset.scCaeFormulaOpen !== undefined) {
        void FormulaColumnRenderer.#openEditor(target, sheet);
        return;
      }

      if (target.dataset.scCaeFormulaMode !== undefined) {
        FormulaColumnRenderer.#toggleMode(target);
        return;
      }

      FormulaColumnRenderer.#toggleExpansion(target);
    });

    root.addEventListener("input", event => {
      const input = event.target?.closest?.(".sc-cae-formula-input");
      if (!input) {
        return;
      }

      input.dataset.scCaeFormulaPending = "true";

      const row = FormulaColumnRenderer.#findExpansionOwner(input) ?? input.closest(FORMULA_ROW_SELECTOR);
      const trigger = row?.querySelector("[data-sc-cae-formula-expand], [data-sc-cae-formula-open]");
      if (trigger) {
        FormulaColumnRenderer.#syncTrigger(trigger, input.value);
      }
    });
  }

  static #toggleExpansion(trigger) {
    // Collapsing is triggered from inside the expansion, so its own row is one level up.
    const row = trigger.dataset.scCaeFormulaCollapse !== undefined
      ? FormulaColumnRenderer.#findExpansionOwner(trigger)
      : trigger.closest(FORMULA_ROW_SELECTOR);
    const expansion = FormulaColumnRenderer.#findExpansion(row);
    if (!expansion) {
      return;
    }

    const expanded = trigger.dataset.scCaeFormulaCollapse !== undefined
      ? false
      : expansion.dataset.scCaeFormulaExpanded !== "true";
    FormulaColumnRenderer.#setExpanded(expansion, expanded);

    const button = row.querySelector("[data-sc-cae-formula-expand]");
    button?.setAttribute("aria-expanded", String(expanded));
    if (expanded) {
      expansion.querySelector(".sc-cae-formula-input")?.focus();
    } else {
      button?.focus();
    }
  }

  static #findExpansionOwner(trigger) {
    const expansionRow = trigger.closest("tr.sc-cae-formula-expansion-row");
    if (expansionRow) {
      return expansionRow.previousElementSibling;
    }

    return trigger.closest(".sc-cae-formula-expansion")?.parentElement ?? null;
  }

  static #toggleMode(trigger) {
    const wrapper = trigger.closest(".sc-cae-formula-single");
    const input = wrapper?.querySelector(".sc-cae-formula-input");
    const valueInput = wrapper?.querySelector(CHANGE_VALUE_INPUT_SELECTOR);
    if (!wrapper || !input || !valueInput) {
      return;
    }

    const isFormula = wrapper.dataset.scCaeFormulaFieldMode !== "formula";
    wrapper.dataset.scCaeFormulaFieldMode = isFormula ? "formula" : "number";

    // Leaving formula mode drops the formula, so the change goes back to its own value.
    if (!isFormula && input.value.length) {
      input.value = "";
      input.dataset.scCaeFormulaPending = "true";
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }

    FormulaColumnRenderer.#syncSingleField(wrapper, valueInput, input);
    (isFormula ? input : valueInput).focus();
  }

  static async #openEditor(button, sheet) {
    const container = button.closest(FORMULA_CONTAINER_SELECTOR);
    const input = container?.querySelector(".sc-cae-formula-input");
    if (!input) {
      return;
    }

    const row = container.closest(FORMULA_ROW_SELECTOR) ?? container.parentElement;
    const inputName = input.name;
    const changeKey = row?.querySelector(CHANGE_KEY_INPUT_SELECTOR)?.value ?? "";
    const result = await FormulaEditorDialog.open({
      formula: input.value,
      changeKey,
      effectName: FormulaColumnRenderer.#getEffectName(button),
      actor: ActiveEffectFormulaChangeService.getActor(sheet?.document)
    });

    if (result === null || result === undefined) {
      return;
    }

    const currentRoot = FormulaColumnRenderer.getSheetRoot(sheet);
    FormulaColumnRenderer.#render(sheet, currentRoot);
    const currentInput = currentRoot?.querySelector?.(`.sc-cae-formula-input[name="${inputName}"]`);
    if (!currentInput || result === currentInput.value) {
      return;
    }

    currentInput.value = result;
    currentInput.dataset.scCaeFormulaPending = "true";
    const currentRow = FormulaColumnRenderer.#findExpansionOwner(currentInput)
      ?? currentInput.closest(FORMULA_ROW_SELECTOR);
    const currentTrigger = currentRow?.querySelector(
      "[data-sc-cae-formula-open], [data-sc-cae-formula-expand]"
    );
    if (currentTrigger) {
      FormulaColumnRenderer.#syncTrigger(currentTrigger, result);
    }
    currentInput.dispatchEvent(new Event("change", { bubbles: true }));
  }

  static #getEffectName(node) {
    return node.closest("form")?.querySelector("input[name='name']")?.value ?? "";
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

  static #getChangeIndexFromName(name) {
    return String(name ?? "").match(/(?:^|\.)changes(?:\.|\[)(\d+)/)?.[1];
  }
}
