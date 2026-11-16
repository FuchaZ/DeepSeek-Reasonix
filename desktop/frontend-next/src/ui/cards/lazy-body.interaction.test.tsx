// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import "../testkit";
import { Transcript } from "../Transcript";
import { openCards } from "./openCards";
import type { Item } from "../../state/session";

afterEach(cleanup);

const noop = async () => undefined as never;
const same = { entering: [] as string[], onEntered: () => {}, waiting: {}, scroll: { current: null }, onExtInvoke: () => {}, checkpoints: new Map(), onOpenProject: () => {}, onKeepHere: () => {}, takeovers: {} };
const view = (items: Item[], extra: Record<string, unknown> = {}) => (
  <Transcript items={items} {...same} revision={items.length} hidden={false} focus={null} onApprove={noop} onFullAccess={noop} onPlan={noop} onAnswer={noop} onForget={noop}
    onExtSubmit={noop} onPrepareRewind={noop} onCommitRewind={noop} onPrepareFileRevert={noop} onCommitFileRevert={noop} {...extra} />
);
const call = (running: boolean): Item => ({
  t: "tool", id: "r1", running, children: [],
  tool: { id: "c1", name: "bash", args: '{"command":"ls"}', output: "alpha\nneedle-in-the-output\n", readOnly: false } as never,
});
const card = () => document.querySelector<HTMLDetailsElement>('[data-call="c1"] details.tool-disclosure, [data-call="r1"] details.tool-disclosure')!;
const output = () => document.querySelector(".term");

describe("the body of a call's card", () => {
  it("is not mounted while a finished card is closed", () => {
    render(view([call(false)]));
    expect(card().open).toBe(false);
    expect(output()).toBeNull();
  });

  it("appears when the card is opened and stays when it is closed again", () => {
    render(view([call(false)]));
    openCards();
    expect(output()?.textContent).toContain("alpha");
    act(() => { card().open = false; card().dispatchEvent(new Event("toggle")); });
    expect(output()).not.toBeNull();
  });

  it("is mounted for a call that is still running", () => {
    render(view([call(true)]));
    expect(output()).not.toBeNull();
  });

  it("is brought up by a find hit inside it", () => {
    render(view([call(false)], { find: { id: "r1", nth: 0, n: 1 }, query: "needle-in-the-output" }));
    act(() => { card().dispatchEvent(new Event("toggle")); });
    expect(card().open).toBe(true);
    expect(output()?.textContent).toContain("needle-in-the-output");
  });
});
