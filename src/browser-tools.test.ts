import { describe, expect, it } from "vitest";
import { diffOutline } from "../browser-extension/src/outline.js";
import { BROWSER_TOOLS, formatResult, type BrowserTool } from "./browser-tools.js";

function tool(name: string): BrowserTool {
  const found = BROWSER_TOOLS.find((entry) => entry.name === name);
  if (found === undefined) throw new Error(`no ${name}`);
  return found;
}

const page = { url: "https://shop.example.com/cart", title: "Cart" };

describe("browser action results", () => {
  it("names the target, lists the changes, and ends with the page", () => {
    expect(
      formatResult(tool("browser_click"), {
        target: '[e4] button "Remove"',
        route: "trusted",
        ...page,
        changes: { added: ["Your cart is empty"], removed: ['[e4] button "Remove"', "Socks 1 × €9"] },
      }),
    ).toBe(
      [
        'Clicked [e4] button "Remove"',
        "",
        "Changes:",
        '- [e4] button "Remove"',
        "- Socks 1 × €9",
        "+ Your cart is empty",
        "",
        "Page: Cart — https://shop.example.com/cart",
      ].join("\n"),
    );
  });

  it("says when nothing changed, and what to try", () => {
    const text = formatResult(tool("browser_click"), { target: '[e2] button "Save"', ...page, changes: { added: [], removed: [] } });
    expect(text).toMatch(/did not change\. .*wait_for.*browser_screenshot/);
  });

  it("shows the new outline when most of the page changed", () => {
    const text = formatResult(tool("browser_navigate"), { ...page, changes: { added: [], removed: [], outline: "# Cart\n[e30] button \"Pay\"", truncated: true } });
    expect(text).toContain('The page changed; its outline now:\n# Cart\n[e30] button "Pay"\n(Cut short: browser_read for the rest.)');
  });

  it("tells the agent to answer a dialog, and leaves out changes it cannot have yet", () => {
    const text = formatResult(tool("browser_click"), {
      target: '[e7] button "Delete"',
      ...page,
      dialog: { type: "prompt", message: "Type DELETE to confirm", default_prompt: "" },
    });
    expect(text).toContain('The page opened a prompt dialog: "Type DELETE to confirm".');
    expect(text).toContain("call browser_dialog with accept true or false, and text for the answer");
    expect(text).not.toContain("did not change");
    const answered = formatResult(tool("browser_dialog"), { answered: { type: "prompt", accepted: true }, ...page, changes: { added: ["Deleted"], removed: [] } });
    expect(answered).toMatch(/^Accepted the prompt dialog\.\n\nChanges:\n\+ Deleted/);
  });

  it("reports new tabs, a held-back file picker, and wait_for", () => {
    const text = formatResult(tool("browser_click"), {
      target: '[e3] link "Terms"',
      ...page,
      changes: { added: [], removed: [] },
      opened_tabs: [{ tab_id: 41, title: "Terms", url: "https://shop.example.com/terms" }],
      file_chooser: { multiple: true },
      wait_for: { text: "Uploaded", found: false },
    });
    expect(text).toContain("It opened tab 41: Terms — https://shop.example.com/terms, in the background");
    expect(text).toContain("file picker for several files, which the extension held back: call browser_upload without ref");
    expect(text).toContain('"Uploaded" did not appear within 10 s.');
    expect(text).not.toContain("did not change");
  });

  it("reports typed values, chosen options, filled fields and files", () => {
    expect(formatResult(tool("browser_type"), { target: '[e1] textbox "Email"', value: "ada@example.com", ...page })).toContain(
      'The field now holds "ada@example.com".',
    );
    expect(formatResult(tool("browser_fill"), { fields: [{ ref: "e1", value: "Ada" }, { ref: "e2", value: "checked" }], ...page })).toContain(
      'Filled e1 = "Ada", e2 = "checked".',
    );
    expect(formatResult(tool("browser_upload"), { files: ["a.csv", "b.csv"] })).toBe("The input holds a.csv, b.csv.");
  });

  it("formats reads, tabs and the other answers as text", () => {
    expect(formatResult(tool("browser_read"), { text: "Title: Cart", nextOffset: null, wait_for: { text: "Paid", found: false } })).toBe(
      '("Paid" did not appear within 10 s; this is the page as it is.)\n\nTitle: Cart',
    );
    expect(
      formatResult(tool("browser_tabs"), {
        paused: false,
        tabs: [
          { tab_id: 1, title: "Mail", url: "https://mail.example.com/", active: true },
          { tab_id: 2, title: "", url: "about:blank", active: false, dialog: { type: "alert", message: "Hi", default_prompt: "" } },
        ],
      }),
    ).toBe(
      "- tab 1: Mail — https://mail.example.com/ (in front)\n- tab 2: (untitled) — about:blank (shows a dialog: answer it with browser_dialog)",
    );
    expect(formatResult(tool("browser_open"), { tab_id: 5, title: "Example", url: "https://example.com/" })).toBe(
      "Opened tab 5: Example — https://example.com/, in the background.",
    );
    expect(formatResult(tool("browser_close"), { closed: 5 })).toBe("Closed tab 5.");
  });
});

describe("outline changes", () => {
  it("compares lines as multisets, so moved lines are no change", () => {
    expect(diffOutline(["a", "b", "c"], ["c", "a", "b"], false)).toEqual({ added: [], removed: [] });
    expect(diffOutline(["- Row 1"], ["- Row 1", "- Row 1"], false)).toEqual({ added: ["- Row 1"], removed: [] });
  });

  it("gives the new outline after a navigation or a mostly new page", () => {
    expect(diffOutline(["# Old", "x"], ["# New", "y", "z"], true)).toEqual({ added: [], removed: [], outline: "# New\ny\nz" });
    const before = Array.from({ length: 50 }, (_, index) => `old ${index}`);
    const after = Array.from({ length: 30 }, (_, index) => `new ${index}`);
    expect(diffOutline(before, after, false).outline).toBe(after.join("\n"));
    expect(diffOutline(null, ["# Page"], false).outline).toBe("# Page");
  });

  it("cuts long change lists short and says so", () => {
    const before = Array.from({ length: 200 }, (_, index) => `row ${index}`);
    const after = [...before.slice(50), "- new"];
    const changes = diffOutline(before, after, false);
    expect(changes.removed).toHaveLength(40);
    expect(changes.added).toEqual(["- new"]);
    expect(changes.truncated).toBe(true);
  });
});
