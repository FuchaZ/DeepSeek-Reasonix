// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import "../testkit";
import { Transcript } from "../Transcript";
import { openCards } from "./openCards";
import { capToolOutput } from "../../state/outputcap";
import type { Item } from "../../state/session";

Element.prototype.getAnimations ??= () => [];

afterEach(cleanup);

const noop = async () => undefined as never;
const same = { entering: [] as string[], onEntered: () => {}, waiting: {}, scroll: { current: null }, onExtInvoke: () => {}, checkpoints: new Map(), onOpenProject: () => {}, onKeepHere: () => {}, takeovers: {} };
const view = (items: Item[]) => (
  <Transcript items={items} {...same} port={{ workspaceImageURL: () => "" } as never} revision={items.length} hidden={false} focus={null} onApprove={noop} onFullAccess={noop} onPlan={noop} onAnswer={noop} onForget={noop}
    onExtSubmit={noop} onPrepareRewind={noop} onCommitRewind={noop} onPrepareFileRevert={noop} onCommitFileRevert={noop} />
);

const LINES = Array.from({ length: 200 }, (_, n) => `line ${n} of a command's output`).join("\n");
const call = (n: number): Item => ({ t: "tool", id: `r${n}`, running: false, children: [], tool: capToolOutput({ id: `c${n}`, name: "bash", args: "{}", output: LINES.repeat(n % 2 ? 1 : 20), readOnly: false }) });

describe("what a finished call's output costs the page", () => {
  it("is one text node per output block, however many lines it has", () => {
    render(view([call(1), call(2)]));
    expect(document.querySelectorAll(".term-l").length).toBe(0);
    for (const block of document.querySelectorAll(".term")) expect(block.childNodes.length).toBe(1);
  });

  it("keeps a transcript of many long calls within a node budget", () => {
    const items = Array.from({ length: 40 }, (_, n) => call(n));
    render(view(items));
    const nodes = document.body.getElementsByTagName("*").length;
    expect(nodes / items.length).toBeLessThan(120);
  });

  it("still shows every line of a block that was not capped", () => {
    render(view([call(1)]));
    openCards();
    expect(document.body.textContent).toContain("line 199 of a command's output");
  });
});
