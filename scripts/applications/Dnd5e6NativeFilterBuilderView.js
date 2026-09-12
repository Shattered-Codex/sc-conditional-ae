import { Dnd5e6AttributeLabel } from "../helpers/Dnd5e6AttributeLabel.js";
import { Dnd5e6NativeFilterBuilderModel as FilterModel } from "../models/Dnd5e6NativeFilterBuilderModel.js";

export class Dnd5e6NativeFilterBuilderView {
  #builder;
  #rawEditor;
  #root;
  #strings;
  #onChange;
  #actor;

  constructor({ builder, rawEditor, source, strings, onChange, actor = null }) {
    this.#builder = builder;
    this.#rawEditor = rawEditor;
    this.#strings = strings;
    this.#onChange = onChange;
    this.#actor = actor;
    this.#root = FilterModel.parse(source);
    this.#render();
  }

  showBuilder() {
    this.#root = FilterModel.parse(this.#rawEditor.value);
    this.#render();
  }

  #render() {
    this.#builder.replaceChildren(this.#buildNode(this.#root, null));
  }

  #buildNode(node, parent) {
    const card = this.#element("div", `sc-cae-filter-node sc-cae-filter-node--${node.kind}`);
    card.append(node.kind === "condition" ? this.#buildCondition(node, parent) : this.#buildGroup(node, parent));
    return card;
  }

  #buildCondition(node, parent) {
    const row = this.#element("div", "sc-cae-filter-row sc-cae-filter-condition");
    row.dataset.scCaeOperator = node.operator;

    const keyCell = this.#element("div", "sc-cae-filter-cell sc-cae-filter-cell--key");
    const key = this.#input(node.key, this.#strings.keyPlaceholder, value => {
      node.key = value;
      this.#updateKeyLabel(row, value);
      this.#sync();
    });
    key.classList.add("sc-cae-filter-key");
    key.setAttribute("aria-label", this.#strings.attributeColumn);
    keyCell.append(key);

    const operatorCell = this.#element("div", "sc-cae-filter-cell sc-cae-filter-cell--operator");
    const operator = this.#comparisonSelect(node.operator, value => {
      node.operator = value;
      node.value = FilterModel.normalizeValueForOperator(value, node.value);
      this.#sync();
      this.#render();
    });
    operator.setAttribute("aria-label", this.#strings.comparisonOperator);
    operatorCell.append(operator);

    const valueCell = this.#element("div", "sc-cae-filter-cell sc-cae-filter-cell--value");
    const value = this.#input(FilterModel.formatValue(node.value), this.#strings.valuePlaceholder, input => {
      node.value = FilterModel.parseValue(input);
      this.#sync();
    });
    value.classList.add("sc-cae-filter-value");
    value.setAttribute("aria-label", this.#strings.valueColumn);
    valueCell.append(value);

    const actionCell = this.#element("div", "sc-cae-filter-cell sc-cae-filter-cell--actions");
    actionCell.append(this.#removeButton(node, parent));

    // The readable name is its own grid row under the key. Nesting it inside the
    // key cell made that cell taller than its siblings, and the row's centring
    // then lifted the key input above the operator and value inputs.
    const keyLabel = this.#element("span", "sc-cae-filter-key__label");
    row.append(keyCell, operatorCell, valueCell, actionCell, keyLabel);
    this.#updateKeyLabel(row, node.key);
    return row;
  }

  #buildGroup(node, parent) {
    const wrapper = this.#element("div", "sc-cae-filter-group");
    wrapper.dataset.scCaeOperator = node.operator;

    const header = this.#element("div", "sc-cae-filter-group__header");
    const match = this.#element("label", "sc-cae-filter-group__match");
    const matchLabel = this.#element("span", "sc-cae-filter-group__match-label");
    matchLabel.textContent = this.#strings.matchLabel;
    const operator = this.#groupSelect(node.operator, value => {
      node.operator = value;
      if (value === "NOT" && node.children.length > 1) node.children.splice(1);
      node.empty = false;
      this.#sync();
      this.#render();
    });
    operator.setAttribute("aria-label", this.#strings.groupOperator);
    match.append(matchLabel, operator);

    const controls = this.#element("div", "sc-cae-filter-group__controls");
    controls.append(
      this.#actionButton("fa-plus", this.#strings.addCondition, () => {
        if (node.operator === "NOT") node.children.splice(0);
        node.children.push(FilterModel.createCondition());
        node.empty = false;
        this.#syncAndRender();
      }),
      this.#actionButton("fa-folder-plus", this.#strings.addGroup, () => {
        if (node.operator === "NOT") node.children.splice(0);
        node.children.push(FilterModel.createGroup());
        node.empty = false;
        this.#syncAndRender();
      })
    );
    if (parent) controls.append(this.#removeButton(node, parent));
    header.append(match, controls);

    const children = this.#element("div", "sc-cae-filter-group__children");
    if (node.children.some(child => child.kind === "condition")) children.append(this.#buildColumnHeader());
    for (const child of node.children) children.append(this.#buildNode(child, node));
    if (!node.children.length) {
      const empty = this.#element("p", "hint sc-cae-filter-empty");
      empty.textContent = this.#strings.empty;
      children.append(empty);
    }

    wrapper.append(header, children);
    return wrapper;
  }

  /** A single label row so every condition below it reads as an aligned table. */
  #buildColumnHeader() {
    const header = this.#element("div", "sc-cae-filter-row sc-cae-filter-columns");
    for (const label of [this.#strings.attributeColumn, this.#strings.operatorColumn, this.#strings.valueColumn]) {
      const cell = this.#element("span", "sc-cae-filter-cell");
      cell.textContent = label;
      header.append(cell);
    }
    header.append(this.#element("span", "sc-cae-filter-cell sc-cae-filter-cell--actions"));
    return header;
  }

  #updateKeyLabel(row, key) {
    const label = row.querySelector(".sc-cae-filter-key__label");
    if (!label) return;
    const readable = Dnd5e6AttributeLabel.resolve(key, { actor: this.#actor });
    label.textContent = readable ?? "";
    label.hidden = !readable;
  }

  #element(tag, className) {
    const element = this.#builder.ownerDocument.createElement(tag);
    element.className = className;
    return element;
  }

  #input(value, placeholder, onInput) {
    const input = this.#builder.ownerDocument.createElement("input");
    input.type = "text";
    input.value = value;
    input.placeholder = placeholder;
    input.addEventListener("input", () => onInput(input.value));
    return input;
  }

  #groupSelect(value, onChange) {
    const select = this.#element("select", "sc-cae-filter-operator sc-cae-filter-operator--group");
    for (const operator of FilterModel.GROUP_OPERATORS) {
      select.append(this.#option(operator, this.#strings.groupOperators?.[operator], value));
    }
    this.#appendUnknownOption(select, FilterModel.GROUP_OPERATORS, value);
    select.addEventListener("change", () => onChange(select.value));
    return select;
  }

  #comparisonSelect(value, onChange) {
    const select = this.#element("select", "sc-cae-filter-operator sc-cae-filter-operator--comparison");
    for (const category of FilterModel.COMPARISON_OPERATOR_CATEGORIES) {
      const group = this.#builder.ownerDocument.createElement("optgroup");
      group.label = this.#strings.comparisonCategories?.[category.id] ?? category.id;
      for (const operator of category.operators) {
        group.append(this.#option(operator, this.#strings.comparisonOperators?.[operator], value));
      }
      select.append(group);
    }
    this.#appendUnknownOption(select, FilterModel.COMPARISON_OPERATORS, value);
    select.addEventListener("change", () => onChange(select.value));
    return select;
  }

  #option(operator, label, selected) {
    const option = this.#builder.ownerDocument.createElement("option");
    const symbol = FilterModel.symbolFor(operator);
    option.value = operator;
    option.textContent = symbol ? `${symbol}  ${label ?? operator}` : (label ?? operator);
    option.selected = operator === selected;
    return option;
  }

  /** Keep an operator a module or a future dnd5e release added, instead of silently rewriting it. */
  #appendUnknownOption(select, known, value) {
    if (known.includes(value)) return;
    const option = this.#builder.ownerDocument.createElement("option");
    option.value = value;
    option.textContent = value;
    option.selected = true;
    select.append(option);
  }

  #removeButton(node, parent) {
    const button = this.#actionButton("fa-trash", this.#strings.remove, () => {
      if (!parent) return;
      if (!FilterModel.removeChild(parent, node, { isRoot: parent === this.#root })) return;
      this.#syncAndRender();
    });
    button.classList.add("sc-cae-filter-control--danger");
    button.disabled = !parent;
    return button;
  }

  #actionButton(icon, label, onClick) {
    const button = this.#builder.ownerDocument.createElement("button");
    button.type = "button";
    button.className = `sc-cae-filter-control icon fa-solid ${icon}`;
    button.dataset.tooltip = label;
    button.setAttribute("aria-label", label);
    button.addEventListener("click", event => {
      event.preventDefault();
      onClick();
    });
    return button;
  }

  #syncAndRender() {
    this.#sync();
    this.#render();
  }

  #sync() {
    this.#rawEditor.value = FilterModel.stringify(this.#root);
    this.#onChange?.();
  }
}
