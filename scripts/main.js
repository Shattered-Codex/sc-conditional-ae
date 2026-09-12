import { Constants } from "./constants/Constants.js";
import { DebugLog } from "./helpers/DebugLog.js";
import { ActiveEffectSheetRegistrar } from "./applications/ActiveEffectSheetRegistrar.js";
import { ChangesGridLayoutAdapter } from "./applications/ChangesGridLayoutAdapter.js";
import { Dnd5e6AdvancedConditionsAdapter } from "./applications/Dnd5e6AdvancedConditionsAdapter.js";
import { Dnd5e6ChangeConditionStatusRenderer } from "./applications/Dnd5e6ChangeConditionStatusRenderer.js";
import { Dnd5e6FormulaChangeAdapter } from "./applications/Dnd5e6FormulaChangeAdapter.js";
import { EffectListFormulaRollButtonRenderer } from "./applications/EffectListFormulaRollButtonRenderer.js";
import { EffectSheetIconTintRenderer } from "./applications/EffectSheetIconTintRenderer.js";
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
import { TokenLightingService } from "./services/TokenLightingService.js";
import { ModuleSettings } from "./settings/ModuleSettings.js";
import { ModuleSettingsRegistrar } from "./settings/ModuleSettingsRegistrar.js";

DaeCompatibility.activate();

Hooks.once("init", () => {
  DebugLog.write("module init");
  AuraEffectsCompatibility.activate();
  ModuleSettingsRegistrar.register();
});

Hooks.once("setup", () => {
  DebugLog.write("module setup", {
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
  ChangesGridLayoutAdapter.activate();
  Dnd5e6AdvancedConditionsAdapter.activate();
  Dnd5e6ChangeConditionStatusRenderer.activate();
  EffectSheetIconTintRenderer.activate();
  Dnd5e6FormulaChangeAdapter.activate();
  const formulaChangesEnabled = ModuleSettings.isFormulaChangesEnabled();
  EffectListFormulaRollButtonRenderer.activate({ formulaControlsEnabled: formulaChangesEnabled });
  if (formulaChangesEnabled) {
    ActiveEffectFormulaChatCardService.activate();
    ActiveEffectFormulaChangeHooks.activate();
    FormulaColumnRenderer.activateRenderHook();
  }
  ActiveEffectMacroChangeHooks.activate();
});

Hooks.once("ready", () => {
  DebugLog.write("module ready; scheduling Active Effect sheet registration");

  const module = game.modules.get(Constants.MODULE_ID);
  if (module) {
    module.api = {
      getCondition: ActiveEffectConditionService.getCondition.bind(ActiveEffectConditionService),
      hasCondition: ActiveEffectConditionService.hasCondition.bind(ActiveEffectConditionService),
      validateCondition: ActiveEffectConditionService.validateCondition.bind(ActiveEffectConditionService),
      evaluate: ActiveEffectConditionService.evaluate.bind(ActiveEffectConditionService),
      shouldSuppress: ActiveEffectConditionService.shouldSuppress.bind(ActiveEffectConditionService),
      getToken: TokenLightingService.getToken.bind(TokenLightingService),
      getLightLevel: TokenLightingService.getLightLevel.bind(TokenLightingService),
      lightLevels: TokenLightingService.LEVELS
    };
  }

  window.setTimeout(() => {
    ActiveEffectSheetRegistrar.registerSheets();
  }, 0);
});
