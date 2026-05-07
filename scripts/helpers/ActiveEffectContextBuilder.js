export class ActiveEffectContextBuilder {
  static getAffectedActor(effect) {
    const parent = effect?.parent;
    if (parent instanceof CONFIG.Actor.documentClass) {
      return parent;
    }

    if (parent instanceof CONFIG.Item.documentClass) {
      return parent.actor ?? parent.parent ?? null;
    }

    return null;
  }

  static getOrigin(effect) {
    const originUuid = effect?.origin ?? foundry.utils.getProperty(effect ?? {}, "origin");
    if (!originUuid || typeof fromUuidSync !== "function") {
      return null;
    }

    try {
      return fromUuidSync(originUuid) ?? null;
    } catch {
      return null;
    }
  }

  static getItem(effect, origin) {
    if (effect?.parent instanceof CONFIG.Item.documentClass) {
      return effect.parent;
    }

    if (origin instanceof CONFIG.Item.documentClass) {
      return origin;
    }

    if (origin instanceof CONFIG.ActiveEffect.documentClass && origin.parent instanceof CONFIG.Item.documentClass) {
      return origin.parent;
    }

    return null;
  }

  static getOriginActor(origin) {
    if (origin instanceof CONFIG.Actor.documentClass) {
      return origin;
    }

    if (origin instanceof CONFIG.Item.documentClass) {
      return origin.actor ?? null;
    }

    if (origin instanceof CONFIG.ActiveEffect.documentClass) {
      const parent = origin.parent;
      if (parent instanceof CONFIG.Actor.documentClass) {
        return parent;
      }
      if (parent instanceof CONFIG.Item.documentClass) {
        return parent.actor ?? null;
      }
    }

    return null;
  }
}
