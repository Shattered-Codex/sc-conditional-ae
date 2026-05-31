import { ActiveEffectContextBuilder } from "../helpers/ActiveEffectContextBuilder.js";

export class ActiveEffectTransferContextService {
  static #PENDING_TTL_MS = 10000;
  static #pendingByActorUser = new Map();

  static rememberDrop({ actorUuid, effectUuid, userId }) {
    if (!actorUuid || !effectUuid || !userId) {
      return;
    }

    ActiveEffectTransferContextService.#clearExpiredDrops();
    ActiveEffectTransferContextService.#pendingByActorUser.set(
      ActiveEffectTransferContextService.#getKey(actorUuid, userId),
      {
        actorUuid,
        effectUuid,
        userId,
        createdAt: Date.now()
      }
    );
  }

  static consumeMatchingDrop({ actorUuid, effectData, userId }) {
    if (!actorUuid || !userId || !effectData) {
      return null;
    }

    ActiveEffectTransferContextService.#clearExpiredDrops();
    const key = ActiveEffectTransferContextService.#getKey(actorUuid, userId);
    const pending = ActiveEffectTransferContextService.#pendingByActorUser.get(key) ?? null;
    if (!pending) {
      return null;
    }

    const sourceEffect = ActiveEffectTransferContextService.#resolveEffect(pending.effectUuid);
    if (!sourceEffect) {
      ActiveEffectTransferContextService.#pendingByActorUser.delete(key);
      return null;
    }

    if (!ActiveEffectTransferContextService.#matchesEffectData(sourceEffect, effectData)) {
      return null;
    }

    ActiveEffectTransferContextService.#pendingByActorUser.delete(key);
    return sourceEffect;
  }

  static #getKey(actorUuid, userId) {
    return `${actorUuid}::${userId}`;
  }

  static #clearExpiredDrops() {
    const expirationTime = Date.now() - ActiveEffectTransferContextService.#PENDING_TTL_MS;

    for (const [key, pending] of ActiveEffectTransferContextService.#pendingByActorUser.entries()) {
      if ((pending?.createdAt ?? 0) < expirationTime) {
        ActiveEffectTransferContextService.#pendingByActorUser.delete(key);
      }
    }
  }

  static #resolveEffect(effectUuid) {
    if (!effectUuid || typeof fromUuidSync !== "function") {
      return null;
    }

    try {
      const effect = fromUuidSync(effectUuid);
      return effect instanceof CONFIG.ActiveEffect.documentClass ? effect : null;
    } catch {
      return null;
    }
  }

  static #matchesEffectData(sourceEffect, effectData) {
    if (!(sourceEffect?.parent instanceof CONFIG.Item.documentClass)) {
      return false;
    }

    const sourceName = String(sourceEffect.name ?? "").trim();
    const targetName = String(effectData?.name ?? "").trim();
    if (!sourceName.length || sourceName !== targetName) {
      return false;
    }

    const sourceChanges = ActiveEffectContextBuilder.getChangeSignature(sourceEffect.changes ?? []);
    const targetChanges = ActiveEffectContextBuilder.getChangeSignature(effectData?.changes ?? []);
    if (sourceChanges.length !== targetChanges.length) {
      return false;
    }

    return sourceChanges.every((change, index) => (
      change.key === targetChanges[index]?.key
      && change.mode === targetChanges[index]?.mode
    ));
  }
}
