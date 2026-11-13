// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import "./testkit";
import { MockPort } from "../port/mock";
import type { AgentPort } from "../port/port";
import { AccountSettings } from "./AccountSettings";

afterEach(cleanup);

function draw() {
  const port = new MockPort() as unknown as AgentPort;
  render(<AccountSettings port={port} homePort={port} />);
}

it("is version and diagnostics, and about: one row per setting", () => {
  draw();
  expect([...document.querySelectorAll(".prefs-card > header h3")].map((h) => h.textContent)).toEqual(["版本与诊断", "关于"]);
  for (const id of ["versions", "logs"]) expect(document.querySelector(`[data-setting="${id}"]`), id).toBeTruthy();
  // The community card and the sponsorship block are gone; the page is about
  // the app and who maintains it, not about where to send money or chat.
  for (const id of ["community", "sponsor"]) expect(document.querySelector(`[data-setting="${id}"]`), id).toBeNull();
});

it("carries no sign-in of its own: the page is about the app, not an identity", () => {
  draw();
  expect(document.querySelector('[data-action="account.sign-in"]')).toBeNull();
  expect(document.querySelector('[data-action="account.sign-out"]')).toBeNull();
  expect(screen.queryByText("账号")).toBeNull();
});

it("shows versions and diagnostics inline", async () => {
  draw();
  await waitFor(() => expect(document.querySelector("#set-versions .vnow")).toBeTruthy());
  expect(document.querySelector('#set-logs .grp-items')).toBeTruthy();
});
