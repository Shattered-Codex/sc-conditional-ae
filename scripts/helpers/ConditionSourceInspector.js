const REGEX_PREFIX_KEYWORDS = new Set([
  "case", "delete", "do", "else", "in", "instanceof", "new", "of",
  "return", "throw", "typeof", "void", "yield"
]);

export class ConditionSourceInspector {
  static #cache = new Map();
  static #CACHE_LIMIT = 200;

  static usesIdentifier(source, identifier) {
    const text = String(source ?? "");
    const name = String(identifier ?? "");
    const cacheKey = `${name}\u0000${text}`;
    const cached = ConditionSourceInspector.#cache.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    const result = name.length > 0 && ConditionSourceInspector.#scanCode(text, name).found;
    if (ConditionSourceInspector.#cache.size >= ConditionSourceInspector.#CACHE_LIMIT) {
      ConditionSourceInspector.#cache.delete(ConditionSourceInspector.#cache.keys().next().value);
    }
    ConditionSourceInspector.#cache.set(cacheKey, result);
    return result;
  }

  static #scanCode(source, identifier, start = 0, stopAtClosingBrace = false) {
    let index = start;
    let braceDepth = 0;
    let previousToken = null;
    let canStartRegex = true;

    while (index < source.length) {
      const character = source[index];
      const next = source[index + 1];

      if (/\s/.test(character)) {
        index += 1;
        continue;
      }
      if (character === "/" && next === "/") {
        index = ConditionSourceInspector.#skipLineComment(source, index + 2);
        continue;
      }
      if (character === "/" && next === "*") {
        index = ConditionSourceInspector.#skipBlockComment(source, index + 2);
        continue;
      }
      if (character === "'" || character === '"') {
        const expressionArgument = ConditionSourceInspector.#isDaeExpressionArgument(source, index);
        const end = ConditionSourceInspector.#skipQuoted(source, index + 1, character);
        if (expressionArgument) {
          const contentEnd = source[end - 1] === character ? end - 1 : end;
          const content = source.slice(index + 1, contentEnd)
            .replaceAll(`\\${character}`, character)
            .replaceAll("\\\\", "\\");
          if (ConditionSourceInspector.#scanCode(content, identifier).found) {
            return { found: true, index: end };
          }
        }
        index = end;
        previousToken = "value";
        canStartRegex = false;
        continue;
      }
      if (character === "`") {
        const expressionArgument = ConditionSourceInspector.#isDaeExpressionArgument(source, index);
        const template = ConditionSourceInspector.#scanTemplate(source, identifier, index + 1);
        if (template.found) {
          return template;
        }
        if (expressionArgument) {
          const contentEnd = source[template.index - 1] === "`" ? template.index - 1 : template.index;
          if (ConditionSourceInspector.#scanCode(source.slice(index + 1, contentEnd), identifier).found) {
            return { found: true, index: template.index };
          }
        }
        index = template.index;
        previousToken = "value";
        canStartRegex = false;
        continue;
      }
      if (character === "/" && canStartRegex) {
        index = ConditionSourceInspector.#skipRegex(source, index + 1);
        previousToken = "value";
        canStartRegex = false;
        continue;
      }
      if (ConditionSourceInspector.#isIdentifierStart(character)) {
        const wordStart = index;
        index += 1;
        while (ConditionSourceInspector.#isIdentifierPart(source[index])) {
          index += 1;
        }

        const word = source.slice(wordStart, index);
        const nextToken = ConditionSourceInspector.#nextSignificantCharacter(source, index);
        const isMemberProperty = previousToken === ".";
        const isObjectKey = (previousToken === "{" || previousToken === ",") && nextToken === ":";
        if (word === identifier && !isMemberProperty && !isObjectKey) {
          return { found: true, index };
        }

        previousToken = word;
        canStartRegex = REGEX_PREFIX_KEYWORDS.has(word);
        continue;
      }
      if (/\d/.test(character)) {
        index += 1;
        while (/[\w.]/.test(source[index] ?? "")) {
          index += 1;
        }
        previousToken = "value";
        canStartRegex = false;
        continue;
      }
      if (character === "{") {
        braceDepth += 1;
        previousToken = character;
        canStartRegex = true;
        index += 1;
        continue;
      }
      if (character === "}") {
        if (stopAtClosingBrace && braceDepth === 0) {
          return { found: false, index };
        }
        braceDepth = Math.max(0, braceDepth - 1);
        previousToken = character;
        canStartRegex = false;
        index += 1;
        continue;
      }

      previousToken = character;
      canStartRegex = ![")", "]", "."].includes(character);
      index += 1;
    }
    return { found: false, index };
  }

  static #scanTemplate(source, identifier, start) {
    let index = start;
    while (index < source.length) {
      if (source[index] === "\\") {
        index += 2;
        continue;
      }
      if (source[index] === "`") {
        return { found: false, index: index + 1 };
      }
      if (source[index] === "$" && source[index + 1] === "{") {
        const expression = ConditionSourceInspector.#scanCode(source, identifier, index + 2, true);
        if (expression.found) {
          return expression;
        }
        index = expression.index + 1;
        continue;
      }
      index += 1;
    }
    return { found: false, index };
  }

  static #skipQuoted(source, start, quote) {
    let index = start;
    while (index < source.length) {
      if (source[index] === "\\") {
        index += 2;
      } else if (source[index] === quote) {
        return index + 1;
      } else {
        index += 1;
      }
    }
    return index;
  }

  static #skipRegex(source, start) {
    let index = start;
    let inCharacterClass = false;
    while (index < source.length) {
      const character = source[index];
      if (character === "\\") {
        index += 2;
        continue;
      }
      if (character === "[") inCharacterClass = true;
      else if (character === "]") inCharacterClass = false;
      else if (character === "/" && !inCharacterClass) {
        index += 1;
        while (/[a-z]/i.test(source[index] ?? "")) index += 1;
        return index;
      } else if (character === "\n" || character === "\r") {
        return index;
      }
      index += 1;
    }
    return index;
  }

  static #skipLineComment(source, start) {
    const end = source.indexOf("\n", start);
    return end === -1 ? source.length : end + 1;
  }

  static #skipBlockComment(source, start) {
    const end = source.indexOf("*/", start);
    return end === -1 ? source.length : end + 2;
  }

  static #nextSignificantCharacter(source, start) {
    let index = start;
    while (/\s/.test(source[index] ?? "")) index += 1;
    return source[index] ?? "";
  }

  static #isDaeExpressionArgument(source, quoteIndex) {
    return /\bdae\s*\.\s*(?:eval|roll)\s*\(\s*$/.test(source.slice(0, quoteIndex));
  }

  static #isIdentifierStart(character) {
    return typeof character === "string" && /[A-Za-z_$]/.test(character);
  }

  static #isIdentifierPart(character) {
    return typeof character === "string" && /[A-Za-z0-9_$]/.test(character);
  }
}
