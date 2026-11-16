// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import "./testkit";
import { Pane } from "./Pane";
import { MockPort } from "../port/mock";
import type { RuntimeView } from "../port/hub";

afterEach(cleanup);

const rt = { id: "p1", root: "/w", name: "w" } as RuntimeView;

const pane = (request?: { n: number; id: string; title: string }) => (
  <Pane port={new MockPort()} rt={rt} title="w" active visible sideHost={null} side={false}
    onFocus={() => {}} onReport={() => {}} onSessionChanged={() => {}} pulse={0} findPulse={0}
    onSettings={() => {}} onOpenProject={() => {}}
    theme="dark" dockW={560} dockMax={880} onDockW={() => {}} sessionRef={request} />
);

it("holds a conversation the rail asked for as a chip in this pane's composer, once per request", async () => {
  const view = render(pane());
  await screen.findByRole("combobox", { name: "任务输入" });
  expect(screen.queryByText("Rotate keys")).toBeNull();

  view.rerender(pane({ n: 1, id: "s1", title: "Rotate keys" }));
  await waitFor(() => expect(screen.getByText("Rotate keys")).toBeTruthy());
  expect(screen.getByText("历史会话 · 只读资料")).toBeTruthy();

  view.rerender(pane({ n: 2, id: "s1", title: "Rotate keys" }));
  await waitFor(() => expect(screen.getAllByText("Rotate keys")).toHaveLength(1));
});
