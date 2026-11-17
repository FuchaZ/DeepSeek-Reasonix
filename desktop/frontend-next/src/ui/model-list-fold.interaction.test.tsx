// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "./testkit";
import { t } from "../i18n";
import type { ProviderEntry } from "../port/port";
import { EditConn } from "./EditConn";
import type { Port } from "./Providers";

afterEach(cleanup);

const entry: ProviderEntry = {
  name: "relay", kind: "openai", baseUrl: "https://relay.example.com/v1",
  models: ["alpha", "beta"], default: "alpha", hasKey: true, inUse: false, preset: false,
};

function draw(port: Partial<Port>) {
  return render(<EditConn entry={entry} port={port as Port} busy="" setBusy={() => {}} onDone={() => {}} onRevert={() => {}} />);
}

const list = () => document.querySelector(".mlist") as HTMLElement;
const heading = () => screen.getByRole("button", { name: "模型" });

it("ships the model list shut, with the heading carrying the toggle", () => {
  draw({});
  expect(list().hasAttribute("data-shut")).toBe(true);
  expect(heading().getAttribute("aria-expanded")).toBe("false");
  expect(document.querySelector(".mline")).toBeNull();
  expect(screen.queryByText(t("models.the_catalog_is_for_discovery"))).toBeNull();
  expect(screen.getByRole("button", { name: "从服务商读取可用模型" })).toBeTruthy();
  expect(screen.getByRole("button", { name: t("models.test_enabled_models_n", { n: 2 }) })).toBeTruthy();
});

it("opens on the heading and closes again, the rows following each press", async () => {
  draw({});
  await userEvent.click(heading());
  expect(heading().getAttribute("aria-expanded")).toBe("true");
  expect(list().hasAttribute("data-shut")).toBe(false);
  expect(screen.getByText("alpha")).toBeTruthy();
  expect(screen.getByText(t("models.the_catalog_is_for_discovery"))).toBeTruthy();

  await userEvent.click(heading());
  expect(heading().getAttribute("aria-expanded")).toBe("false");
  expect(document.querySelector(".mline")).toBeNull();
});

it("opens for the answer the read button brings back", async () => {
  draw({ checkProvider: vi.fn(async () => ({ ok: true, models: ["alpha", "gamma"] })) });
  expect(list().hasAttribute("data-shut")).toBe(true);

  await userEvent.click(screen.getByRole("button", { name: "从服务商读取可用模型" }));
  expect(await screen.findByText("gamma")).toBeTruthy();
  expect(heading().getAttribute("aria-expanded")).toBe("true");
});

it("opens for a batch test run from the heading too", async () => {
  const checkProviderModel = vi.fn(async ({ model }: { model: string }) => ({ model, status: "available" as const }));
  draw({ checkProviderModel });
  expect(list().hasAttribute("data-shut")).toBe(true);

  await userEvent.click(screen.getByRole("button", { name: t("models.test_enabled_models_n", { n: 2 }) }));
  expect(heading().getAttribute("aria-expanded")).toBe("true");
  expect(await screen.findByText("alpha")).toBeTruthy();
});
