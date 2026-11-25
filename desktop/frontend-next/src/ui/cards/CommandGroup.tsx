import { useState } from "react";
import { t } from "../../i18n";
import type { Item } from "../../state/session";
import { useStartsOpen } from "../../state/foldpref";
import { StudioIcon } from "../StudioIcon";
import { shortArgs, argOf } from "../args";
import { BringCall } from "./BringCall";
import { ToolOutput } from "./ToolOutput";
import { toolFailed } from "./outcome";

type Call = Extract<Item, { t: "tool" }>;

const lineOf = (tool: Call["tool"]): string =>
  (shortArgs(tool.args ?? "") || argOf(tool.args, "description") || tool.name).replace(/\n/g, " ").slice(0, 96);

const pretty = (args?: string): string => {
  if (!args) return "";
  try {
    return JSON.stringify(JSON.parse(args), null, 2);
  } catch {
    return args;
  }
};

/** One command inside a run: the line says which command ran, and opening it
 *  gives the whole of it plus what it printed — the two things a lone command's
 *  card carries, kept because a group must not cost a call what it could say. */
function CommandLine({ item, onBring }: { item: Call; onBring?: (id: string) => void }) {
  const tool = item.tool;
  return (
    <details className="call cmdline" data-call={tool.id || undefined}>
      <summary className="c">
        <span className="cmdline-arg" title={tool.args}>{lineOf(tool)}</span>
        {onBring && tool.id && <BringCall onBring={() => onBring(tool.id!)} />}
      </summary>
      <div className="out">
        <section className="cmdline-input">
          <header><b>{t("common.input")}</b><span>JSON</span></header>
          <pre>{pretty(tool.args)}</pre>
        </section>
        {tool.output && <ToolOutput name={tool.name} text={tool.output} bound={tool.bound} id={tool.id} />}
      </div>
    </details>
  );
}

/** A run of commands drawn as one row. Each ran on its own and said how it
 *  ended, so the group is the count and the lines are what ran — every line
 *  opens to the whole command and its output, as a lone command's card does. A
 *  run of four commands read as four cards is four headers for four lines. */
export function CommandGroup({ items, onBring }: { items: Call[]; onBring?: (id: string) => void }) {
  const failed = items.filter((item) => toolFailed(item.tool)).length;
  const start = useStartsOpen("steps", false, failed > 0);
  const [touched, setOpen] = useState<boolean | null>(null);
  const open = touched ?? start;
  return (
    <details
      className="tool-disclosure cmdgroup"
      open={open}
      onToggle={(event) => event.currentTarget.open !== open && setOpen(event.currentTarget.open)}
    >
      <summary className="hl">
        <span className="nm">{t("chat.ran_commands_n", { n: items.length })}</span>
        {failed > 0 && <span className="fail">{t("chat.n_failed", { n: failed })}</span>}
        <span
          className="tool-state"
          data-state={failed ? "failed" : "done"}
          aria-label={t(failed ? "common.failed" : "common.done_2")}
          title={t(failed ? "common.failed" : "common.done_2")}
        >
          <StudioIcon name={failed ? "warning" : "check"} />
        </span>
        <span className="tool-fold" aria-hidden="true" />
      </summary>
      <div className="out">
        <div className="cmdrow">
          {items.map((item) => <CommandLine key={item.id} item={item} onBring={onBring} />)}
        </div>
      </div>
    </details>
  );
}
