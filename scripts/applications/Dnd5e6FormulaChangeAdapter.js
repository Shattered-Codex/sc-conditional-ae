import { ApplicationRoot } from "../helpers/ApplicationRoot.js";
import { Constants } from "../constants/Constants.js";
import { Dnd5e6ChangeConditionService } from "../services/Dnd5e6ChangeConditionService.js";
import { ActiveEffectFormulaChangeService } from "../services/ActiveEffectFormulaChangeService.js";
import { ModuleSettings } from "../settings/ModuleSettings.js";
import { FormulaEditorDialog } from "./FormulaEditorDialog.js";

/** Adds the formula control to dnd5e 6's per-change Application V2 dialog. */
export class Dnd5e6FormulaChangeAdapter {
  static #controlSequence = 0;

  static activate() {
    if (!Dnd5e6FormulaChangeAdapter.isSupported()) return;
    Hooks.on("renderEffectChangeConfig", (app, html) => this.bind(app, html));
  }

  static isSupported() {
    return Dnd5e6ChangeConditionService.isSupported()
      && ModuleSettings.isFormulaChangesEnabled();
  }

  static bind(app, html = null) {
    if (!Dnd5e6FormulaChangeAdapter.isSupported()) return;
    if (app?.constructor?.name !== "EffectChangeConfig" || !app?.options?.changeId) return;
    const root = ApplicationRoot.resolve(app, html);
    const valueInput = root?.querySelector?.("input[name='value']");
    const fieldset = valueInput?.closest?.("fieldset");
    if (!fieldset || fieldset.querySelector("[data-sc-cae-v6-formula]")) return;

    const index = Dnd5e6FormulaChangeAdapter.#getChangeIndex(app.effect, app.options.changeId);
    if (index < 0) return;
    const formula = ActiveEffectFormulaChangeService.getFormulaForChange(app.effect, index);
    const orphaned = ActiveEffectFormulaChangeService.getOrphanedFormulaChanges(app.effect);
    const group = Dnd5e6FormulaChangeAdapter.#buildControl(
      formula,
      app.isEditable !== false,
      orphaned,
      valueInput.ownerDocument
    );
    valueInput.closest(".form-group")?.insertAdjacentElement("afterend", group);
    if (!group.isConnected) fieldset.append(group);

