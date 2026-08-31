export class ConditionSourceInspector {
  static #cache = new Map();
  static #CACHE_LIMIT = 200;

  static usesIdentifier(source, identifier) {
    const text = String(source ?? "");
    const cacheKey = `${identifier}\u0000${text}`;
    const cached = ConditionSourceInspector.#cache.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    const code = text.replace(
      /\/\*[\s\S]*?\*\/|\/\/[^\r\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g,
      match => " ".repeat(match.length)
    );
    const result = new RegExp(`\\b${identifier}\\b`).test(code);
    if (ConditionSourceInspector.#cache.size >= ConditionSourceInspector.#CACHE_LIMIT) {
      ConditionSourceInspector.#cache.delete(ConditionSourceInspector.#cache.keys().next().value);
    }
    ConditionSourceInspector.#cache.set(cacheKey, result);
    return result;
  }
}
