/**
 * Functions that run inside a page, in the extension's isolated world. Each is
 * serialized with Function.prototype.toString, so it must not reference
 * anything outside its own body, except `pageRoots` and `findRef`: background.ts
 * defines both in the page ahead of every call.
 */

/** The document and every open shadow root in it, the document first. */
export function pageRoots(): Array<Document | ShadowRoot> {
  const roots: Array<Document | ShadowRoot> = [document];
  for (const root of roots) {
    for (const element of Array.from(root.querySelectorAll("*"))) {
      if (element.shadowRoot !== null) roots.push(element.shadowRoot);
    }
  }
  return roots;
}

/** The element carrying a snapshot ref, in the document or any open shadow root. */
export function findRef(ref: string): Element | null {
  const selector = `[data-agent-ref="${CSS.escape(ref)}"]`;
  for (const root of pageRoots()) {
    const found = root.querySelector(selector);
    if (found !== null) return found;
  }
  return null;
}

export interface SnapshotOptions {
  query: string | null;
  offset: number;
  maxChars: number;
}

export interface SnapshotResult {
  text: string;
  total: number;
  nextOffset: number | null;
  refs: number;
}

/** A text outline of the page; interactive elements get a `[eN]` ref stored in `data-agent-ref`. */
export function snapshotPage(options: SnapshotOptions): SnapshotResult {
  const ATTRIBUTE = "data-agent-ref";
  const INTERACTIVE = new Set([
    "button", "link", "checkbox", "radio", "tab", "menuitem", "menuitemcheckbox", "menuitemradio", "option",
    "switch", "combobox", "listbox", "textbox", "searchbox", "slider", "spinbutton", "treeitem", "file",
  ]);
  const SPECIAL =
    "a[href],button,input:not([type=hidden]),select,textarea,summary,[role],[contenteditable=''],[contenteditable=true],h1,h2,h3,h4,h5,h6,table,ul,ol";
  const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "HEAD", "META", "LINK", "SVG", "IFRAME", "CANVAS"]);
  const MAX_LINES = 4000;

  for (const root of pageRoots()) {
    for (const element of Array.from(root.querySelectorAll(`[${ATTRIBUTE}]`))) element.removeAttribute(ATTRIBUTE);
  }

  const lines: string[] = [];
  let refs = 0;

  const clean = (value: string | null | undefined, limit: number): string => {
    const text = (value ?? "").replace(/\s+/g, " ").trim();
    return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
  };
  const quoted = (value: string): string => JSON.stringify(value);

  const isVisible = (element: Element): boolean => {
    if (element.getAttribute("aria-hidden") === "true") return false;
    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") return false;
    if (style.display === "contents") return true;
    return element.getClientRects().length > 0;
  };

  const roleOf = (element: Element): string | null => {
    const explicit = element.getAttribute("role");
    if (explicit !== null && explicit.trim() !== "") return explicit.trim().split(/\s+/)[0] ?? null;
    const tag = element.tagName;
    if (tag === "A" && element.hasAttribute("href")) return "link";
    if (tag === "BUTTON" || tag === "SUMMARY") return "button";
    if (tag === "SELECT") return (element as HTMLSelectElement).multiple ? "listbox" : "combobox";
    if (tag === "TEXTAREA") return "textbox";
    if (tag === "INPUT") {
      const type = ((element as HTMLInputElement).type || "text").toLowerCase();
      if (type === "hidden") return null;
      if (["button", "submit", "reset", "image"].includes(type)) return "button";
      if (type === "checkbox" || type === "radio") return type;
      if (type === "range") return "slider";
      if (type === "number") return "spinbutton";
      if (type === "search") return "searchbox";
      if (type === "file") return "file";
      return "textbox";
    }
    if ((element as HTMLElement).isContentEditable && element.hasAttribute("contenteditable")) return "textbox";
    if (/^H[1-6]$/.test(tag)) return "heading";
    return null;
  };

  const nameOf = (element: Element): string => {
    const label = element.getAttribute("aria-label");
    if (label !== null && label.trim() !== "") return label;
    const labelledBy = element.getAttribute("aria-labelledby");
    if (labelledBy !== null) {
      const text = labelledBy
        .split(/\s+/)
        .map((id) => (document.getElementById(id) as HTMLElement | null)?.innerText ?? "")
        .join(" ");
      if (text.trim() !== "") return text;
    }
    const labels = (element as HTMLInputElement).labels;
    if (labels !== null && labels !== undefined && labels.length > 0) {
      return Array.from(labels)
        .map((entry) => entry.innerText)
        .join(" ");
    }
    if (element.tagName === "INPUT") {
      const input = element as HTMLInputElement;
      if (["button", "submit", "reset"].includes(input.type)) return input.value;
      return input.placeholder || input.title || input.name || "";
    }
    if (element.tagName === "TEXTAREA") {
      const area = element as HTMLTextAreaElement;
      return area.placeholder || area.title || area.name || "";
    }
    if (element.tagName === "SELECT") return element.getAttribute("title") ?? (element as HTMLSelectElement).name;
    const text = (element as HTMLElement).innerText;
    if (text !== undefined && text.trim() !== "") return text;
    return element.getAttribute("title") ?? element.querySelector("img[alt]")?.getAttribute("alt") ?? "";
  };

  const stateOf = (element: Element, role: string): string => {
    const parts: string[] = [];
    const tag = element.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") {
      const input = element as HTMLInputElement;
      if (input.type === "checkbox" || input.type === "radio") {
        if (input.checked) parts.push("checked");
      } else if (input.type === "password") {
        if (input.value !== "") parts.push("value=(hidden)");
      } else if (input.type !== "file" && input.value !== "") {
        parts.push(`value=${quoted(clean(input.value, 120))}`);
      }
      if (input.disabled) parts.push("disabled");
    } else if (tag === "SELECT") {
      const select = element as HTMLSelectElement;
      const chosen = Array.from(select.selectedOptions).map((option) => clean(option.text, 60));
      if (chosen.length > 0) parts.push(`selected=${quoted(chosen.join(", "))}`);
      const options = Array.from(select.options).map((option) => clean(option.text, 40));
      parts.push(`options=${quoted(options.slice(0, 25).join(" | ") + (options.length > 25 ? " | …" : ""))}`);
      if (select.disabled) parts.push("disabled");
    } else if (role === "textbox" && (element as HTMLElement).isContentEditable) {
      const text = clean((element as HTMLElement).innerText, 120);
      if (text !== "") parts.push(`value=${quoted(text)}`);
    }
    for (const [attribute, word] of [
      ["aria-checked", "checked"],
      ["aria-selected", "selected"],
      ["aria-expanded", "expanded"],
      ["aria-pressed", "pressed"],
    ] as const) {
      const value = element.getAttribute(attribute);
      if (value === "true") parts.push(word);
      if (value === "false" && attribute === "aria-expanded") parts.push("collapsed");
    }
    if (element.getAttribute("aria-disabled") === "true") parts.push("disabled");
    if (tag === "A") {
      const href = element.getAttribute("href") ?? "";
      if (href !== "" && !href.startsWith("javascript:")) parts.push(`href=${quoted(clean(href, 100))}`);
    }
    return parts.length > 0 ? ` ${parts.join(" ")}` : "";
  };

  const push = (line: string): void => {
    if (lines.length < MAX_LINES && line.trim() !== "") lines.push(line);
  };

  const visit = (element: Element): void => {
    if (lines.length >= MAX_LINES || SKIP.has(element.tagName.toUpperCase())) return;
    if (!isVisible(element)) return;
    const role = roleOf(element);
    if (role !== null && INTERACTIVE.has(role)) {
      refs += 1;
      const ref = `e${refs}`;
      element.setAttribute(ATTRIBUTE, ref);
      push(`[${ref}] ${role} ${quoted(clean(nameOf(element), 100))}${stateOf(element, role)}`);
      if (role !== "listbox" && role !== "combobox") return;
      if (element.tagName === "SELECT") return;
    } else if (role === "heading") {
      const level = /^H([1-6])$/.exec(element.tagName)?.[1] ?? element.getAttribute("aria-level") ?? "";
      push(`${"#".repeat(Number(level) || 2)} ${clean((element as HTMLElement).innerText, 200)}`);
      return;
    } else if (element.tagName === "TR" && element.querySelector(SPECIAL) === null) {
      const cells = Array.from(element.children)
        .map((cell) => clean((cell as HTMLElement).innerText, 80))
        .filter((cell) => cell !== "");
      if (cells.length > 0) push(cells.join(" | "));
      return;
    } else if (element.querySelector(SPECIAL) === null && element.shadowRoot === null) {
      const text = clean((element as HTMLElement).innerText, 500);
      if (text !== "") push(element.tagName === "LI" ? `- ${text}` : text);
      return;
    }
    const children = element.shadowRoot !== null ? [element.shadowRoot, element] : [element];
    for (const parent of children) {
      for (const node of Array.from(parent.childNodes)) {
        if (node.nodeType === Node.TEXT_NODE) {
          const text = clean(node.textContent, 300);
          if (text !== "") push(text);
        } else if (node.nodeType === Node.ELEMENT_NODE) {
          visit(node as Element);
        }
      }
    }
  };

  if (document.body !== null) visit(document.body);

  const header = [
    `Title: ${document.title}`,
    `URL: ${location.href}`,
    `Scroll: ${Math.round(scrollY)} of ${Math.max(0, document.documentElement.scrollHeight - innerHeight)} px`,
    "",
  ];
  const query = options.query?.toLowerCase() ?? null;
  const body = query === null ? lines : lines.filter((line) => line.toLowerCase().includes(query));
  const full = [...header, ...body].join("\n");
  const start = Math.max(0, Math.min(options.offset, full.length));
  const end = Math.min(full.length, start + options.maxChars);
  return { text: full.slice(start, end), total: full.length, nextOffset: end < full.length ? end : null, refs };
}

