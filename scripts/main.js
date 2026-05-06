import { Constants } from "./constants/Constants.js";
import { ActiveEffectSheetRegistrar } from "./applications/ActiveEffectSheetRegistrar.js";
import { AuraEffectsCompatibility } from "./compat/AuraEffectsCompatibility.js";
import { ActiveEffectConditionHooks } from "./hooks/ActiveEffectConditionHooks.js";

Hooks.once("init", () => {
  Constants.debug("module init");
  AuraEffectsCompatibility.activate();
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
});

Hooks.once("ready", () => {
  Constants.debug("module ready; scheduling Active Effect sheet registration");
  window.setTimeout(() => {
    ActiveEffectSheetRegistrar.registerSheets();
  }, 0);
});
