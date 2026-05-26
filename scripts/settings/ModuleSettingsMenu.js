import { Constants } from "../constants/Constants.js";
import { ModuleSettingsApp } from "./ModuleSettingsApp.js";

const { ApplicationV2 } = foundry?.applications?.api ?? {};
if (!ApplicationV2) {
  throw new Error(`${Constants.MODULE_ID}: ApplicationV2 is required to render ModuleSettingsMenu.`);
}

export class ModuleSettingsMenu extends ApplicationV2 {
  static DEFAULT_OPTIONS = foundry.utils.mergeObject(super.DEFAULT_OPTIONS, {
    id: `${Constants.MODULE_ID}-settings-menu`,
    window: {
      title: Constants.localize("SCConditionalAE.Settings.ModuleSettingsMenu.Name", "Module settings"),
      resizable: false,
      icon: "fas fa-sliders"
    },
    position: {
      width: 420,
      height: "auto"
    }
  }, { inplace: false });

  render(..._args) {
    new ModuleSettingsApp().render(true);
    return this;
  }
}
