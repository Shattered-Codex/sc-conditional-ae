import { Constants } from "../constants/Constants.js";
import { ActiveEffectConditionService } from "./ActiveEffectConditionService.js";

export class ActiveEffectMacroChangeService {
  static normalizeChanges(source) {
    const changes = source?.changes;
    if (!Array.isArray(changes)) {
      return false;
    }

    let changed = false;
    for (const change of changes) {
      if (!ActiveEffectMacroChangeService.#isExecutableChange(change)) {
        continue;
      }

      if (change.mode !== CONST.ACTIVE_EFFECT_MODES.CUSTOM) {
        change.mode = CONST.ACTIVE_EFFECT_MODES.CUSTOM;
        changed = true;
      }
    }

    return changed;
  }

  static hasExecutableMacro(effect) {
    return ActiveEffectMacroChangeService.#getExecutableChanges(effect).length > 0;
  }

  static async execute(effect, action) {
    if (!ActiveEffectMacroChangeService.hasExecutableMacro(effect)) {
      return;
    }

    if (action === "on" && ActiveEffectConditionService.shouldSuppress(effect)) {
      return;
    }

    const actor = ActiveEffectMacroChangeService.#getActor(effect);
    if (!actor) {
      return;
    }

    for (const change of ActiveEffectMacroChangeService.#getExecutableChanges(effect)) {
      await ActiveEffectMacroChangeService.#executeChange({ actor, change, effect, action });
    }
  }

  static #getExecutableChanges(effect) {
    return (effect?.changes ?? [])
      .filter(change => ActiveEffectMacroChangeService.#isExecutableChange(change));
  }

  static #isExecutableChange(change) {
    if (!change?.key) {
      return false;
    }

    if (change.key === Constants.MACRO_EXECUTE_CHANGE_KEY) {
      return true;
    }

    if (change.key === Constants.LEGACY_MACRO_EXECUTE_CHANGE_KEY) {
      return true;
    }

    return !Constants.isDaeActive() && change.key === Constants.DAE_MACRO_EXECUTE_CHANGE_KEY;
  }

  static async #executeChange({ actor, change, effect, action }) {
    const [macroReference, ...macroArgs] = ActiveEffectMacroChangeService.#parseChangeValue(change.value);
    if (!macroReference) {
      return;
    }

    const macro = ActiveEffectMacroChangeService.#resolveMacro(macroReference);
    if (!macro) {
      ui.notifications?.warn?.(
        Constants.localize("SCConditionalAE.MacroChange.MacroNotFound", "Macro not found: {macro}")
          .replace("{macro}", macroReference)
      );
      return;
    }

    const scope = ActiveEffectMacroChangeService.#buildMacroScope({ actor, change, effect, action, macroArgs });
    try {
      await macro.execute(scope);
    } catch (error) {
      console.warn(`[${Constants.MODULE_ID}] active effect macro execution failed`, error);
    }
  }

  static #parseChangeValue(value) {
    const source = String(value ?? "").trim();
    if (!source.length) {
      return [];
    }

    const tokens = [];
    let current = "";
    let quote = null;
    let escaping = false;

    for (const character of source) {
      if (escaping) {
        current += character;
        escaping = false;
        continue;
      }

      if (character === "\\") {
        escaping = true;
        continue;
      }

      if (quote) {
        if (character === quote) {
          quote = null;
        } else {
          current += character;
        }
        continue;
      }

      if (character === "\"" || character === "'") {
        quote = character;
        continue;
      }

      if (/\s/.test(character)) {
        if (current.length) {
          tokens.push(current);
          current = "";
        }
        continue;
      }

      current += character;
    }

    if (current.length) {
      tokens.push(current);
    }

    return tokens;
  }

  static #resolveMacro(reference) {
    if (typeof fromUuidSync === "function") {
      try {
        const document = fromUuidSync(reference);
        if (document instanceof CONFIG.Macro.documentClass) {
          return document;
        }
      } catch {
        // Fall back to world macro lookup by id or name.
      }
    }

    return game.macros?.get(reference) ?? game.macros?.getName(reference) ?? null;
  }

  static #buildMacroScope({ actor, change, effect, action, macroArgs }) {
    const token = ActiveEffectMacroChangeService.#getToken(actor);
    const item = ActiveEffectMacroChangeService.#getItem(effect);
    const origin = ActiveEffectMacroChangeService.#getOrigin(effect);
    const lastArg = {
      action,
      actorId: actor.id,
      actorUuid: actor.uuid,
      change,
      effectId: effect.id,
      effectUuid: effect.uuid,
      itemUuid: item?.uuid ?? null,
      origin: effect.origin ?? null,
      tokenId: token?.id ?? null,
      tokenUuid: token?.document?.uuid ?? token?.uuid ?? null
    };

    return {
      action,
      actor,
      args: [action, ...macroArgs, lastArg],
      change,
      effect,
      item,
      lastArg,
      macroArgs,
      origin,
      speaker: ChatMessage.getSpeaker({ actor, token }),
      token,
      user: game.user ?? null
    };
  }

  static #getActor(effect) {
    const parent = effect?.parent;
    if (parent instanceof CONFIG.Actor.documentClass) {
      return parent;
    }

    if (parent instanceof CONFIG.Item.documentClass) {
      if (effect?.transfer === false) {
        return null;
      }
      return parent.actor ?? parent.parent ?? null;
    }

    return null;
  }

  static #getToken(actor) {
    if (actor?.token?.object) {
      return actor.token.object;
    }

    return actor?.getActiveTokens?.()[0] ?? null;
  }

  static #getItem(effect) {
    if (effect?.parent instanceof CONFIG.Item.documentClass) {
      return effect.parent;
    }

    const origin = ActiveEffectMacroChangeService.#getOrigin(effect);
    if (origin instanceof CONFIG.Item.documentClass) {
      return origin;
    }

    if (origin?.parent instanceof CONFIG.Item.documentClass) {
      return origin.parent;
    }

    return null;
  }

  static #getOrigin(effect) {
    const originUuid = effect?.origin ?? null;
    if (!originUuid || typeof fromUuidSync !== "function") {
      return null;
    }

    try {
      return fromUuidSync(originUuid) ?? null;
    } catch {
      return null;
    }
  }
}
