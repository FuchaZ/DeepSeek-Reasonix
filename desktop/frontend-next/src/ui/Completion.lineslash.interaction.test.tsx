// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import "./testkit";
import { useState } from "react";
import { CompletionMenu, useCompletion } from "./Completion";
import type { AgentPort, Completion } from "../port/port";

afterEach(cleanup);

function drawKeystrokes(complete: (line: string, cursor: number, signal?: AbortSignal) => Promise<Completion>) {
  const port = { complete } as unknown as AgentPort;
  let type: (text: string) => void = () => {};
  function Probe() {
    const [text, setText] = useState("draft\n/");
    type = setText;
    const menu = useCompletion(port, text, text.length, () => {});
    return <>
      {menu.open && <CompletionMenu id="m" items={menu.completion.items} active={menu.active}
        kind={menu.completion.kind} query={menu.completion.query ?? ""} kb={menu.kb} onPick={menu.accept} onHover={menu.hover} />}
    </>;
  }
  const view = render(<Probe />);
  return { type: (text: string) => view.rerender((type(text), <Probe />)), view };
}

it("a slash opening a line asks about that line alone, and the whole catalogue comes back", async () => {
  const seen: { line: string; cursor: number }[] = [];
  const complete = vi.fn(async (line: string, cursor: number): Promise<Completion> => {
    seen.push({ line, cursor });
    return {
      kind: "slash", from: 0, to: line.length, query: line,
      items: [
        { label: "/goal", insert: "/goal", kind: "builtin" },
        { label: "/review", insert: "/review", kind: "subagent" },
      ],
    };
  });
  const { type } = drawKeystrokes(complete);
  await vi.waitFor(() => expect(seen).toEqual([{ line: "/", cursor: 1 }]));
  expect(complete).toHaveBeenCalledTimes(1);
  // The mid-line filter never ran: a builtin the sentence cannot hold is here.
  await screen.findByRole("option", { name: /^\/goal/ });
  await screen.findByRole("option", { name: /^\/review/ });

  // Typing on names the command; the question follows the line, not the text.
  type("draft\n/go");
  await vi.waitFor(() => expect(seen).toEqual([
    { line: "/", cursor: 1 },
    { line: "/go", cursor: 3 },
  ]));
  await screen.findByRole("option", { name: /^\/goal/ });
});

it("a slash opening a word mid-line still asks about the token and only chips come back", async () => {
  const seen: { line: string; cursor: number }[] = [];
  const complete = vi.fn(async (line: string, cursor: number): Promise<Completion> => {
    seen.push({ line, cursor });
    return {
      kind: "slash", from: 0, to: line.length, query: line,
      items: [
        { label: "/goal", insert: "/goal", kind: "builtin" },
        { label: "/review", insert: "/review", kind: "subagent" },
        { label: "/translate", insert: "/translate", kind: "skill" },
      ],
    };
  });
  const { type } = drawKeystrokes(complete);
  await vi.waitFor(() => expect(seen.length).toBe(1));
  type("draft /go");
  await vi.waitFor(() => expect(seen).toEqual([{ line: "/", cursor: 1 }, { line: "/go", cursor: 3 }]));
  await screen.findByRole("option", { name: /^\/review/ });
  await screen.findByRole("option", { name: /^\/translate/ });
  // /goal cannot become a chip, so a mid-line word never offers it.
  expect(screen.queryByRole("option", { name: /^\/goal/ })).toBeNull();
});
