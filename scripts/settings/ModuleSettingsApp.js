import { Constants } from "../constants/Constants.js";
import { ModuleSettings } from "./ModuleSettings.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry?.applications?.api ?? {};
if (!ApplicationV2 || !HandlebarsApplicationMixin) {
  throw new Error(`${Constants.MODULE_ID}: ApplicationV2 with HandlebarsApplicationMixin is required to render ModuleSettingsApp.`);
}

export class ModuleSettingsApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = foundry.utils.mergeObject(super.DEFAULT_OPTIONS, {
    id: `${Constants.MODULE_ID}-settings-app`,
    classes: ["sc-cae-settings-app"],
    tag: "form",
    // A fixed box, as SocketsConfigApp uses. With "auto" the rail's own height
    // decided the window's, so a short panel left everything cramped.
    position: {
      width: 900,
      height: 640
    },
    window: {
      title: Constants.localize("SCConditionalAE.Settings.App.Title", "SC - Conditional AE Settings"),
      resizable: true,
      contentClasses: ["sc-cae-settings-app"]
    }
  }, { inplace: false });

  static PARTS = {
    main: {
      template: `modules/${Constants.MODULE_ID}/templates/module-settings.hbs`
    }
  };

  async _prepareContext(_options) {
    const canEditWorldSettings = game.user?.isGM === true;

    return {
      header: {
        title: Constants.localize("SCConditionalAE.Settings.App.Title", "SC - Conditional AE Settings"),
        intro: Constants.localize(
          "SCConditionalAE.Settings.App.Intro",
          "Configure conditional Active Effect behavior, formula support, and module diagnostics."
        )
      },
      sections: [
        {
          id: "behavior",
          icon: "fa-wand-magic-sparkles",
          title: Constants.localize("SCConditionalAE.Settings.App.WorldSection.Title", "Effect behavior"),
          description: Constants.localize(
            "SCConditionalAE.Settings.App.WorldSection.Description",
            "World-level settings that control condition tabs, formula changes, and chat-card behavior."
          ),
          permissionNote: canEditWorldSettings
            ? null
            : Constants.localize(
              "SCConditionalAE.Settings.App.WorldSection.PermissionNote",
              "Only a GM can change the settings in this section."
            ),
          fields: [
            ModuleSettingsApp.#createCheckboxField(
              ModuleSettings.SETTING_ENABLE_FORMULA_CHANGES,
              ModuleSettings.isFormulaChangesEnabled(),
              !canEditWorldSettings
            ),
            ModuleSettingsApp.#createCheckboxField(
              ModuleSettings.SETTING_USE_FORMULA_CHAT_CARD,
              ModuleSettings.isFormulaChatCardEnabled(),
              !canEditWorldSettings
            ),
            ModuleSettingsApp.#createCheckboxField(
              ModuleSettings.SETTING_SHOW_CONDITION_TAB,
              ModuleSettings.isConditionTabEnabled(),
              !canEditWorldSettings
            )
          ]
        },
        {
          id: "interface",
          icon: "fa-sliders",
          title: Constants.localize("SCConditionalAE.Settings.App.InterfaceSection.Title", "Interface"),
          description: Constants.localize(
            "SCConditionalAE.Settings.App.InterfaceSection.Description",
            "Personal display preferences for the Active Effect sheet. These apply only to you."
          ),
          permissionNote: null,
          fields: [
            ModuleSettingsApp.#createSelectField(
              ModuleSettings.SETTING_FORMULA_FIELD_STYLE,
              ModuleSettings.getFormulaFieldStyle(),
              ModuleSettings.FORMULA_FIELD_STYLES,
              false
            ),
            ModuleSettingsApp.#createCheckboxField(
              ModuleSettings.SETTING_TINT_EFFECT_ICONS,
              ModuleSettings.isEffectIconTintEnabled(),
              !canEditWorldSettings
            )
          ]
        },
        {
          id: "diagnostics",
          icon: "fa-stethoscope",
          notice: Constants.isDaeActive() ? {
            title: Constants.localize("SCConditionalAE.Settings.App.DaeWarningTitle", "DAE compatibility warning"),
            text: Constants.localize(
              "SCConditionalAE.Settings.App.DaeWarning",
              "This libWrapper message is only a warning. When DAE is active, both modules touch the same Active Effect pipeline, so the browser console may report a potential conflict even when behavior is working normally."
            )
          } : null,
          title: Constants.localize("SCConditionalAE.Settings.App.ClientSection.Title", "Diagnostics"),
          description: Constants.localize(
            "SCConditionalAE.Settings.App.ClientSection.Description",
            "Client-side settings for troubleshooting and local browser logging."
          ),
          permissionNote: null,
          fields: [
            ModuleSettingsApp.#createCheckboxField(
              ModuleSettings.SETTING_DEBUG_LOGGING,
              ModuleSettings.isDebugLoggingEnabled(),
              false
            )
          ]
        }
      ],
      strings: {
        save: Constants.localize("SCConditionalAE.Settings.App.Save", "Save"),
        cancel: Constants.localize("SCConditionalAE.Settings.App.Cancel", "Cancel")
      }
    };
  }

  async _onRender(context, options) {
    await super._onRender(context, options);

    const form = this.element;
    if (!(form instanceof HTMLFormElement) || form.dataset.scCaeSettingsBound === "true") {
      return;
    }

    form.dataset.scCaeSettingsBound = "true";
    form.addEventListener("submit", event => {
      event.preventDefault();
      void this.#save(form);
    });

    form.querySelector("[data-action='cancel']")?.addEventListener("click", event => {
      event.preventDefault();
      void this.close();
    });

    // The rail switches panels in place; every panel stays in the form so a save
    // still submits the fields of the sections the user never opened.
    for (const tab of form.querySelectorAll("[data-sc-cae-settings-tab]")) {
      tab.addEventListener("click", event => {
        event.preventDefault();
        ModuleSettingsApp.#activateTab(form, tab.dataset.scCaeSettingsTab);
      });
    }
  }

  static #activateTab(form, id) {
    for (const tab of form.querySelectorAll("[data-sc-cae-settings-tab]")) {
      const active = tab.dataset.scCaeSettingsTab === id;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", String(active));
      tab.tabIndex = active ? 0 : -1;
    }

    for (const panel of form.querySelectorAll("[data-sc-cae-settings-panel]")) {
      const active = panel.dataset.scCaeSettingsPanel === id;
      panel.classList.toggle("is-active", active);
      panel.hidden = !active;
    }
  }

  static #createCheckboxField(key, checked, disabled) {
    return {
      key,
      checked,
      disabled,
      isSelect: false,
      name: Constants.localize(ModuleSettingsApp.#getSettingNameKey(key), key),
      hint: Constants.localize(ModuleSettingsApp.#getSettingHintKey(key), "")
    };
  }

  static #createSelectField(key, value, choices, disabled) {
    return {
      key,
      disabled,
      isSelect: true,
      name: Constants.localize(ModuleSettingsApp.#getSettingNameKey(key), key),
      hint: Constants.localize(ModuleSettingsApp.#getSettingHintKey(key), ""),
      options: choices.map(choice => ({
        value: choice,
        selected: choice === value,
        label: Constants.localize(ModuleSettingsApp.#getSettingChoiceKey(key, choice), choice)
      }))
    };
  }

  static #getSettingChoiceKey(key, choice) {
    const capitalized = `${choice.charAt(0).toUpperCase()}${choice.slice(1)}`;
    const prefixes = {
      [ModuleSettings.SETTING_FORMULA_FIELD_STYLE]: "SCConditionalAE.Settings.FormulaFieldStyle"
    };

    return prefixes[key] ? `${prefixes[key]}.${capitalized}` : choice;
  }

  static #getSettingNameKey(key) {
    const names = {
      [ModuleSettings.SETTING_ENABLE_FORMULA_CHANGES]: "SCConditionalAE.Settings.EnableFormulaChanges.Name",
      [ModuleSettings.SETTING_FORMULA_FIELD_STYLE]: "SCConditionalAE.Settings.FormulaFieldStyle.Name",
      [ModuleSettings.SETTING_USE_FORMULA_CHAT_CARD]: "SCConditionalAE.Settings.UseFormulaChatCard.Name",
      [ModuleSettings.SETTING_SHOW_CONDITION_TAB]: "SCConditionalAE.Settings.ShowConditionTab.Name",
      [ModuleSettings.SETTING_TINT_EFFECT_ICONS]: "SCConditionalAE.Settings.TintEffectIcons.Name",
      [ModuleSettings.SETTING_DEBUG_LOGGING]: "SCConditionalAE.Settings.DebugLogging.Name"
    };

    return names[key] ?? key;
  }

  static #getSettingHintKey(key) {
    const hints = {
      [ModuleSettings.SETTING_ENABLE_FORMULA_CHANGES]: "SCConditionalAE.Settings.EnableFormulaChanges.Hint",
      [ModuleSettings.SETTING_FORMULA_FIELD_STYLE]: "SCConditionalAE.Settings.FormulaFieldStyle.Hint",
      [ModuleSettings.SETTING_USE_FORMULA_CHAT_CARD]: "SCConditionalAE.Settings.UseFormulaChatCard.Hint",
      [ModuleSettings.SETTING_SHOW_CONDITION_TAB]: "SCConditionalAE.Settings.ShowConditionTab.Hint",
      [ModuleSettings.SETTING_TINT_EFFECT_ICONS]: "SCConditionalAE.Settings.TintEffectIcons.Hint",
      [ModuleSettings.SETTING_DEBUG_LOGGING]: "SCConditionalAE.Settings.DebugLogging.Hint"
    };

    return hints[key] ?? key;
  }

  async #save(form) {
    const submitted = this.#getSubmittedValues(form);
    const current = this.#getCurrentValues();
    const updates = [];
    let requiresReload = false;

    if (game.user?.isGM === true) {
      requiresReload = this.#queueUpdate(
        updates,
        ModuleSettings.SETTING_ENABLE_FORMULA_CHANGES,
        current.enableFormulaChanges,
        submitted.enableFormulaChanges,
        true
      ) || requiresReload;
      this.#queueUpdate(
        updates,
        ModuleSettings.SETTING_USE_FORMULA_CHAT_CARD,
        current.useFormulaChatCard,
        submitted.useFormulaChatCard
      );
      requiresReload = this.#queueUpdate(
        updates,
        ModuleSettings.SETTING_SHOW_CONDITION_TAB,
        current.showConditionTab,
        submitted.showConditionTab,
        true
      ) || requiresReload;
    }

    this.#queueUpdate(
      updates,
      ModuleSettings.SETTING_FORMULA_FIELD_STYLE,
      current.formulaFieldStyle,
      submitted.formulaFieldStyle
    );

    this.#queueUpdate(
      updates,
      ModuleSettings.SETTING_TINT_EFFECT_ICONS,
      current.tintEffectIcons,
      submitted.tintEffectIcons
    );

    this.#queueUpdate(
      updates,
      ModuleSettings.SETTING_DEBUG_LOGGING,
      current.debugLogging,
      submitted.debugLogging
    );

    for (const update of updates) {
      await game.settings.set(Constants.MODULE_ID, update.key, update.value);
    }

    if (requiresReload) {
      globalThis.SettingsConfig?.reloadConfirm?.();
    }

    ui.notifications?.info?.(
      Constants.localize("SCConditionalAE.Settings.App.Saved", "SC - Conditional AE settings saved.")
    );
    await this.close();
  }

  #queueUpdate(updates, key, currentValue, nextValue, reloadRequired = false) {
    if (currentValue === nextValue) {
      return false;
    }

    updates.push({ key, value: nextValue });
    return reloadRequired;
  }

  #getCurrentValues() {
    return {
      enableFormulaChanges: ModuleSettings.isFormulaChangesEnabled(),
      formulaFieldStyle: ModuleSettings.getFormulaFieldStyle(),
      useFormulaChatCard: ModuleSettings.isFormulaChatCardEnabled(),
      showConditionTab: ModuleSettings.isConditionTabEnabled(),
      tintEffectIcons: ModuleSettings.isEffectIconTintEnabled(),
      debugLogging: ModuleSettings.isDebugLoggingEnabled()
    };
  }

  #getSubmittedValues(form) {
    const formData = new FormData(form);

    return {
      enableFormulaChanges: formData.has(ModuleSettings.SETTING_ENABLE_FORMULA_CHANGES),
      formulaFieldStyle: String(formData.get(ModuleSettings.SETTING_FORMULA_FIELD_STYLE) ?? "expand"),
      useFormulaChatCard: formData.has(ModuleSettings.SETTING_USE_FORMULA_CHAT_CARD),
      showConditionTab: formData.has(ModuleSettings.SETTING_SHOW_CONDITION_TAB),
      tintEffectIcons: formData.has(ModuleSettings.SETTING_TINT_EFFECT_ICONS),
      debugLogging: formData.has(ModuleSettings.SETTING_DEBUG_LOGGING)
    };
  }
}
