import { describe, expect, it } from "vitest";
import { heldLabel, peerLabel, peerNote } from "./peerKeys";

describe("peer keys", () => {
  it("names a session by project and title, falling back to its key", () => {
    expect(peerLabel({ title: "notes", project: "docs", key: "s-1" })).toBe("docs / notes");
    expect(peerLabel({ title: "", project: "docs", key: "s-1" })).toBe("s-1");
  });

  it("says a sender's role and whether it is busy", () => {
    expect(peerNote(undefined)).toBe("");
    expect(peerNote({})).toBe("");
    expect(peerNote({ purpose: "frontend" })).toBe("remote.peer_role");
    expect(peerNote({ busy: true })).toBe("remote.peer_busy");
    expect(peerNote({ purpose: "frontend", busy: true })).toBe("remote.peer_role_and_busy");
  });

  it("labels a held message by the sender's names alone", () => {
    expect(heldLabel({ id: "m-1", fromSession: "s-2", fromTitle: "notes", fromProject: "docs", sentAt: "", body: "hello" }))
      .toBe("docs / notes");
  });
});
