export class TokenLightingService {
  static #cache = new WeakMap();
  static #lightingRevision = 0;

  static LEVELS = Object.freeze({
    BRIGHT: "bright",
    DIM: "dim",
    DARK: "dark"
  });

  static getToken(actor) {
    if (!actor) {
      return null;
    }

    const canvas = globalThis.canvas;
    const actorToken = actor.token?.object ?? actor.token ?? null;
    if (
      actorToken
      && (!canvas?.scene || actorToken.scene?.id === canvas.scene.id || actorToken.document?.parent?.id === canvas.scene.id)
    ) {
      return actorToken.object ?? actorToken;
    }

    const activeToken = actor.getActiveTokens?.()[0] ?? null;
    if (activeToken) {
      return activeToken.object ?? activeToken;
    }

    return (canvas?.tokens?.placeables ?? []).find(token => (
      token?.actor === actor
      || (
        actor?.uuid
        && token?.actor?.uuid === actor.uuid
      )
    )) ?? null;
  }

  static getLightLevel(token) {
    const canvas = globalThis.canvas;
    const effects = canvas?.effects;
    const placeable = token?.object ?? token;
    const point = TokenLightingService.getTokenPoint(placeable);
    if (!effects || !point) {
      return null;
    }

    const cacheKey = placeable?.document ?? placeable;
    const cached = cacheKey && typeof cacheKey === "object"
      ? TokenLightingService.#cache.get(cacheKey)
      : null;
    if (
      cached?.revision === TokenLightingService.#lightingRevision
      && cached.x === point.x
      && cached.y === point.y
      && cached.elevation === point.elevation
    ) {
      return cached.level;
    }

    const level = TokenLightingService.#classifyLightLevel(effects, point);
    if (cacheKey && typeof cacheKey === "object") {
      TokenLightingService.#cache.set(cacheKey, {
        revision: TokenLightingService.#lightingRevision,
        x: point.x,
        y: point.y,
        elevation: point.elevation,
        level
      });
    }
    return level;
  }

  static invalidateCache() {
    TokenLightingService.#lightingRevision += 1;
  }

  static clearCache() {
    TokenLightingService.#cache = new WeakMap();
    TokenLightingService.invalidateCache();
  }

  static #classifyLightLevel(effects, point) {
    const canvas = globalThis.canvas;

    const globalLightSource = canvas?.environment?.globalLightSource
      ?? effects?.globalLightSource
      ?? null;

    if (TokenLightingService.#testInsideDarkness(effects, point)) {
      return TokenLightingService.LEVELS.DARK;
    }

    let insideDimLight = false;
    for (const lightSource of effects.lightSources ?? []) {
      if (
        !lightSource?.active
        || lightSource === globalLightSource
        || lightSource.isPreview
        || !TokenLightingService.#testSourcePoint(lightSource, point)
      ) {
        continue;
      }

      const brightRadius = Math.abs(Number(lightSource.data?.bright ?? 0));
      if (brightRadius > 0 && TokenLightingService.#isWithinRadius(point, lightSource, brightRadius)) {
        return TokenLightingService.LEVELS.BRIGHT;
      }

      insideDimLight = true;
    }

    if (
      globalLightSource?.active
      && TokenLightingService.#testInsideLight(effects, point, source => source === globalLightSource)
    ) {
      if (Math.abs(Number(globalLightSource.data?.bright ?? 0)) > 0) {
        return TokenLightingService.LEVELS.BRIGHT;
      }
      insideDimLight = true;
    }

    if (insideDimLight) {
      return TokenLightingService.LEVELS.DIM;
    }

    // Keep a compatibility fallback for light-source implementations which participate in
    // Foundry's native test but are not exposed through lightSources in the usual shape.
    return TokenLightingService.#testInsideLight(effects, point)
      ? TokenLightingService.LEVELS.DIM
      : TokenLightingService.LEVELS.DARK;
  }

  static getTokenPoint(token) {
    const placeable = token?.object ?? token;
    const document = placeable?.document ?? placeable;
    const center = document?.getCenterPoint?.() ?? placeable?.center;
    if (!Number.isFinite(center?.x) || !Number.isFinite(center?.y)) {
      return null;
    }

    return {
      x: center.x,
      y: center.y,
      elevation: Number(document?.elevation ?? center.elevation ?? 0)
    };
  }

  static #testInsideLight(effects, point, condition = null) {
    if (typeof effects?.testInsideLight !== "function") {
      return false;
    }

    try {
      return effects.testInsideLight(point, condition ? { condition } : {});
    } catch {
      return false;
    }
  }

  static #testInsideDarkness(effects, point) {
    if (typeof effects?.testInsideDarkness !== "function") {
      return false;
    }

    try {
      return effects.testInsideDarkness(point);
    } catch {
      return false;
    }
  }

  static #testSourcePoint(lightSource, point) {
    try {
      if (typeof lightSource.testPoint === "function") {
        return lightSource.testPoint(point);
      }

      return lightSource.shape?.contains?.(point.x, point.y) === true;
    } catch {
      return false;
    }
  }

  static #isWithinRadius(point, lightSource, radius) {
    const sourcePoint = lightSource.origin ?? lightSource.data ?? lightSource;
    const x = Number(sourcePoint?.x);
    const y = Number(sourcePoint?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return false;
    }

    const dx = point.x - x;
    const dy = point.y - y;
    if (((dx * dx) + (dy * dy)) > (radius * radius)) {
      return false;
    }

    const sourcePriority = Number(lightSource.priority ?? lightSource.data?.priority ?? 0);
    if (globalThis.game?.release?.generation > 13 && sourcePriority === 0) {
      const sourceElevation = Number(sourcePoint?.elevation ?? 0);
      const distancePixels = Number(globalThis.canvas?.dimensions?.distancePixels ?? 0);
      if (Number.isFinite(sourceElevation) && Number.isFinite(distancePixels)) {
        const verticalDistance = Math.abs(point.elevation - sourceElevation) * distancePixels;
        if (verticalDistance > radius) {
          return false;
        }
      }
    }

    return true;
  }
}
