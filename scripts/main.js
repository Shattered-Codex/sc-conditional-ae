import { Constants } from "./constants/Constants.js";
import { ActiveEffectSheetRegistrar } from "./applications/ActiveEffectSheetRegistrar.js";
import { EffectListFormulaRollButtonRenderer } from "./applications/EffectListFormulaRollButtonRenderer.js";
import { FormulaColumnRenderer } from "./applications/FormulaColumnRenderer.js";
import { AuraEffectsCompatibility } from "./compat/AuraEffectsCompatibility.js";
import { DaeCompatibility } from "./compat/DaeCompatibility.js";
import { ActiveEffectConditionHooks } from "./hooks/ActiveEffectConditionHooks.js";
import { ActiveEffectTransferContextHooks } from "./hooks/ActiveEffectTransferContextHooks.js";
import { EffectApplicationHooks } from "./hooks/EffectApplicationHooks.js";
import { ActiveEffectFormulaChangeHooks } from "./hooks/ActiveEffectFormulaChangeHooks.js";
import { ActiveEffectMacroChangeHooks } from "./hooks/ActiveEffectMacroChangeHooks.js";
import { ActiveEffectTransferHooks } from "./hooks/ActiveEffectTransferHooks.js";
import { ActiveEffectConditionService } from "./services/ActiveEffectConditionService.js";
import { ActiveEffectFormulaChatCardService } from "./services/ActiveEffectFormulaChatCardService.js";
import { ModuleSettings } from "./settings/ModuleSettings.js";
import { ModuleSettingsRegistrar } from "./settings/ModuleSettingsRegistrar.js";

DaeCompatibility.activate();

Hooks.once("init", () => {
  Constants.debug("module init");
  AuraEffectsCompatibility.activate();
  ModuleSettingsRegistrar.register();
});

Hooks.once("setup", () => {
  Constants.debug("module setup", {
    system: game.system?.id,
    dnd5eActive: Constants.isDnd5eActive()
  });

  if (!Constants.isDnd5eActive()) {
    const message = `${Constants.MODULE_ID} only supports the dnd5e system.`;
    console.warn(`[${Constants.MODULE_ID}] ${message}`);
    ui.notifications?.warn?.(message);
    return;
  }

  ActiveEffectConditionHooks.activate();
  ActiveEffectTransferContextHooks.activate();
  EffectApplicationHooks.activate();
  ActiveEffectTransferHooks.activate();
  if (ModuleSettings.isFormulaChangesEnabled()) {
    ActiveEffectFormulaChatCardService.activate();
    ActiveEffectFormulaChangeHooks.activate();
    FormulaColumnRenderer.activateRenderHook();
    EffectListFormulaRollButtonRenderer.activate();
  }
  ActiveEffectMacroChangeHooks.activate();
});

Hooks.once("ready", () => {
  Constants.debug("module ready; scheduling Active Effect sheet registration");

  const module = game.modules.get(Constants.MODULE_ID);
  if (module) {
    module.api = {
      getCondition: ActiveEffectConditionService.getCondition.bind(ActiveEffectConditionService),
      hasCondition: ActiveEffectConditionService.hasCondition.bind(ActiveEffectConditionService),
      validateCondition: ActiveEffectConditionService.validateCondition.bind(ActiveEffectConditionService),
      evaluate: ActiveEffectConditionService.evaluate.bind(ActiveEffectConditionService),
      shouldSuppress: ActiveEffectConditionService.shouldSuppress.bind(ActiveEffectConditionService)
    };
  }

  window.setTimeout(() => {
    ActiveEffectSheetRegistrar.registerSheets();
  }, 0);
});
