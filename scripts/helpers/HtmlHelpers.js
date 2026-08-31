export class HtmlHelpers {
  static escape(value) {
    const element = document.createElement("div");
    element.textContent = String(value ?? "");
    return element.innerHTML;
  }

  static escapeAttribute(value) {
    return HtmlHelpers.escape(value).replaceAll('"', "&quot;").replaceAll("'", "&#39;");
  }
}
