import { useState } from "react";
import { t } from "../../i18n";
import type { Item } from "../../state/session";
import { useStartsOpen } from "../../state/foldpref";
import { StudioIcon } from "../StudioIcon";
import { shortArgs, argOf } from "../args";
import { BringCall } from "./BringCall";
import { ToolOutput } from "./ToolOutput";
import { useFullOutput, type ReadOutput } from "./useFullOutput";

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
function CommandLine({ item, onBring, readOutput }: { item: Call; onBring?: (id: string) => void; readOutput?: ReadOutput }) {
  const tool = item.tool;
  const full = useFullOutput(tool, readOutput);
  return (
    <details className="call cmdline" data-call={tool.id || undefined} data-item={item.id}>
      <summary className="c">
        <span className="cmdline-arg" title={tool.args}>{lineOf(tool)}</span>
        {onBring && tool.id && <BringCall onBring={() => onBring(tool.id!)} />}
      </summary>
      <div className="out">
        <section className="cmdline-input">
          <header><b>{t("common.input")}</b><span>JSON</span></header>
          <pre>{pretty(tool.args)}</pre>
        </section>
        {tool.output && (
          <>
            {full.note}
            <ToolOutput name={tool.name} text={full.text ?? ""} bound={tool.bound} id={tool.id} />
          </>
        )}
      </div>
    </details>
  );
}

/** A run of commands drawn as one row. Each ran on its own and said how it
 *  ended, so the group is the count and the lines are what ran — every line
 *  opens to the whole command and its output, as a lone command's card does. A
 *  run of four commands read as four cards is four headers for four lines. */
export function CommandGroup({ items, onBring, readOutput }: { items: Call[]; onBring?: (id: string) => void; readOutput?: ReadOutput }) {
  const start = useStartsOpen("steps", false);
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
        <span className="tool-state" data-state="done" aria-label={t("common.done_2")} title={t("common.done_2")}>
          <StudioIcon name="check" />
        </span>
        <span className="tool-fold" aria-hidden="true" />
      </summary>
      <div className="out">
        <div className="cmdrow">
          {items.map((item) => <CommandLine key={item.id} item={item} onBring={onBring} readOutput={readOutput} />)}
        </div>
      </div>
    </details>
  );
}
