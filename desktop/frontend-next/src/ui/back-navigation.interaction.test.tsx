// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "./testkit";
import { App } from "./App";
import { MockHub } from "../port/mock_hub";
import { boot, STORAGE } from "../i18n";
import { refresh } from "./viewport";
import { takeBack } from "./back";

function room(width: number) {
  vi.spyOn(document.body, "clientWidth", "get").mockReturnValue(width);
  vi.spyOn(document.body, "clientHeight", "get").mockReturnValue(900);
  refresh();
}

beforeEach(async () => {
  await import("./Settings");
  sessionStorage.clear();
  localStorage.clear();
  localStorage.setItem(STORAGE, "zh");
  boot();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  room(390);
});
afterEach(() => {
  cleanup();
  sessionStorage.clear();
  localStorage.clear();
  delete document.documentElement.dataset.fold;
  vi.restoreAllMocks();
});

async function open() {
  const hub = new MockHub();
  const build = hub.portFor.bind(hub);
  const prepared = new WeakSet();
  hub.portFor = (rt) => {
    const port = build(rt);
    if (!prepared.has(port)) {
      prepared.add(port);
      port.providerSetup = async () => null;
      port.welcomeSeen = async () => true;
    }
    return port;
  };
  const view = render(<App hub={hub} />);
  await screen.findByRole("combobox", { name: "任务输入" });
  return { hub, view };
}

const app = () => document.querySelector(".app")!;
const prefs = () => document.querySelector(".prefs");

it("system back closes Settings, the gathered menu and the rail before the app", async () => {
  await open();
  await userEvent.click(document.querySelector<HTMLElement>(".studio-menu")!);
  expect(app().getAttribute("data-rail")).toBe("on");
  await userEvent.click(document.querySelector<HTMLElement>('[data-action="chrome.settings"]')!);
  await waitFor(() => expect(prefs()).not.toBeNull());

  await act(async () => { expect(takeBack()).toBe(true); });
  await waitFor(() => expect(prefs()).toBeNull());
  expect(app()).not.toBeNull();

  await userEvent.click(document.querySelector<HTMLElement>(".chrome .thbtn.r-more")!);
  const fold = document.querySelector<HTMLElement>(".chrome .r-fold")!;
  expect(fold.hasAttribute("data-open")).toBe(true);
  await act(async () => { expect(takeBack()).toBe(true); });
  expect(fold.hasAttribute("data-open")).toBe(false);

  await userEvent.click(document.querySelector<HTMLElement>(".studio-menu")!);
  expect(app().getAttribute("data-rail")).toBe("on");
  await act(async () => { expect(takeBack()).toBe(true); });
  expect(app().getAttribute("data-rail")).toBe("off");

  expect(takeBack()).toBe(false);
});
