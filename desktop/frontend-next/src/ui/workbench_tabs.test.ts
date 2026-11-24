import { describe, expect, it } from "vitest";
import { labelOf, pageTitle } from "./workbench_tabs";

// A tab that has no page yet sits on the shell's own placeholder, not on an
// address. Naming it after that token reads as a broken tab rather than an
// empty one.
describe("the name a browser tab shows", () => {
  it("uses the page's own title once it has one", () => {
    expect(pageTitle({ title: "Example Domain", url: "https://example.com/" })).toBe("Example Domain");
  });

  it("calls an unloaded page the blank page, not the token it parks on", () => {
    expect(pageTitle({ title: "", url: "about:blank" })).toBe("空白页");
    expect(pageTitle({ title: "   ", url: "about:blank" })).toBe("空白页");
    expect(pageTitle({ title: "", url: "reasonix://start" })).toBe("空白页");
  });

  it("falls back to a real address when a page has no title", () => {
    expect(pageTitle({ title: "", url: "https://example.com/a" })).toBe("https://example.com/a");
  });

  it("reads an empty tab as blank, title or not", () => {
    expect(pageTitle({})).toBe("空白页");
    expect(pageTitle({ title: "", url: "  " })).toBe("空白页");
  });

  it("is what the workbench strip names a browser surface by", () => {
    expect(labelOf({ kind: "browser", tab: { id: "t", target: "v", url: "about:blank", title: "", active: true } }, {})).toBe("空白页");
    expect(labelOf({ kind: "browser", tab: { id: "t", target: "v", url: "https://a.test/", title: "A", active: true } }, {})).toBe("A");
  });
});
