import { Constants } from "../constants/Constants.js";

export class AuraEffectsCompatibility {
  static activate() {
    const auraEffects = game.modules.get("auraeffects");
    if (auraEffects?.active) {
      Constants.debug("Aura Effects is active; native aura effect type registration will be used");
      return;
    }

    const dataModels = CONFIG.ActiveEffect?.dataModels;
    if (!dataModels) {
      Constants.debug("could not register Aura Effects fallback type: CONFIG.ActiveEffect.dataModels is unavailable");
      return;
    }

    if (dataModels["auraeffects.aura"]) {
      Constants.debug("Aura Effects fallback type already exists");
      return;
    }

    const BaseActiveEffectTypeDataModel = dataModels.base ?? foundry.data.ActiveEffectTypeDataModel;
    dataModels["auraeffects.aura"] = class SCLegacyAuraEffectData extends BaseActiveEffectTypeDataModel {};
    if (CONFIG.ActiveEffect.typeLabels) {
      CONFIG.ActiveEffect.typeLabels["auraeffects.aura"] = "Aura Effects Aura";
    }

    Constants.debug("registered fallback ActiveEffect type for inactive Aura Effects", {
      type: "auraeffects.aura",
      baseModel: BaseActiveEffectTypeDataModel?.name
    });
  }
}
