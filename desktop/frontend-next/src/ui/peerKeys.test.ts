import { describe, expect, it } from "vitest";
import { heldLabel, peerLabel, peerMeta } from "./peerKeys";

describe("peer keys", () => {
  it("names a session by project and title, falling back to its key", () => {
    expect(peerLabel({ title: "notes", project: "docs", key: "s-1" })).toBe("docs / notes");
    expect(peerLabel({ title: "", project: "docs", key: "s-1" })).toBe("s-1");
  });

  it("says a session's role and whether it is busy", () => {
    expect(peerMeta({})).toEqual([]);
    expect(peerMeta({ purpose: "frontend" })).toEqual(["frontend"]);
    expect(peerMeta({ busy: true })).toEqual(["busy"]);
    expect(peerMeta({ purpose: "frontend", busy: true })).toEqual(["frontend", "busy"]);
  });

  it("labels a held message by the sender's names alone", () => {
    expect(heldLabel({ id: "m-1", fromSession: "s-2", fromTitle: "notes", fromProject: "docs", sentAt: "", body: "hello" }))
      .toBe("docs / notes");
  });
});
