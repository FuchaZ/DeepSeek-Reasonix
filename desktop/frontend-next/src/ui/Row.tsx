import { memo, useRef, type ReactNode } from "react";
import type { Item } from "../state/session";
import type { ExtensionSurface } from "../port/wire";
import type { Checkpoint } from "../port/port";
import { ToolCard } from "./cards/ToolCardSafe";
import { Boundary } from "./Boundary";
import { LazyChart } from "./chart/LazyChart";
import { chartOfTool } from "./chart/spec";
import { GuardianCard } from "./cards/GuardianCard";
import { ApprovalCard } from "./cards/ApprovalCard";
import { AskCard } from "./cards/AskCard";
import { SurfaceCard, surfaceTool } from "./surface/SurfaceCard";
import { ElicitCard } from "./cards/ElicitCard";
import { SayCard } from "./cards/SayCard";
import { CompactionCard } from "./cards/CompactionCard";
import { WorkedLine } from "./cards/WorkedLine";
import { ReadsCard } from "./cards/ReadsCard";
import { UserCard } from "./cards/UserCard";
import { NoticeCard } from "./cards/NoticeCard";
import { RememberCard } from "./cards/RememberCard";
import { ExtensionCard } from "./cards/ExtensionCard";
import { drawn } from "./turnrows";
import type { Props as TranscriptProps } from "./Transcript";

export interface RowHandlers {
  onBring?: (id: string) => void;
  owed: Set<string>;
  echoes: Set<string>;
  port: TranscriptProps["port"];
  onApprove: TranscriptProps["onApprove"];
  onFullAccess: TranscriptProps["onFullAccess"];
  onPlan: TranscriptProps["onPlan"];
  onAnswer: TranscriptProps["onAnswer"];
  onForget: TranscriptProps["onForget"];
  onSettings: TranscriptProps["onSettings"];
  onExtInvoke: TranscriptProps["onExtInvoke"];
  takeovers: Record<string, ExtensionSurface>;
  onExtSubmit: TranscriptProps["onExtSubmit"];
  onPrepareRewind: TranscriptProps["onPrepareRewind"];
  onCommitRewind: TranscriptProps["onCommitRewind"];
  onPrepareFileRevert: TranscriptProps["onPrepareFileRevert"];
  reply: TranscriptProps["reply"];
  onResend: TranscriptProps["onResend"];
  onWithdraw: TranscriptProps["onWithdraw"];
  onCommitFileRevert: TranscriptProps["onCommitFileRevert"];
}

// A streamed token replaces one item and leaves the rest identical, so the rest
// must not re-render: at a working session's length that walk cost more per
// chunk than parsing the message did.
export const Row = memo(function Row({
  it,
  port,
  onBring,
  owed,
  echoes,
  onApprove,
  onFullAccess,
  onPlan,
  onForget,
  onSettings,
  onAnswer,
  onExtInvoke,
  reply,
  onResend, onWithdraw,
  takeovers,
  onExtSubmit,
  cp,
  onPrepareRewind,
  onCommitRewind,
  onPrepareFileRevert,
  onCommitFileRevert,
  afterAnswer,
  settled,
  activity = false,
}: RowHandlers & { it: Item; cp?: Checkpoint; afterAnswer?: ReactNode; settled?: boolean; activity?: boolean }) {
  // Read once, for the life of this element. The projection spends the debt as
  // soon as this is drawn, and a card whose answer is still streaming would
  // otherwise lose the attribute mid-animation and have it cut short. A block
  // that scrolls back mounts a new Row, which asks again and is told no.
  const enter = useRef(owed.has(it.id)).current;
  // display:contents, so this frame carries the one-shot mark and the card
  // stays exactly the child of .chunk that its layout is written against.
  return (
    <div className="enterbox" data-item={it.id} data-enter={enter ? "" : undefined}>
      {(() => {
  switch (it.t) {
    case "user":
      return (
        <UserCard
          item={it}
          port={port}
          cp={cp}
          onResend={onResend}
          onWithdraw={onWithdraw}
          onPrepareRewind={onPrepareRewind}
          onCommitRewind={onCommitRewind}
        />
      );
    case "say":
      // Reasoning arrives long before the first answer token on a thinking
      // model. Gating the card on text meant all of it stayed invisible and
      // then landed at once. An empty card is still not a message, so a turn
      // that produced neither draws nothing.
      return drawn(it) || afterAnswer ? <SayCard item={it} afterAnswer={afterAnswer} settled={settled} reply={reply} quiet={echoes.has(it.id)} /> : null;
    case "tool":
      // The ask tool also raises ask_request, which carries the id /answer
      // needs. Drawing the tool call too put two copies of the same question on
      // screen, each answerable.
      if (it.tool.name === "ask") return null;
      { const surface = surfaceTool(it.tool, it.running, port); if (surface !== undefined) return surface; }
      return (() => {
        const card = (
          <ToolCard
            tool={it.tool}
            running={it.running}
            activity={activity}
            children={it.children}
            readOutput={port?.toolOutput?.bind(port)}
            omitted={it.omitted}
            takeover={it.tool.id ? takeovers[`tool:${it.tool.id}`] : undefined}
            onExtInvoke={onExtInvoke}
            onPrepareFileRevert={onPrepareFileRevert}
            onCommitFileRevert={onCommitFileRevert}
            onBring={it.tool.id && onBring ? () => onBring(it.tool.id!) : undefined}
            onStop={port?.stopToolCall && it.tool.id ? () => void port.stopToolCall!(it.tool.id!).catch(() => {}) : undefined}
          />
        );
        const chart = activity ? null : chartOfTool(it.tool);
        return chart ? (
          <Boundary fallback={card} retryKey={it.tool.args}>
            <LazyChart spec={chart} callId={it.tool.id} />
          </Boundary>
        ) : card;
      })();
    case "reads":
      return <ReadsCard tools={it.tools} />;
    case "guardian":
      return <GuardianCard g={it.g} />;
    case "approval":
      return <><ApprovalCard item={it} onApprove={onApprove} onFullAccess={onFullAccess} onPlan={onPlan} />{afterAnswer}</>;
    case "ask":
      return it.ask.questions.some(q => q.surface) ? <SurfaceCard item={it} onAnswer={onAnswer} port={port} /> : it.ask.origin ? <ElicitCard item={it} onAnswer={onAnswer} /> : <AskCard item={it} onAnswer={onAnswer} onEngage={port?.engageQuestion?.bind(port)} refine={port?.refinePrompt?.bind(port)} />;
    case "compaction":
      return <CompactionCard c={it.c} done={it.done} />;

    case "remember":
      return <RememberCard m={it.m} forgotten={it.forgotten} onForget={(name) => onForget(it.id, name)} />;
    case "worked":
      return <WorkedLine ms={it.ms} startedAt={it.startedAt} />;
    case "extension":
      return <ExtensionCard ext={it.ext} onInvoke={onExtInvoke} onSubmit={onExtSubmit} />;
    case "notice":
      return <NoticeCard item={it} onSettings={onSettings} />;
  }
      })()}
    </div>
  );
});
