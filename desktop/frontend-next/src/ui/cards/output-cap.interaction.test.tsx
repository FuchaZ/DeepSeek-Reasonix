// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "../testkit";
import { Transcript } from "../Transcript";
import { HttpError } from "../../port/http_error";
import { capToolOutput, OUTPUT_EDGE } from "../../state/outputcap";
import { fromHistory } from "../../state/session";
import type { Item } from "../../state/session";
import type { ToolOutputPage } from "../../port/session";

Element.prototype.getAnimations ??= () => [];

afterEach(cleanup);

const noop = async () => undefined as never;
const same = { entering: [] as string[], onEntered: () => {}, waiting: {}, scroll: { current: null }, onExtInvoke: () => {}, checkpoints: new Map(), onOpenProject: () => {}, onKeepHere: () => {}, takeovers: {} };
type Reader = (id: string, offset?: number, limit?: number) => Promise<ToolOutputPage>;
const view = (items: Item[], toolOutput?: Reader) => (
  <Transcript items={items} {...same} port={{ workspaceImageURL: () => "", ...(toolOutput ? { toolOutput } : {}) } as never} revision={items.length} hidden={false} focus={null} onApprove={noop} onFullAccess={noop} onPlan={noop} onAnswer={noop} onForget={noop}
    onExtSubmit={noop} onPrepareRewind={noop} onCommitRewind={noop} onPrepareFileRevert={noop} onCommitFileRevert={noop} />
);

const FULL = "head-" + "x".repeat(OUTPUT_EDGE - 5) + "M".repeat(30_000) + "y".repeat(OUTPUT_EDGE - 5) + "-tail";
const capped = (id = "c1") => capToolOutput({ id, name: "bash", args: "{}", output: FULL, readOnly: false });
const item = (): Item => ({ t: "tool", id: "r1", running: false, children: [], tool: capped() });
const pages = (): Reader => vi.fn(async (_id, offset = 0, limit = 8192) => {
  const bytes = new TextEncoder().encode(FULL);
  const end = Math.min(bytes.length, offset + Math.min(limit, 8192));
  return { callId: "c1", text: new TextDecoder().decode(bytes.slice(offset, end)), bytes: bytes.length, offset, truncated: end < bytes.length };
});
const open = () => { const d = document.querySelector<HTMLDetailsElement>("details.tool-disclosure")!; d.open = true; fireEvent(d, new Event("toggle")); };

describe("a finished call whose middle the page let go of", () => {
  it("says so and keeps the start and the end", () => {
    render(view([item()], pages()));
    open();
    expect(screen.getByText(/中间 30,000 个字符没有放在页面里/)).toBeTruthy();
    expect(document.body.textContent).toContain("head-");
    expect(document.body.textContent).toContain("-tail");
    expect(document.body.textContent).not.toContain("M".repeat(100));
  });

  it("brings the whole output back page by page when asked, and stops saying anything was left out", async () => {
    const read = pages();
    render(view([item()], read));
    open();
    fireEvent.click(screen.getByRole("button", { name: "显示完整输出" }));
    await waitFor(() => expect(document.body.textContent).toContain("M".repeat(100)));
    expect(read).toHaveBeenCalled();
    expect((read as unknown as { mock: { calls: unknown[][] } }).mock.calls.length).toBeGreaterThan(1);
    expect(screen.queryByText(/没有放在页面里/)).toBeNull();
  });

  it("says why it could not be fetched, and can try again", async () => {
    const read = vi.fn<Reader>().mockRejectedValueOnce(new HttpError(404, "x", { code: "tool.output_unknown", error: "x" })).mockImplementation(pages());
    render(view([item()], read));
    open();
    fireEvent.click(screen.getByRole("button", { name: "显示完整输出" }));
    expect((await screen.findByRole("alert")).textContent).toContain("这个会话里没有这条调用的输出");
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await waitFor(() => expect(document.body.textContent).toContain("M".repeat(100)));
  });

  it("offers nothing to press where the window has no way to read it back, but still says what was left out", () => {
    render(view([item()]));
    open();
    expect(screen.getByText(/没有放在页面里/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "显示完整输出" })).toBeNull();
  });

  it("is the same for a sub-agent's child call", async () => {
    const read = pages();
    const parent: Item = { t: "tool", id: "p1", running: false, children: [capped("c1")], tool: { id: "p1", name: "task", args: "{}", output: "report", readOnly: false } };
    render(view([parent], read));
    open();
    fireEvent.click(await screen.findByRole("button", { name: "显示完整输出" }));
    await waitFor(() => expect(read).toHaveBeenCalled());
  });
});

describe("what the page keeps when a session is rebuilt", () => {
  it("is the capped form of a long result, with the count", () => {
    const msgs = [
      { role: "assistant", content: "", msgIndex: 0, toolCalls: [{ id: "c1", name: "bash", arguments: "{}" }] },
      { role: "tool", toolCallId: "c1", toolName: "bash", content: FULL, msgIndex: 1 },
    ];
    const built = fromHistory(msgs as never);
    const tool = (built.items.find((i) => i.t === "tool") as Extract<Item, { t: "tool" }>).tool;
    expect(tool.hidden).toBe(30_000);
    expect(tool.output!.length).toBeLessThan(FULL.length / 2);
  });
});
