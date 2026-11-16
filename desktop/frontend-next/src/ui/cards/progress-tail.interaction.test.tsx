// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "../testkit";
import { Transcript } from "../Transcript";
import { PROGRESS_TAIL } from "../../state/fold";
import type { Item } from "../../state/session";

afterEach(cleanup);

const noop = async () => undefined as never;
const same = { entering: [] as string[], onEntered: () => {}, waiting: {}, scroll: { current: null }, onExtInvoke: () => {}, checkpoints: new Map(), onOpenProject: () => {}, onKeepHere: () => {}, takeovers: {} };
const view = (items: Item[]) => (
  <Transcript items={items} {...same} revision={items.length} hidden={false} focus={null} onApprove={noop} onFullAccess={noop} onPlan={noop} onAnswer={noop} onForget={noop}
    onExtSubmit={noop} onPrepareRewind={noop} onCommitRewind={noop} onPrepareFileRevert={noop} onCommitFileRevert={noop} />
);
const running = (omitted?: number): Item => ({
  t: "tool", id: "r1", running: true, children: [], ...(omitted ? { omitted } : {}),
  tool: { id: "r1", name: "bash", args: JSON.stringify({ command: "tail -f build.log" }), output: "last line\n".repeat(20), readOnly: false } as never,
});

describe("a running command whose earlier output the page let go of", () => {
  it("says how much came before what is shown", () => {
    render(view([running(1_234_567)]));
    expect(screen.getByText("此前省略了 1,234,567 个字符，这里只显示最近的输出")).toBeTruthy();
    expect(PROGRESS_TAIL).toBe(64 * 1024);
  });

  it("says nothing when nothing was left out", () => {
    render(view([running()]));
    expect(document.body.textContent).not.toContain("此前省略了");
  });
});
