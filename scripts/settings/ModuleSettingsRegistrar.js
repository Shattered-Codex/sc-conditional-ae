import { Constants } from "../constants/Constants.js";
import { CommunityLinks } from "./CommunityLinks.js";
import { ModuleSettings } from "./ModuleSettings.js";
import { ModuleSettingsMenu } from "./ModuleSettingsMenu.js";
import { SettingsHelpers } from "../helpers/SettingsHelpers.js";

export class ModuleSettingsRegistrar {
  static #registered = false;

  static register() {
    if (ModuleSettingsRegistrar.#registered) {
      return;
    }
    ModuleSettingsRegistrar.#registered = true;

    ModuleSettingsRegistrar.#registerFormulaSetting();
    ModuleSettingsRegistrar.#registerFormulaFieldStyleSetting();
    ModuleSettingsRegistrar.#registerFormulaChatCardSetting();
    ModuleSettingsRegistrar.#registerConditionTabSetting();
    ModuleSettingsRegistrar.#registerEffectIconTintSetting();
    ModuleSettingsRegistrar.#registerDebugSetting();
    ModuleSettingsRegistrar.#registerModuleSettingsMenu();

    Hooks.on("renderSettingsConfig", (_app, html) => {
      ModuleSettingsRegistrar.#injectMainSettingsWarning(html);
      CommunityLinks.inject(html);
    });
  }

  static #registerModuleSettingsMenu() {
    game.settings.registerMenu(Constants.MODULE_ID, ModuleSettings.SETTING_MODULE_SETTINGS_MENU, {
      name: Constants.localize("SCConditionalAE.Settings.ModuleSettingsMenu.Name", "Module settings"),
      label: Constants.localize("SCConditionalAE.Settings.ModuleSettingsMenu.Label", "Open settings"),
      hint: Constants.localize(
        "SCConditionalAE.Settings.ModuleSettingsMenu.Hint",
        "Open the SC - Conditional AE configuration window."
      ),
      icon: "fas fa-sliders",
      type: ModuleSettingsMenu,
      restricted: false
    });
  }

  static #registerFormulaSetting() {
    game.settings.register(Constants.MODULE_ID, ModuleSettings.SETTING_ENABLE_FORMULA_CHANGES, {
      name: Constants.localize("SCConditionalAE.Settings.EnableFormulaChanges.Name", "Enable formula fields"),
      hint: Constants.localize(
        "SCConditionalAE.Settings.EnableFormulaChanges.Hint",
        "Adds formula fields to Active Effect changes and rolls formulas when effects are activated."
      ),
      scope: "world",
      config: false,
      type: Boolean,
      default: true,
      requiresReload: true
    });
  }

  static #registerFormulaFieldStyleSetting() {
    game.settings.register(Constants.MODULE_ID, ModuleSettings.SETTING_FORMULA_FIELD_STYLE, {
      name: Constants.localize("SCConditionalAE.Settings.FormulaFieldStyle.Name", "Formula field style"),
      hint: Constants.localize(
        "SCConditionalAE.Settings.FormulaFieldStyle.Hint",
        "How a change's formula is edited in the Changes tab."
      ),
      scope: "client",
      config: false,
      type: String,
      choices: {
        expand: Constants.localize(
          "SCConditionalAE.Settings.FormulaFieldStyle.Expand",
          "Expanding row — full-width field under the change"
        ),
        popup: Constants.localize(
          "SCConditionalAE.Settings.FormulaFieldStyle.Popup",
          "Popup — dedicated editor with variables and preview"
        ),
        single: Constants.localize(
          "SCConditionalAE.Settings.FormulaFieldStyle.Single",
          "Single field — the Value field switches to a formula"
        ),
        column: Constants.localize(
          "SCConditionalAE.Settings.FormulaFieldStyle.Column",
          "Formula column — a labelled column always in view"
        )
      },
      default: "expand"
    });
  }

  static #registerFormulaChatCardSetting() {
    game.settings.register(Constants.MODULE_ID, ModuleSettings.SETTING_USE_FORMULA_CHAT_CARD, {
      name: Constants.localize("SCConditionalAE.Settings.UseFormulaChatCard.Name", "Post formula roll chat card"),
      hint: Constants.localize(
        "SCConditionalAE.Settings.UseFormulaChatCard.Hint",
        "When a conditional effect becomes available or a formula-backed Active Effect is activated, post a chat card with a roll button instead of rolling immediately."
      ),
      scope: "world",
      config: false,
      type: Boolean,
      default: false
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
      config: false,
      type: Boolean,
      default: true,
      requiresReload: true
    });
  }

  static #registerEffectIconTintSetting() {
    game.settings.register(Constants.MODULE_ID, ModuleSettings.SETTING_TINT_EFFECT_ICONS, {
      name: Constants.localize("SCConditionalAE.Settings.TintEffectIcons.Name", "Tint effect icons"),
      hint: Constants.localize(
        "SCConditionalAE.Settings.TintEffectIcons.Hint",
        "Paints each Active Effect's Icon Tint Color onto its icon in effect lists."
      ),
      scope: "world",
      config: false,
      type: Boolean,
      default: false
    });
  }

  static #registerDebugSetting() {
    game.settings.register(Constants.MODULE_ID, ModuleSettings.SETTING_DEBUG_LOGGING, {
      name: Constants.localize("SCConditionalAE.Settings.DebugLogging.Name", "Enable debug logging"),
      hint: Constants.localize(
        "SCConditionalAE.Settings.DebugLogging.Hint",
        "Logs condition evaluation, suppression refreshes, and activation transitions to the browser console."
      ),
      scope: "client",
      config: false,
      type: Boolean,
      default: false
    });
  }

  static #injectMainSettingsWarning(html) {
    if (!Constants.isDaeActive()) {
      return;
    }

    const root = SettingsHelpers.resolveRoot(html);
    if (!root || root.querySelector("[data-sc-cae-main-notice='true']")) {
      return;
    }

    const settingKeys = [`${Constants.MODULE_ID}.${ModuleSettings.SETTING_MODULE_SETTINGS_MENU}`];

    const lastRow = settingKeys
      .map(key => root.querySelector(
        `[data-setting-id="${key}"], [data-menu-id="${key}"], [data-key="${key}"], [data-setting="${key}"]`
      ))
      .map(element => ModuleSettingsRegistrar.#resolveSettingsBlock(element))
      .filter(Boolean)
      .at(-1);

    if (!(lastRow instanceof Element)) {
      return;
    }

    const notice = document.createElement("p");
    notice.className = "sc-cae-settings-menu-notice";
    notice.dataset.scCaeMainNotice = "true";
    notice.innerHTML = [
      `<i class="fas fa-triangle-exclamation"></i>`,
      `<span>`,
      `<strong>${Constants.localize("SCConditionalAE.Settings.App.DaeWarningTitle", "DAE compatibility warning")}.</strong> `,
      `${Constants.localize("SCConditionalAE.Settings.App.DaeWarning", "This libWrapper message is only a warning.")}`,
      `</span>`
    ].join("");

    lastRow.insertAdjacentElement("afterend", notice);
  }

  static #resolveSettingsBlock(element) {
    if (!(element instanceof Element)) {
      return null;
    }

    const formGroup = element.matches(".form-group")
      ? element
      : element.closest(".form-group");

    if (!(formGroup instanceof Element)) {
      return element;
    }

    const notes = formGroup.nextElementSibling;
    if (notes instanceof Element && notes.matches(".notes")) {
      return notes;
    }

    return formGroup;
  }
}
