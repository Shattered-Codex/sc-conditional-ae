import { ResponsibleUser } from "../helpers/ResponsibleUser.js";
import { ActiveEffectContextBuilder } from "../helpers/ActiveEffectContextBuilder.js";
import { Constants } from "../constants/Constants.js";
import { ActiveEffectChangesCompatibility } from "../compat/ActiveEffectChangesCompatibility.js";
import { Dnd5e6ChangeConditionService } from "./Dnd5e6ChangeConditionService.js";

export class ActiveEffectMacroChangeService {
  static normalizeChanges(source) {
    if (!ActiveEffectChangesCompatibility.hasExplicitChanges(source)) {
      return false;
    }
    const changes = ActiveEffectChangesCompatibility.get(source);

    let changed = false;
    const usesSystemChanges = ActiveEffectChangesCompatibility.usesSystemPath(source);
    for (const change of changes) {
      if (!ActiveEffectMacroChangeService.isExecutableChange(change)) {
        continue;
      }

      if (usesSystemChanges && change.type !== "custom") {
        change.type = "custom";
        changed = true;
      } else if (!usesSystemChanges && change.mode !== CONST.ACTIVE_EFFECT_MODES.CUSTOM) {
        change.mode = CONST.ACTIVE_EFFECT_MODES.CUSTOM;
        changed = true;
      }
    }

    return changed;
  }

  static hasExecutableMacro(effect) {
    return ActiveEffectMacroChangeService.#getExecutableChanges(effect).length > 0;
  }

  static async execute(effect, action, { changeIds = null } = {}) {
    if (!ActiveEffectMacroChangeService.hasExecutableMacro(effect)) {
      return;
    }

    if (action === "on" && !Dnd5e6ChangeConditionService.isEffectAllowed(effect)) {
      return;
    }

    const actor = ActiveEffectMacroChangeService.#getActor(effect);
    if (!actor) {
      return;
    }

    const selectedIds = changeIds === null
      ? null
      : new Set(Array.from(changeIds, value => String(value)));
    for (const change of ActiveEffectMacroChangeService.#getExecutableChanges(effect)) {
      if (
        selectedIds
        && !selectedIds.has(Dnd5e6ChangeConditionService.getChangeId(change))
      ) {
        continue;
      }
      // An explicitly targeted `off` still runs with a false condition: the
      // transition handler names the change precisely so its macro can clean up
      // work done while it was available. A blanket `off` must skip those, or a
      // change whose own condition already fired `off` cleans up twice when the
      // effect-wide condition later turns off too.
      if (
        (action === "on" || selectedIds === null)
        && !Dnd5e6ChangeConditionService.isChangeAllowed(effect, change, { actor })
      ) {
        continue;
      }

      await ActiveEffectMacroChangeService.#executeChange({ actor, change, effect, action });
    }
  }

  /**
   * Run an action for change objects supplied by the caller.
   *
   * A change that was deleted is no longer readable from the effect, so its
   * cleanup has to be driven from the snapshot taken before the update.
   */
  static async executeForChanges(effect, action, changes) {
    const actor = ActiveEffectMacroChangeService.#getActor(effect);
    if (!actor) {
      return;
    }

    for (const change of changes ?? []) {
      if (!ActiveEffectMacroChangeService.isExecutableChange(change)) continue;
      await ActiveEffectMacroChangeService.#executeChange({ actor, change, effect, action });
    }
  }

  static #getExecutableChanges(effect) {
    const changes = ActiveEffectChangesCompatibility.get(effect);
    return changes
      .filter(change => ActiveEffectMacroChangeService.isExecutableChange(change));
  }

  static isExecutableChange(change) {
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

  static isResponsibleForExecution(effect) {
    const actor = ActiveEffectMacroChangeService.#getActor(effect);
    if (!actor) {
      return false;
    }

    return ResponsibleUser.isCurrentUser(actor);
  }

  static #getActor(effect) {
    // A non-transferring item effect never reaches the actor, so its macros
    // have no actor to run against.
    if (effect?.transfer === false && effect?.parent instanceof CONFIG.Item.documentClass) {
      return null;
    }

    return ActiveEffectContextBuilder.getAffectedActor(effect);
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
    return ActiveEffectContextBuilder.getOrigin(effect);
  }
}
