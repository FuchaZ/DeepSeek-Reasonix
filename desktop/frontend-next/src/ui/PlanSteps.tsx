import { t } from "../i18n";
import { currentStep, stepDone, stepLabel, type PlanStep } from "../state/session";
import { StudioIcon } from "./StudioIcon";

// Keyed by text, not index: todo_write rewrites the whole list every call, and
// under index keys row one morphs into a different sentence instead of the old
// row leaving and a new one arriving. Duplicates get a suffix so React still
// sees one key per row.
export function stepKeys(steps: PlanStep[]): string[] {
  const seen = new Map<string, number>();
  return steps.map((s) => {
    const n = (seen.get(s.text) ?? 0) + 1;
    seen.set(s.text, n);
    return n === 1 ? s.text : `${s.text}#${n}`;
  });
}

export const stepIndent = (s: PlanStep) => (s.level ? Math.min(s.level, 4) * 12 : undefined);

/** The kernel's list is two deep: a phase, and the sub-steps that carry its
 *  progress. Written as an attribute rather than left to the indent because a
 *  margin alone reads as misalignment, not as depth. */
export const subStep = (s: PlanStep) => (s.level ?? 0) >= 1;

type Mark = "done" | "now" | "todo";

/** A proposal has not started, so every row is numbered whatever status the seed
 *  gives it. A started row keeps its ordinal too — the step in hand is marked by
 *  ink, so the badge's "step n of m" always names a row a person can count to. */
export type StepsState = "proposed" | "moving" | "waiting" | "still";

export function PlanSteps({ steps, state }: { steps: PlanStep[]; state: StepsState }) {
  if (steps.length === 0) return null;
  const proposed = state === "proposed";
  const now = proposed ? -1 : currentStep(steps);
  const id = stepKeys(steps);
  return (
    <ol className="plan-steps" data-state={state}>
      {steps.map((st, i) => {
        const mark: Mark = proposed ? "todo" : stepDone(st) ? "done" : i === now ? "now" : "todo";
        return (
          <li key={id[i]} className="plan-step" data-state={mark} data-level={subStep(st) ? "1" : "0"} style={{ marginInlineStart: stepIndent(st) }}>
            <span className="plan-step-mark" aria-label={mark === "done" ? t("plan.step.done") : mark === "now" ? t("plan.step.now") : t("plan.step.todo")}>
              {mark === "done" ? <StudioIcon name="check" /> : i + 1}
            </span>
            <span className="plan-step-text">{proposed ? st.text : stepLabel(st)}</span>
          </li>
        );
      })}
    </ol>
  );
}

/** The row a person counts to for step i: a sub-step answers with the phase it
 *  sits under, because the phase is what the list draws at the margin. A phase
 *  stays pending while its sub-steps run — the kernel's serial rule — so naming
 *  the sub-step here would point the badge at a row the list shows unticked.
 *  The kernel always keeps a phase immediately before its block, and promotes a
 *  leading orphan to level 0, so the walk back always lands. */
export function phaseOf(steps: PlanStep[], i: number): number {
  if (!steps[i]?.level) return i;
  for (let j = i; j >= 0; j--) {
    if (!steps[j].level) return j;
  }
  return i;
}

/** The ordinal a person reads for where the plan stands: the phase in hand, or
 *  the next one to start. The card's 正在做 line stays exact to the sub-step. */
export function stepOrdinal(steps: PlanStep[]): number {
  const now = currentStep(steps);
  if (now >= 0) return phaseOf(steps, now) + 1;
  return Math.min(steps.filter(stepDone).length + 1, steps.length);
}
