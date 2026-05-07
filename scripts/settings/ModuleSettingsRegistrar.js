import { Constants } from "../constants/Constants.js";
import { DocumentationMenu } from "./DocumentationMenu.js";
import { ModuleSettings } from "./ModuleSettings.js";
import { SupportMenu } from "./SupportMenu.js";

export class ModuleSettingsRegistrar {
  static #registered = false;

  static register() {
    if (ModuleSettingsRegistrar.#registered) {
      return;
    }
    ModuleSettingsRegistrar.#registered = true;

    ModuleSettingsRegistrar.#registerFormulaSetting();
    ModuleSettingsRegistrar.#registerConditionTabSetting();
    ModuleSettingsRegistrar.#registerSupportMenu();
    ModuleSettingsRegistrar.#registerDocumentationMenu();
  }

  static #registerFormulaSetting() {
    game.settings.register(Constants.MODULE_ID, ModuleSettings.SETTING_ENABLE_FORMULA_CHANGES, {
      name: Constants.localize("SCConditionalAE.Settings.EnableFormulaChanges.Name", "Enable formula column"),
      hint: Constants.localize(
        "SCConditionalAE.Settings.EnableFormulaChanges.Hint",
        "Adds the Formula column to Active Effect changes and rolls formulas when effects are activated."
      ),
      scope: "world",
      config: true,
      type: Boolean,
      default: true,
      requiresReload: true
    });
  }

  static #registerConditionTabSetting() {
    game.settings.register(Constants.MODULE_ID, ModuleSettings.SETTING_SHOW_CONDITION_TAB, {
      name: Constants.localize("SCConditionalAE.Settings.ShowConditionTab.Name", "Show condition tab"),
      hint: Constants.localize(
        "SCConditionalAE.Settings.ShowConditionTab.Hint",
        "Adds the Condition tab to Active Effect configuration sheets."
      ),
      scope: "world",
      config: true,
      type: Boolean,
      default: true,
      requiresReload: true
    });
  }

  static #registerSupportMenu() {
    game.settings.registerMenu(Constants.MODULE_ID, ModuleSettings.SETTING_SUPPORT_MENU, {
      name: Constants.localize("SCConditionalAE.Settings.SupportMenu.Name", "Support the developer"),
      label: Constants.localize("SCConditionalAE.Settings.SupportMenu.Label", "Patreon support"),
      hint: Constants.localize(
        "SCConditionalAE.Settings.SupportMenu.Hint",
        "Support Shattered Codex development on Patreon."
      ),
      icon: "fas fa-heart",
      type: SupportMenu,
      restricted: true
    });

    Hooks.on("renderSettingsConfig", (_app, html) => {
      SupportMenu.bindSettingsButton(html);
    });
  }

  static #registerDocumentationMenu() {
    game.settings.registerMenu(Constants.MODULE_ID, ModuleSettings.SETTING_DOCUMENTATION_MENU, {
      name: Constants.localize("SCConditionalAE.Settings.DocumentationMenu.Name", "Documentation"),
      label: Constants.localize("SCConditionalAE.Settings.DocumentationMenu.Label", "Open wiki"),
      hint: Constants.localize(
        "SCConditionalAE.Settings.DocumentationMenu.Hint",
        "Open the SC - Conditional AE documentation wiki."
      ),
      icon: "fas fa-hat-wizard",
      type: DocumentationMenu,
      restricted: true
    });

    Hooks.on("renderSettingsConfig", (_app, html) => {
      DocumentationMenu.bindSettingsButton(html);
    });
  }
}
