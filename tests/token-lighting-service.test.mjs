import assert from "node:assert/strict";
import test from "node:test";

const { TokenLightingService } = await import(
  "../scripts/services/TokenLightingService.js"
);

function makeToken({ x = 0, y = 0, elevation = 0 } = {}) {
  const document = {
    elevation,
    getCenterPoint: () => ({ x, y, elevation })
  };

  return { document };
}

function makeLocalLight({ bright = 10, active = true, isPreview = false } = {}) {
  return {
    active,
    data: { bright, elevation: 0, priority: 0 },
    isPreview,
    origin: { x: 0, y: 0, elevation: 0 },
    priority: 0,
    testPoint: () => true
  };
}

function setCanvas({
  darkness = false,
  globalLightSource = null,
  insideGlobalLight = false,
  lightSources = []
} = {}) {
  globalThis.canvas = {
    dimensions: { distancePixels: 1 },
    effects: {
      lightSources,
      testInsideDarkness: () => darkness,
      testInsideLight(_point, options = {}) {
        if (options.condition) {
          return insideGlobalLight && options.condition(globalLightSource);
        }

        return false;
      }
    },
    environment: { globalLightSource }
  };
}

test("classifies local bright, dim, and unlit areas", () => {
  globalThis.game = { release: { generation: 13 } };
  const light = makeLocalLight({ bright: 10 });
  setCanvas({ lightSources: [light] });

  assert.equal(
    TokenLightingService.getLightLevel(makeToken({ x: 5 })),
    TokenLightingService.LEVELS.BRIGHT
  );
  assert.equal(
    TokenLightingService.getLightLevel(makeToken({ x: 15 })),
    TokenLightingService.LEVELS.DIM
  );

  setCanvas();
  assert.equal(
    TokenLightingService.getLightLevel(makeToken({ x: 5 })),
    TokenLightingService.LEVELS.DARK
  );
});

test("darkness wins over overlapping positive light", () => {
  globalThis.game = { release: { generation: 13 } };
  setCanvas({
    darkness: true,
    lightSources: [makeLocalLight({ bright: 10 })]
  });

  assert.equal(
    TokenLightingService.getLightLevel(makeToken({ x: 5 })),
    TokenLightingService.LEVELS.DARK
  );
});

test("classifies bright and dim global illumination", () => {
  globalThis.game = { release: { generation: 13 } };
  const globalLightSource = {
    active: true,
    data: { bright: 1 }
  };
  setCanvas({ globalLightSource, insideGlobalLight: true });

  assert.equal(
    TokenLightingService.getLightLevel(makeToken()),
    TokenLightingService.LEVELS.BRIGHT
  );

  setCanvas({
    globalLightSource,
    insideGlobalLight: true,
    lightSources: [makeLocalLight({ bright: 1 })]
  });
  assert.equal(
    TokenLightingService.getLightLevel(makeToken({ x: 5 })),
    TokenLightingService.LEVELS.BRIGHT
  );

  globalLightSource.data.bright = 0;
  setCanvas({ globalLightSource, insideGlobalLight: true });
  assert.equal(
    TokenLightingService.getLightLevel(makeToken()),
    TokenLightingService.LEVELS.DIM
  );
});

test("returns null when token or canvas lighting is unavailable", () => {
  globalThis.game = { release: { generation: 13 } };
  globalThis.canvas = null;
  assert.equal(TokenLightingService.getLightLevel(makeToken()), null);

  globalThis.canvas = { effects: null };
  assert.equal(TokenLightingService.getLightLevel(makeToken()), null);

  setCanvas();
  assert.equal(TokenLightingService.getLightLevel(null), null);
});

test("v13 ignores vertical distance while v14 applies the bright-light cylinder", () => {
  const elevatedToken = makeToken({ x: 5, elevation: 20 });
  const light = makeLocalLight({ bright: 10 });
  setCanvas({ lightSources: [light] });

  globalThis.game = { release: { generation: 13 } };
  assert.equal(
    TokenLightingService.getLightLevel(elevatedToken),
    TokenLightingService.LEVELS.BRIGHT
  );

  globalThis.game.release.generation = 14;
  TokenLightingService.invalidateCache();
  assert.equal(
    TokenLightingService.getLightLevel(elevatedToken),
    TokenLightingService.LEVELS.DIM
  );

  const nearbyElevation = makeToken({ x: 5, elevation: 5 });
  assert.equal(
    TokenLightingService.getLightLevel(nearbyElevation),
    TokenLightingService.LEVELS.BRIGHT
  );
});

test("caches classification per token until lighting is invalidated", () => {
  globalThis.game = { release: { generation: 13 } };
  let pointTests = 0;
  const light = makeLocalLight({ bright: 10 });
  light.testPoint = () => {
    pointTests += 1;
    return true;
  };
  setCanvas({ lightSources: [light] });
  const token = makeToken({ x: 5 });

  assert.equal(TokenLightingService.getLightLevel(token), TokenLightingService.LEVELS.BRIGHT);
  assert.equal(TokenLightingService.getLightLevel(token), TokenLightingService.LEVELS.BRIGHT);
  assert.equal(pointTests, 1);

  TokenLightingService.invalidateCache();
  assert.equal(TokenLightingService.getLightLevel(token), TokenLightingService.LEVELS.BRIGHT);
  assert.equal(pointTests, 2);
});
