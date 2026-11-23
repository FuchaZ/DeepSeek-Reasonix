import { afterEach, describe, expect, it, vi } from "vitest";
import { SsePort } from "./sse";

// Full access reports back which cards the new posture auto-allowed. The window
// reads that answer to decide what to keep on screen, so the call must return
// the list rather than swallow it — and it must come back at all: a switch that
// hangs leaves a button reading "switching" with nothing on the wire again.

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const portWith = (body: unknown, ok = true, status = 200) => {
  const fetchMock = vi.fn(async () => ({
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }));
  vi.stubGlobal("fetch", fetchMock);
  return { port: new SsePort("http://kernel"), fetchMock };
};

describe("switching to full access", () => {
  it("answers the ids the kernel auto-allowed", async () => {
    const { port } = portWith({ drained: ["a1", "b2"] });
    await expect(port.setApprovalMode("dontAsk")).resolves.toEqual(["a1", "b2"]);
  });

  it("says none were allowed when the answer carries none", async () => {
    const { port } = portWith({ drained: [] });
    await expect(port.setApprovalMode("dontAsk")).resolves.toEqual([]);
  });

  it("does not invent ids from an answer that has no field", async () => {
    const { port } = portWith({});
    await expect(port.setApprovalMode("dontAsk")).resolves.toEqual([]);
  });

  it("posts to the one endpoint that switches the posture", async () => {
    const { port, fetchMock } = portWith({ drained: [] });
    await port.setApprovalMode("dontAsk");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/tool-approval-mode");
    expect(JSON.parse(String(init.body))).toEqual({ mode: "dontAsk" });
  });
});