    const input = group.querySelector("[data-sc-cae-v6-formula-input]");
    // The field is the primary editor now; the dialog is a second way in that
    // also carries the variable browser. Both persist through the same path.
    input?.addEventListener("input", () => Dnd5e6FormulaChangeAdapter.#markValidity(input));
    const editButton = group.querySelector("[data-sc-cae-v6-formula-edit]");
    let busy = false;
    const setBusy = active => {
      busy = active;
      if (input) input.disabled = active || app.isEditable === false;
      if (editButton) editButton.disabled = active || app.isEditable === false;
    };
    const persist = async value => {
      if (!input || busy) return false;
      const previous = ActiveEffectFormulaChangeService.getFormulaForChange(app.effect, app.options.changeId);
      setBusy(true);
      const saved = await Dnd5e6FormulaChangeAdapter.#save(
        app.effect,
        app.options.changeId,
        value,
        app.change?.key
      );
      input.value = saved
        ? ActiveEffectFormulaChangeService.getFormulaForChange(app.effect, app.options.changeId)
        : previous;
      Dnd5e6FormulaChangeAdapter.#markValidity(input);
      setBusy(false);
      return saved;
    };
    input?.addEventListener("change", async () => {
      Dnd5e6FormulaChangeAdapter.#markValidity(input);
      await persist(input.value);
    });
    // Enter in a lone text field submits the parent form, which would close the
    // change window on what reads as "confirm this field".
    input?.addEventListener("keydown", event => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      input.blur();
    });
    Dnd5e6FormulaChangeAdapter.#markValidity(input);

    editButton?.addEventListener("click", async event => {
      event.preventDefault();
      if (busy) return;
      setBusy(true);
      try {
        const result = await FormulaEditorDialog.open({
          formula: input?.value ?? "",
          changeKey: app.change?.key ?? "",
          effectName: app.effect?.name ?? "",
          actor: ActiveEffectFormulaChangeService.getActor(app.effect)
        });
        if (result === null || result === undefined) return;
        const previous = ActiveEffectFormulaChangeService.getFormulaForChange(app.effect, app.options.changeId);
        const saved = await Dnd5e6FormulaChangeAdapter.#save(
          app.effect,
          app.options.changeId,
          result,
          app.change?.key
        );
        input.value = saved
          ? ActiveEffectFormulaChangeService.getFormulaForChange(app.effect, app.options.changeId)
          : previous;
        Dnd5e6FormulaChangeAdapter.#markValidity(input);
      } finally {
        setBusy(false);
      }
    });
  }

  static #getChangeIndex(effect, changeId) {
    return Dnd5e6ChangeConditionService.getChanges(effect)
      .findIndex(change => Dnd5e6ChangeConditionService.getChangeId(change) === changeId);
  }

  /** Flag a formula Foundry could not parse, rather than failing at roll time. */
  static #markValidity(input) {
    if (!input) return;
    const formula = ActiveEffectFormulaChangeService.normalizeRollFormula(input.value ?? "");
    const invalid = Boolean(formula.trim())
      && typeof Roll?.validate === "function"
      && !Roll.validate(formula);
    input.classList.toggle("sc-cae-formula-invalid", invalid);
    input.dataset.tooltip = invalid
      ? Constants.localize("SCConditionalAE.FormulaChange.PreviewInvalid", "This formula is invalid.")
      : "";
  }

  static #buildControl(formula, editable, orphaned = [], ownerDocument = document) {
    const group = ownerDocument.createElement("div");
    group.className = "form-group sc-cae-v6-formula-change";
    group.dataset.scCaeV6Formula = "";

    const label = ownerDocument.createElement("label");
    label.textContent = Constants.localize("SCConditionalAE.FormulaChange.Column", "Formula");
    const fields = ownerDocument.createElement("div");
    fields.className = "form-fields";
    const input = ownerDocument.createElement("input");
    input.type = "text";
    input.id = `${Constants.MODULE_ID}-v6-formula-${++Dnd5e6FormulaChangeAdapter.#controlSequence}`;
    label.htmlFor = input.id;
    input.value = formula;
    input.disabled = !editable;
    input.dataset.scCaeV6FormulaInput = "";
    input.placeholder = Constants.localize("SCConditionalAE.FormulaChange.Placeholder", "Optional formula");
    const button = ownerDocument.createElement("button");
    button.type = "button";
    button.className = "icon fa-solid fa-square-root-variable";
    button.dataset.scCaeV6FormulaEdit = "";
    button.disabled = !editable;
    button.dataset.tooltip = Constants.localize(
      "SCConditionalAE.FormulaChange.EditorOpenHint",
      "Open the formula editor to browse the available variables."
    );
    button.setAttribute("aria-label", Constants.localize("SCConditionalAE.FormulaChange.EditorOpen", "Edit formula"));
    fields.append(input, button);
    group.append(label, fields);

    if (orphaned.length) {
      const warning = ownerDocument.createElement("p");
      warning.className = "hint sc-cae-formula-orphan-warning";
      warning.textContent = Constants.format(
        "SCConditionalAE.FormulaChange.OrphanedFormulaHint",
        { keys: orphaned.map(entry => entry.key || `#${entry.storedIndex}`).join(", ") },
        "Some formulas on this effect no longer match a change and will be skipped: {keys}."
      );
      group.append(warning);
    }

    return group;
  }

  static async #save(effect, changeId, formula, key) {
    const normalized = String(formula ?? "").trim();
    const currentIndex = Dnd5e6FormulaChangeAdapter.#getChangeIndex(effect, changeId);
    if (currentIndex < 0) {
      ui.notifications?.error?.(Constants.localize(
        "SCConditionalAE.FormulaChange.SaveFailed",
        "The formula could not be saved."
      ));
      return false;
    }
    // Write where the formula actually lives. Stable changeId resolution keeps
    // duplicate keys distinct even after the operations are reordered.
    const storageIndex = ActiveEffectFormulaChangeService.getFormulaStorageIndex(effect, currentIndex);
    // A flag object is merged, not replaced, so clearing a formula has to be an
    // explicit `-=index` deletion or the stored value comes straight back.
    const update = normalized
      ? {
        [`${Constants.FORMULA_CHANGES_FLAG_PATH}.${storageIndex}`]: {
          formula: normalized,
          key: String(key ?? ""),
          changeId: String(changeId ?? "")
        }
      }
      : { [`${Constants.FORMULA_CHANGES_FLAG_PATH}.-=${storageIndex}`]: null };

    try {
      await effect.update(update);
      return true;
    } catch (error) {
      console.warn(`[${Constants.MODULE_ID}] could not save dnd5e 6 formula change`, error);
      ui.notifications?.error?.(Constants.localize(
        "SCConditionalAE.FormulaChange.SaveFailed",
        "The formula could not be saved."
      ));
      return false;
    }
  }
}
