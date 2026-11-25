import { useState } from "react";
import { t } from "../../i18n";
import type { Item } from "../../state/session";
import { useStartsOpen } from "../../state/foldpref";
import type { StateTool } from "../../state/outputcap";
import { StudioIcon } from "../StudioIcon";
import { ShotThumb, pathOf } from "./ToolCard";

type Call = Extract<Item, { t: "tool" }>;

const shotsOf = (tool: StateTool): string[] => tool.images ?? [];

/** A run of picture calls drawn as one row. Each call in the run existed to show
 *  its picture, so the group's body is the pictures themselves — laid side by
 *  side, as many as the window holds — and a call's own path stays on its
 *  thumbnail where a reader looks for it. */
export function PictureGroup({ items }: { items: Call[] }) {
  const start = useStartsOpen("steps", false);
  const [touched, setOpen] = useState<boolean | null>(null);
  const open = touched ?? start;
  const total = items.reduce((n, item) => n + shotsOf(item.tool).length, 0);
  return (
    <details
      className="tool-disclosure picgroup"
      open={open}
      onToggle={(event) => event.currentTarget.open !== open && setOpen(event.currentTarget.open)}
    >
      <summary className="hl">
        <span className="nm" title={items.map((item) => item.tool.name).join(" · ")}>{t("chat.viewed_images_n", { n: total })}</span>
        <span className="tool-state" data-state="done" aria-label={t("common.done_2")} title={t("common.done_2")}>
          <StudioIcon name="check" />
        </span>
        <span className="tool-fold" aria-hidden="true" />
      </summary>
      <div className="out">
        <div className="tshots pichrow">
          {items.flatMap((item) =>
            shotsOf(item.tool).map((src, k) => (
              <ShotThumb key={`${item.id}:${k}`} src={src} name={pathOf(item.tool) || t("chat.tool_screenshot_n", { n: k + 1 })} />
            )),
          )}
        </div>
      </div>
    </details>
  );
}
