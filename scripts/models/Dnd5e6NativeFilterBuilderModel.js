export class Dnd5e6NativeFilterBuilderModel {
  static GROUP_OPERATORS = Object.freeze(["AND", "NAND", "OR", "NOR", "XOR", "NOT"]);
  static COMPARISON_OPERATORS = Object.freeze([
    "exact", "contains", "icontains", "startswith", "istartswith", "endswith", "iendswith",
    "empty", "has", "hasany", "hasall", "subsetof", "in", "gt", "gte", "lt", "lte"
  ]);

  /**
   * The glyphs dnd5e 6 prints in its own filter breakdown. Reusing them keeps the
   * builder readable next to the native `filters-input` summary.
   */
  static OPERATOR_SYMBOLS = Object.freeze({
    exact: "=",
    gt: ">",
    gte: "\u2265",
    lt: "<",
    lte: "\u2264",
    empty: "\u2205",
    contains: "\u2287",
    icontains: "\u2287",
    startswith: "\u22de",
    istartswith: "\u22de",
    endswith: "\u22df",
    iendswith: "\u22df",
    has: "\u220b",
    hasany: "\u220b",
    hasall: "\u220b",
    subsetof: "\u2286",
    in: "\u2208",
    AND: "\u2227",
    NAND: "\u22bc",
    OR: "\u2228",
    NOR: "\u22bd",
    XOR: "\u22bb",
    NOT: "\u00ac"
  });

  /** Comparison operators grouped into the `<optgroup>` sections the editor renders. */
  static COMPARISON_OPERATOR_CATEGORIES = Object.freeze([
    Object.freeze({ id: "value", operators: Object.freeze(["exact", "gt", "gte", "lt", "lte", "empty"]) }),
    Object.freeze({
      id: "text",
      operators: Object.freeze([
        "contains", "icontains", "startswith", "istartswith", "endswith", "iendswith"
      ])
    }),
    Object.freeze({ id: "collection", operators: Object.freeze(["has", "hasany", "hasall", "subsetof", "in"]) })
  ]);

  static symbolFor(operator) {
    return Dnd5e6NativeFilterBuilderModel.OPERATOR_SYMBOLS[operator] ?? "";
  }

  static parse(source) {
    const definition = typeof source === "string"
      ? JSON.parse(source.trim() || "{}")
      : source;
    return Dnd5e6NativeFilterBuilderModel.#fromDefinition(definition, true);
  }

  static stringify(node) {
    return JSON.stringify(Dnd5e6NativeFilterBuilderModel.toDefinition(node, true), null, 2);
  }

  static toDefinition(node, isRoot = false) {
    if (node?.kind === "condition") {
      return {
        k: String(node.key ?? ""),
        o: String(node.operator || "exact"),
        v: node.value
      };
    }

    const children = Array.from(node?.children ?? []).map(child => (
      Dnd5e6NativeFilterBuilderModel.toDefinition(child, false)
    ));
    if (isRoot && node?.empty && !children.length) return {};
    const operator = Dnd5e6NativeFilterBuilderModel.GROUP_OPERATORS.includes(node?.operator)
      ? node.operator
      : "AND";
    return {
      o: operator,
      v: operator === "NOT" ? (children[0] ?? {}) : children
    };
  }

  static createCondition() {
    return { kind: "condition", key: "", operator: "exact", value: "" };
  }

  /**
   * Remove a child, restoring the root's "no filter" state when it empties.
   * Without this, adding then removing a condition persists {"o":"AND","v":[]}
   * where the user expects the filter to be gone again.
   */
  static removeChild(parent, node, { isRoot = false } = {}) {
    const index = parent?.children?.indexOf(node) ?? -1;
    if (index < 0) {
      return false;
    }

    parent.children.splice(index, 1);
    if (isRoot && !parent.children.length && parent.operator === "AND") {
      parent.empty = true;
    }
    return true;
  }

  static createGroup(operator = "AND") {
    return { kind: "group", operator, children: [], empty: false };
  }

  static setGroupOperator(group, operator) {
    if (operator === "NOT" && group.children.length > 1) {
      // NOT accepts one child: negate the existing group without dropping its
      // conditions or changing how they were combined.
      group.children = [{ ...group }];
    }
    group.operator = operator;
    group.empty = false;
  }

  static addChild(group, child) {
    if (group.operator === "NOT" && group.children.length) {
      group.children = [{
        ...Dnd5e6NativeFilterBuilderModel.createGroup(),
        children: [...group.children, child]
      }];
    } else {
      group.children.push(child);
    }
    group.empty = false;
  }

  static normalizeValueForOperator(operator, value) {
    return operator === "empty" && value === "" ? true : value;
  }

  static parseValue(source) {
    const value = String(source ?? "").trim();
    if (!value.length) return "";
    try {
      return JSON.parse(value);
    } catch {
      return String(source ?? "");
    }
  }

  static formatValue(value) {
    const serialized = JSON.stringify(value);
    return serialized === undefined ? "" : serialized;
  }

  static #fromDefinition(definition, isRoot = false) {
    if (Array.isArray(definition)) {
      return {
        kind: "group",
        operator: "AND",
        children: definition.map(entry => Dnd5e6NativeFilterBuilderModel.#fromDefinition(entry)),
        empty: isRoot && definition.length === 0
      };
    }

    if (!definition || typeof definition !== "object") {
      throw new Error("A filter definition must be an object or array.");
    }

    if (isRoot && Object.keys(definition).length === 0) {
      return { kind: "group", operator: "AND", children: [], empty: true };
    }

    const operator = String(definition.o ?? "exact");
    if (Dnd5e6NativeFilterBuilderModel.GROUP_OPERATORS.includes(operator)) {
      if (operator !== "NOT" && !Array.isArray(definition.v)) {
        throw new Error(`Group operator ${operator} requires an array value.`);
      }
      if (operator === "NOT" && definition.v === undefined) {
        throw new Error("Group operator NOT requires a child value.");
      }
      const entries = operator === "NOT"
        ? (Array.isArray(definition.v) ? definition.v.slice(0, 1) : [definition.v])
        : (Array.isArray(definition.v) ? definition.v : []);
      return {
        kind: "group",
        operator,
        children: entries
          .filter(entry => entry !== undefined)
          .map(entry => Dnd5e6NativeFilterBuilderModel.#fromDefinition(entry)),
        empty: false
      };
    }

    if (!("k" in definition) && !Dnd5e6NativeFilterBuilderModel.COMPARISON_OPERATORS.includes(operator)) {
      throw new Error(`Unsupported group operator: ${operator}`);
    }

    const condition = {
      kind: "condition",
      key: String(definition.k ?? ""),
      operator,
      value: definition.v
    };
    return isRoot
      ? { kind: "group", operator: "AND", children: [condition], empty: false }
      : condition;
  }
}
