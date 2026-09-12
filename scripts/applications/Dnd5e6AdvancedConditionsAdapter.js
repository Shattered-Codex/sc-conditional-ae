import { ApplicationRoot } from "../helpers/ApplicationRoot.js";
import { DaeCompatibility } from "../compat/DaeCompatibility.js";
import { ActiveEffectConditionService } from "../services/ActiveEffectConditionService.js";
import { ModuleSettings } from "../settings/ModuleSettings.js";
import { Dnd5e6AdvancedConditionsEditor } from "./Dnd5e6AdvancedConditionsEditor.js";
import { Dnd5e6ChangeConditionService } from "../services/Dnd5e6ChangeConditionService.js";

export class Dnd5e6AdvancedConditionsAdapter {
  static activate() {
    if (!Dnd5e6AdvancedConditionsAdapter.isSupported() || !ModuleSettings.isConditionTabEnabled()) return;
    Hooks.on("renderActiveEffectConfig", (app, html) => this.bind(app, html));
    Hooks.on("renderEffectChangeConfig", (app, html) => this.bind(app, html));
  }

  static isSupported() {
    return Dnd5e6ChangeConditionService.isSupported();
  }

  static bind(app, html = null) {
    if (!Dnd5e6AdvancedConditionsAdapter.isSupported() || !ModuleSettings.isConditionTabEnabled()) return;
    const root = ApplicationRoot.resolve(app, html);
    if (!root) return;
    for (const input of root.querySelectorAll("filters-input")) {
      if (input.dataset.scCaeAdvancedConditionsBound === "true") continue;
      input.dataset.scCaeAdvancedConditionsBound = "true";
      input.addEventListener("edit", event => this.#onEdit(event, app, input));
    }
  }

  static #onEdit(event, app, input) {
    const target = Dnd5e6AdvancedConditionsAdapter.#getTarget(app, input);
    if (!target) return;
    event.preventDefault();
    const advanced = this.#getAdvancedCondition(target.effect, target.changeId);
    const editor = new Dnd5e6AdvancedConditionsEditor({
      effect: target.effect,
      changeId: target.changeId,
      nativeValue: input.value,
      advancedValue: advanced.value,
      advancedMode: advanced.mode,
      onSave: values => this.#save(target.effect, target.changeId, input, values)
    });
    editor.render({ force: true, window: { windowId: input.ownerDocument?.defaultView?.id } });
  }

  static #getTarget(app, input) {
    const effect = app?.effect ?? app?.document;
    if (!(effect instanceof CONFIG.ActiveEffect.documentClass)) return null;
    const isChangeEditor = app?.constructor?.name === "EffectChangeConfig" || Boolean(app?.options?.changeId);
    if (isChangeEditor) {
      return app.options?.changeId ? { effect, changeId: app.options.changeId } : null;
    }
    if (input.name !== "system.conditions") return null;
    return { effect, changeId: null };
  }

  static #getAdvancedCondition(effect, changeId) {
    if (!changeId) {
      const condition = ActiveEffectConditionService.getCondition(effect);
      return {
        value: DaeCompatibility.toDisplayCondition(condition),
        mode: DaeCompatibility.getCompatibilityMode(condition)
      };
    }
    return {
      value: Dnd5e6ChangeConditionService.getCondition(effect, changeId),
      mode: null
    };
  }

  static async #save(effect, changeId, input, { nativeValue, advancedValue }) {
    if (!changeId) {
      const existingCondition = ActiveEffectConditionService.getCondition(effect);
      const update = { "system.conditions": nativeValue };
      DaeCompatibility.applyConditionSubmitData(
        update,
        advancedValue,
        DaeCompatibility.getCompatibilityMode(existingCondition)
      );
      await effect.update(update);
      return;
    }

    // The native change dialog owns all of the change fields. Mirror the
    // FiltersEditor contract by updating its input, then persist only our
    // independent flag so unsaved key/value/type edits remain untouched.
    input.value = nativeValue;
    await effect.update(Dnd5e6ChangeConditionService.buildUpdate(effect, changeId, advancedValue));
  }
}
