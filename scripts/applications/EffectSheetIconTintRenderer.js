import { ApplicationRoot } from "../helpers/ApplicationRoot.js";
import { EffectIconTint } from "../helpers/EffectIconTint.js";
import { ModuleSettings } from "../settings/ModuleSettings.js";

/**
 * Paints the Icon Tint Color onto the effect's own portrait in its config sheet.
 *
 * The sheet is where the colour is chosen, so it repaints while the field
 * changes rather than only on the next render — otherwise picking a colour
 * shows nothing until the sheet is reopened.
 */
export class EffectSheetIconTintRenderer {
  static activate() {
    Hooks.on("renderActiveEffectConfig", (app, html) => EffectSheetIconTintRenderer.render(app, html));
  }

  static render(app, html = null) {
    const effect = app?.document ?? app?.effect ?? null;
    const root = ApplicationRoot.resolve(app, html);
    if (!effect || !root) {
      return;
    }

    EffectSheetIconTintRenderer.#paint(root, effect.tint);

    const field = root.querySelector("[name='tint']");
    if (!field || field.dataset.scCaeTintBound === "true") {
      return;
    }

    field.dataset.scCaeTintBound = "true";
    for (const type of ["input", "change"]) {
      field.addEventListener(type, () => EffectSheetIconTintRenderer.#paint(root, field.value));
    }
  }

  static #paint(root, tint) {
    const icon = root.querySelector(".sheet-header .document-image, .sheet-header img");
    const resolved = ModuleSettings.isEffectIconTintEnabled() ? EffectIconTint.resolve({ tint }) : null;
    EffectIconTint.paint(icon, resolved);
  }
}