export interface Located {
  found: boolean;
  x: number;
  y: number;
  covered: string | null;
}

/** Scrolls the ref into view and returns its center in viewport CSS pixels. */
export function locateRef(ref: string): Located {
  const element = findRef(ref);
  if (element === null) return { found: false, x: 0, y: 0, covered: null };
  element.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
  const rect = element.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  const hit = document.elementFromPoint(x, y);
  const covered =
    hit === null || hit === element || element.contains(hit) || hit.contains(element)
      ? null
      : `${hit.tagName.toLowerCase()}${hit.id ? `#${hit.id}` : ""}`;
  return { found: true, x, y, covered };
}

/** Clicks through the DOM; the fallback when trusted input is unavailable. */
export function domClick(ref: string): boolean {
  const element = findRef(ref) as HTMLElement | null;
  if (element === null) return false;
  element.focus();
  element.click();
  return true;
}

/** Focuses an editable ref, selecting its content when `replace` is set. */
export function focusRef(args: { ref: string; replace: boolean }): { found: boolean; editable: boolean } {
  const element = findRef(args.ref) as HTMLElement | null;
  if (element === null) return { found: false, editable: false };
  element.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
  element.focus();
  const field = element as HTMLInputElement;
  const isField = element.tagName === "INPUT" || element.tagName === "TEXTAREA";
  if (!isField && !element.isContentEditable) return { found: true, editable: false };
  if (args.replace) {
    if (isField) {
      field.select();
    } else {
      const range = document.createRange();
      range.selectNodeContents(element);
      const selection = getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
  } else if (isField) {
    const end = field.value.length;
    try {
      field.setSelectionRange(end, end);
    } catch {
      // Some input types (email, number) do not support selection ranges.
    }
  }
  return { found: true, editable: true };
}

/** The field's current value; passwords are reported only as set or empty. */
export function readValue(ref: string): { found: boolean; value: string; secret: boolean } {
  const element = findRef(ref) as HTMLElement | null;
  if (element === null) return { found: false, value: "", secret: false };
  const field = element as HTMLInputElement;
  const secret = field.type === "password";
  const value = element.tagName === "INPUT" || element.tagName === "TEXTAREA" ? field.value : element.innerText;
  return { found: true, value: secret ? (value === "" ? "" : "(hidden)") : value, secret };
}

/** Sets a field's value the way a framework sees typing; the fallback when Input.insertText is unavailable. */
export function setValue(args: { ref: string; text: string; replace: boolean }): boolean {
  const element = findRef(args.ref) as HTMLElement | null;
  if (element === null) return false;
  if (element.tagName === "INPUT" || element.tagName === "TEXTAREA") {
    const field = element as HTMLInputElement;
    const prototype = element.tagName === "INPUT" ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    const next = args.replace ? args.text : field.value + args.text;
    if (setter !== undefined) setter.call(field, next);
    else field.value = next;
  } else if (element.isContentEditable) {
    element.innerText = args.replace ? args.text : element.innerText + args.text;
  } else {
    return false;
  }
  element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: args.text }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}

