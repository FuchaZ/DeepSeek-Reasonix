// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "./testkit";
import { WorkbenchTabPicker } from "./WorkbenchTabPicker";

afterEach(cleanup);

const picker = (shown: boolean) => (
  <WorkbenchTabPicker tabs={[{ key: "a", label: "Alpha" }]} active="a" shown={shown} onPick={() => {}} />
);

it("closes its portalled list when the workbench goes away", async () => {
  const view = render(picker(true));
  await userEvent.click(screen.getByRole("button", { name: "切换到某个标签" }));
  expect(screen.getByRole("menu", { name: "已打开的标签" })).toBeTruthy();

  view.rerender(picker(false));
  expect(screen.queryByRole("menu")).toBeNull();
});
