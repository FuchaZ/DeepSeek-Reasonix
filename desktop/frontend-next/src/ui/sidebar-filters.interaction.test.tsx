// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "./testkit";
import { App } from "./App";
import { MockHub } from "../port/mock_hub";

afterEach(cleanup);

function hub() {
  const h = new MockHub();
  const build = h.portFor.bind(h);
  h.portFor = (rt) => {
    const port = build(rt);
    port.providerSetup = async () => null;
    port.welcomeSeen = async () => true;
    return port;
  };
  return h;
}

it("the scope filter is one dropdown holding the six scopes, with 最近 as the clock beside it; the find box above the list is the one name search", async () => {
  render(<App hub={hub()} />);
  const trigger = await screen.findByRole("button", { name: "会话范围" });
  await userEvent.click(trigger);
  const menu = document.querySelector<HTMLElement>(".session-filter-menu:not([hidden])")!;
  // 最近 left the menu for its own clock button: the scopes are the menu's
  // whole answer now.
  expect(Array.from(menu.querySelectorAll("button.mi"), (b) => b.getAttribute("data-value"))).toEqual(["all", "live", "waiting", "unread", "pinned", "archived"]);
  expect(screen.getByRole("button", { name: "最近" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "按名称筛选会话" })).toBeNull();
  expect(screen.getAllByRole("searchbox", { name: "搜索会话 / 项目" })).toHaveLength(1);
});

it("choosing a scope inks it and 全部 clears it, and the find box still takes a query", async () => {
  render(<App hub={hub()} />);
  const trigger = await screen.findByRole("button", { name: "会话范围" });
  await userEvent.click(trigger);
  await userEvent.click(within(document.querySelector<HTMLElement>(".session-filter-menu:not([hidden])")!).getByRole("menuitem", { name: /置顶/ }));
  expect(trigger.textContent).toContain("置顶");
  const box = screen.getByRole("searchbox", { name: "搜索会话 / 项目" }) as HTMLInputElement;
  await userEvent.type(box, "abc");
  expect(box.value).toBe("abc");
  expect(trigger.textContent).toContain("置顶");
  // No 清除筛选 row any more: 全部 is the clear.
  await userEvent.click(trigger);
  await userEvent.click(within(document.querySelector<HTMLElement>(".session-filter-menu:not([hidden])")!).getByRole("menuitem", { name: /全部/ }));
  expect(trigger.textContent).toContain("全部");
});