/** Chooses an option of a <select> by its value or visible text. */
export function selectOption(args: { ref: string; option: string }): { found: boolean; chosen: string | null; options: string[] } {
  const element = findRef(args.ref);
  if (element === null || element.tagName !== "SELECT") return { found: element !== null, chosen: null, options: [] };
  const select = element as HTMLSelectElement;
  const options = Array.from(select.options);
  const wanted = args.option.trim().toLowerCase();
  const match =
    options.find((option) => option.value === args.option) ??
    options.find((option) => option.text.trim().toLowerCase() === wanted) ??
    options.find((option) => option.text.trim().toLowerCase().includes(wanted));
  if (match === undefined) return { found: true, chosen: null, options: options.map((option) => option.text.trim()) };
  select.value = match.value;
  select.dispatchEvent(new Event("input", { bubbles: true }));
  select.dispatchEvent(new Event("change", { bubbles: true }));
  return { found: true, chosen: match.text.trim(), options: [] };
}

/** Scrolls the page, or the ref into view. */
export function scrollPage(args: { ref: string | null; deltaY: number }): { found: boolean; scrollY: number } {
  if (args.ref !== null) {
    const element = findRef(args.ref);
    if (element === null) return { found: false, scrollY };
    element.scrollIntoView({ block: "center", behavior: "instant" });
  } else {
    scrollBy({ top: args.deltaY, behavior: "instant" });
  }
  return { found: true, scrollY: Math.round(scrollY) };
}
