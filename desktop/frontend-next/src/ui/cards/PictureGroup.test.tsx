// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import "../testkit";
import { PictureGroup } from "./PictureGroup";
import type { Item } from "../../state/session";

afterEach(cleanup);

type Call = Extract<Item, { t: "tool" }>;
const shot = (id: string): Call => ({
  t: "tool", id, running: false, children: [],
  tool: {
    id, name: "view_image", readOnly: true,
    args: JSON.stringify({ path: `${id}.png` }), images: [`data:image/png;base64,${id}`],
  } as never,
});

it("draws each picture in the run and names the count", () => {
  const { container } = render(<PictureGroup items={[shot("a"), shot("b")]} />);
  expect(container.querySelector(".picgroup")?.textContent).toContain("查看图片 2 张");
  expect(container.querySelectorAll(".tshots img")).toHaveLength(2);
});
