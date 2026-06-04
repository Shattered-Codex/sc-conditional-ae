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

    const BaseActiveEffectTypeDataModel = dataModels.base
      ?? foundry.data.ActiveEffectTypeDataModel
      ?? foundry.abstract?.TypeDataModel;
    if (typeof BaseActiveEffectTypeDataModel !== "function") {
      Constants.debug("could not register Aura Effects fallback type: no compatible base Active Effect data model found", {
        configuredBase: dataModels.base?.name,
        activeEffectTypeDataModel: foundry.data.ActiveEffectTypeDataModel?.name,
        typeDataModel: foundry.abstract?.TypeDataModel?.name
      });
      return;
    }

    const hasNativeActiveEffectTypeDataModel = typeof foundry.data.ActiveEffectTypeDataModel === "function";
    dataModels["auraeffects.aura"] = class SCLegacyAuraEffectData extends BaseActiveEffectTypeDataModel {
      static defineSchema() {
        return hasNativeActiveEffectTypeDataModel && typeof super.defineSchema === "function"
          ? super.defineSchema()
          : {};
      }
    };
    if (CONFIG.ActiveEffect.typeLabels) {
      CONFIG.ActiveEffect.typeLabels["auraeffects.aura"] = "Aura Effects Aura";
    }

    Constants.debug("registered fallback ActiveEffect type for inactive Aura Effects", {
      type: "auraeffects.aura",
      baseModel: BaseActiveEffectTypeDataModel?.name
    });
  }
}
