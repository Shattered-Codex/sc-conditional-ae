import { Constants } from "../constants/Constants.js";
import { HtmlHelpers } from "../helpers/HtmlHelpers.js";
import { RollDataVariableRegistry } from "../helpers/RollDataVariableRegistry.js";
import { ActiveEffectFormulaChangeService } from "../services/ActiveEffectFormulaChangeService.js";

const FORMULA_SELECTOR = "textarea[name='formula']";
const VARIABLE_SELECTOR = "[data-sc-cae-formula-variable]";
const MORE_SELECTOR = "[data-sc-cae-formula-more]";
const BROWSER_SELECTOR = "[data-sc-cae-formula-browser]";
const SEARCH_SELECTOR = "[data-sc-cae-formula-search]";
const BROWSER_EMPTY_SELECTOR = "[data-sc-cae-formula-browser-empty]";
const PREVIEW_SELECTOR = "[data-sc-cae-formula-preview]";
const PREVIEW_DEBOUNCE_MS = 220;

/**
 * The dedicated formula editor. A popup only earns the extra click by offering
 * what the row cannot: the actor's roll-data variables and a live result preview.
 */
export class FormulaEditorDialog {
  /**
   * Opens the editor.
   * Resolves with the new formula, or null when the dialog is dismissed.
   */
  static async open({ formula = "", changeKey = "", effectName = "", actor = null } = {}) {
    const variables = RollDataVariableRegistry.build(actor);
    const title = Constants.localize("SCConditionalAE.FormulaChange.EditorTitle", "Formula editor");

    return foundry.applications.api.DialogV2.wait({
      window: {
        title: changeKey ? `${title} — ${changeKey}` : title,
        icon: "fa-solid fa-square-root-variable"
      },
      classes: ["sc-cae-formula-editor"],
      position: { width: 560 },
      content: FormulaEditorDialog.buildContent({ formula, changeKey, effectName, variables }),
      render: (...args) => FormulaEditorDialog.activate(FormulaEditorDialog.#resolveRoot(args), variables),
      rejectClose: false,
      buttons: [
        {
          action: "save",
          icon: "fa-solid fa-floppy-disk",
          label: Constants.localize("SCConditionalAE.FormulaChange.EditorSave", "Save formula"),
          default: true,
          callback: (_event, _button, dialog) => (
            dialog.element?.querySelector(FORMULA_SELECTOR)?.value?.trim() ?? ""
          )
        },
        {
          action: "cancel",
          icon: "fa-solid fa-xmark",
          label: Constants.localize("Cancel", "Cancel"),
          callback: () => null
        }
      ]
    });
  }

  static buildContent({ formula = "", changeKey = "", effectName = "", variables = null } = {}) {
    const subtitle = [effectName, changeKey].filter(Boolean).map(HtmlHelpers.escape).join(" &rsaquo; ");
    const hint = Constants.localize(
      "SCConditionalAE.FormulaChange.EditorHint",
      "Formula rolled when this Active Effect is activated. Leave it blank to remove the formula."
    );
    const placeholder = Constants.localize("SCConditionalAE.FormulaChange.Placeholder", "Optional formula");
    const inputLabel = Constants.localize("SCConditionalAE.FormulaChange.EditorTitle", "Formula editor");

    return `
      ${subtitle ? `<p class="sc-cae-formula-editor__subtitle">${subtitle}</p>` : ""}
      <p class="hint sc-cae-formula-editor__hint">${HtmlHelpers.escape(hint)}</p>
      <textarea
        name="formula"
        class="sc-cae-formula-editor__input"
        rows="3"
        spellcheck="false"
        placeholder="${HtmlHelpers.escapeAttribute(placeholder)}"
        aria-label="${HtmlHelpers.escapeAttribute(inputLabel)}"
        autofocus
      >${HtmlHelpers.escape(String(formula ?? ""))}</textarea>
      ${FormulaEditorDialog.#buildVariables(variables)}
      <p class="sc-cae-formula-editor__preview" data-sc-cae-formula-preview role="status" aria-live="polite"></p>
    `;
  }

  static activate(root, variables) {
    const textarea = root?.querySelector?.(FORMULA_SELECTOR);
    if (!textarea || root.dataset.scCaeFormulaEditorBound === "true") {
      return;
    }

    root.dataset.scCaeFormulaEditorBound = "true";
    const rollData = variables?.rollData ?? {};
    let previewToken = 0;
    let previewTimer = null;

    const renderPreview = async () => {
      const token = (previewToken += 1);
      const preview = await FormulaEditorDialog.describe(textarea.value, rollData);
      if (token !== previewToken) {
        return;
      }

      const node = root.querySelector(PREVIEW_SELECTOR);
      if (!node) {
        return;
      }

      node.textContent = preview.text;
      node.dataset.state = preview.state;
    };

    const queuePreview = () => {
      window.clearTimeout(previewTimer);
      previewTimer = window.setTimeout(() => void renderPreview(), PREVIEW_DEBOUNCE_MS);
    };

    textarea.addEventListener("input", queuePreview);
    void renderPreview();

    root.addEventListener("click", event => {
      const variable = event.target?.closest?.(VARIABLE_SELECTOR);
      if (variable) {
        event.preventDefault();
        window.clearTimeout(previewTimer);
        FormulaEditorDialog.insertAtCursor(textarea, variable.dataset.scCaeFormulaVariable);
        void renderPreview();
        return;
      }

      const more = event.target?.closest?.(MORE_SELECTOR);
      if (!more) {
        return;
      }

      event.preventDefault();
      const browser = root.querySelector(BROWSER_SELECTOR);
      if (!browser) {
        return;
      }

      browser.hidden = !browser.hidden;
      more.setAttribute("aria-expanded", String(!browser.hidden));
      if (!browser.hidden) {
        browser.querySelector(SEARCH_SELECTOR)?.focus();
      }
    });

    root.querySelector(SEARCH_SELECTOR)?.addEventListener("input", event => {
      FormulaEditorDialog.#filter(root, event.target.value);
    });
  }

  /** Reports what a formula resolves to on the actor it will actually roll against. */
  static async describe(formula, rollData) {
    const raw = String(formula ?? "").trim();
    if (!raw.length) {
      return {
        state: "empty",
        text: Constants.localize(
          "SCConditionalAE.FormulaChange.PreviewEmpty",
          "No formula. This change keeps its own value."
        )
      };
    }

    const normalized = ActiveEffectFormulaChangeService.normalizeRollFormula(raw);
    const invalid = Constants.localize("SCConditionalAE.FormulaChange.PreviewInvalid", "This formula is invalid.");
    if (typeof Roll?.validate === "function" && !Roll.validate(normalized)) {
      return { state: "invalid", text: invalid };
    }

    try {
      const minimum = await new Roll(normalized, rollData).evaluate({ minimize: true });
      const maximum = await new Roll(normalized, rollData).evaluate({ maximize: true });
      if (minimum.total === maximum.total) {
        return {
          state: "ok",
          text: FormulaEditorDialog.#format(
            "SCConditionalAE.FormulaChange.PreviewResult",
            "Result on this actor: {value}",
            { value: minimum.total }
          )
        };
      }

      return {
        state: "ok",
        text: FormulaEditorDialog.#format(
          "SCConditionalAE.FormulaChange.PreviewRange",
          "Result on this actor: {minimum} to {maximum}",
          { minimum: minimum.total, maximum: maximum.total }
        )
      };
    } catch (error) {
      return { state: "invalid", text: error?.message ? `${invalid} ${error.message}` : invalid };
    }
  }

  static insertAtCursor(textarea, token) {
    if (!textarea || !token) {
      return;
    }

    const value = String(textarea.value ?? "");
    const start = textarea.selectionStart ?? value.length;
    const end = textarea.selectionEnd ?? start;
    const before = value.slice(0, start);
    const insertion = before.length && !/[\s(+\-*/,]$/.test(before) ? ` ${token}` : token;

    textarea.value = `${before}${insertion}${value.slice(end)}`;
    const cursor = start + insertion.length;
    textarea.setSelectionRange?.(cursor, cursor);
    textarea.focus();
  }

  static #buildVariables(variables) {
    const suggested = variables?.suggested ?? [];
    const all = variables?.all ?? [];
    if (!all.length) {
      return `<p class="hint sc-cae-formula-editor__note">${HtmlHelpers.escape(Constants.localize(
        "SCConditionalAE.FormulaChange.PreviewNoActor",
        "This Active Effect has no actor yet, so roll data is unavailable here."
      ))}</p>`;
    }

    const more = Constants.localize("SCConditionalAE.FormulaChange.EditorShowAllVariables", "see all");
    const search = Constants.localize("SCConditionalAE.FormulaChange.EditorFilterVariables", "Filter...");
    const empty = Constants.localize("SCConditionalAE.FormulaChange.EditorNoVariable", "No variable matches this search.");

    return `
      <div class="sc-cae-formula-editor__variables">
        ${suggested.map(variable => FormulaEditorDialog.#buildChip(variable)).join("")}
        <button
          type="button"
          class="sc-cae-formula-editor__more"
          data-sc-cae-formula-more
          aria-expanded="false"
        >+ ${HtmlHelpers.escape(more)}</button>
      </div>
      <div class="sc-cae-formula-editor__browser" data-sc-cae-formula-browser hidden>
        <input
          type="text"
          class="sc-cae-formula-editor__search"
          data-sc-cae-formula-search
          placeholder="${HtmlHelpers.escapeAttribute(search)}"
          spellcheck="false"
          autocomplete="off"
        >
        <div class="sc-cae-formula-editor__browser-list">
          ${all.map(variable => FormulaEditorDialog.#buildChip(variable)).join("")}
        </div>
        <p class="hint sc-cae-formula-editor__browser-empty" data-sc-cae-formula-browser-empty hidden>
          ${HtmlHelpers.escape(empty)}
        </p>
      </div>
    `;
  }

  static #buildChip(variable) {
    const name = HtmlHelpers.escapeAttribute(variable.name);
    return `<button
      type="button"
      class="sc-cae-formula-editor__chip"
      data-sc-cae-formula-variable="${name}"
      data-tooltip="${name} = ${HtmlHelpers.escapeAttribute(variable.value)}"
    >${HtmlHelpers.escape(variable.name)}</button>`;
  }

  static #filter(root, query) {
    const normalized = String(query ?? "").trim().toLowerCase();
    const chips = root.querySelectorAll(`${BROWSER_SELECTOR} ${VARIABLE_SELECTOR}`);
    let visible = 0;

    for (const chip of chips) {
      const matches = !normalized.length
        || String(chip.dataset.scCaeFormulaVariable ?? "").toLowerCase().includes(normalized);
      chip.hidden = !matches;
      if (matches) {
        visible += 1;
      }
    }

    const empty = root.querySelector(BROWSER_EMPTY_SELECTOR);
    if (empty) {
      empty.hidden = visible > 0;
    }
  }

  static #format(key, fallback, data) {
    if (typeof game?.i18n?.format === "function") {
      const localized = game.i18n.format(key, data);
      if (localized && localized !== key) {
        return localized;
      }
    }

    return Object.entries(data).reduce(
      (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
      fallback
    );
  }

  // DialogV2 render callbacks differ across Foundry versions; find the element either way.
  static #resolveRoot(args) {
    for (const arg of args) {
      if (arg instanceof HTMLElement) {
        return arg;
      }

      if (arg?.element instanceof HTMLElement) {
        return arg.element;
      }
    }

    return null;
  }
}
