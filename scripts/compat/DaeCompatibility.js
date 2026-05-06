import { Constants } from "../constants/Constants.js";

export class DaeCompatibility {
  static #registered = false;

  static activate() {
    if (DaeCompatibility.#registered) {
      return;
    }

    DaeCompatibility.#registered = true;
    Hooks.on("dae.modifySpecials", DaeCompatibility.#onDaeModifySpecials);
  }

  static #onDaeModifySpecials(_actorType, specials) {
    const StringField = foundry.data.fields.StringField;
    specials[Constants.MACRO_EXECUTE_CHANGE_KEY] = [
      new StringField({
        label: Constants.localize("SCConditionalAE.MacroChange.Name", "Macro to Execute"),
        hint: Constants.localize(
          "SCConditionalAE.MacroChange.Description",
          "Execute a world macro when this Active Effect is applied or removed."
        )
      }),
      CONST.ACTIVE_EFFECT_MODES.CUSTOM
    ];
  }
}
