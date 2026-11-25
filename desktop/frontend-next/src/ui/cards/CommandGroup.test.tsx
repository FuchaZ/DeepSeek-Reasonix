// @vitest-environment jsdom
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import "../testkit";
import { CommandGroup } from "./CommandGroup";
import type { Item } from "../../state/session";

afterEach(cleanup);

type Call = Extract<Item, { t: "tool" }>;
const cmd = (id: string, over: Record<string, unknown> = {}): Call => ({
  t: "tool", id, running: false, children: [],
  tool: {
    id, name: "bash", readOnly: false,
    args: JSON.stringify({ command: `echo ${id}` }), output: `out-${id}`, ...over,
  } as never,
});
const open = (row: Element) => {
  const details = row as HTMLDetailsElement;
  details.open = true;
  act(() => { details.dispatchEvent(new Event("toggle")); });
};

describe("a run of commands drawn as one row", () => {
  it("keeps each command findable and says how many ran", () => {
    const { container } = render(<CommandGroup items={[cmd("a"), cmd("b")]} />);
    expect(container.querySelector(".cmdgroup")?.textContent).toContain("运行命令 2 条");
    const lines = [...container.querySelectorAll(".cmdline")];
    expect(lines).toHaveLength(2);
    expect(lines.map((line) => line.getAttribute("data-item"))).toEqual(["a", "b"]);
    open(lines[0]);
    expect(lines[0].textContent).toContain("echo a");
    expect(lines[0].textContent).toContain("out-a");
  });

  it("brings back the middle of a bounded output", async () => {
    const read = vi.fn(async (_id: string, offset = 0) => ({ callId: "c", text: "full-body", bytes: 9, offset, truncated: false }));
    const { container } = render(
      <CommandGroup items={[cmd("c", { output: "head…tail", hidden: 120 }), cmd("d")]} readOutput={read} />,
    );
    const line = container.querySelector(".cmdline") as HTMLElement;
    open(line);
    const more = line.querySelector<HTMLButtonElement>(".out-more");
    expect(more).not.toBeNull();
    act(() => more!.click());
    await waitFor(() => expect(line.textContent).toContain("full-body"));
  });
});
