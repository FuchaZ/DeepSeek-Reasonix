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
          <li key={id[i]} className="plan-step" data-state={mark} style={{ marginInlineStart: stepIndent(st) }}>
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

/** The ordinal a person reads for where the plan stands: the step in hand, or
 *  the next one to start. */
export function stepOrdinal(steps: PlanStep[]): number {
  const now = currentStep(steps);
  if (now >= 0) return now + 1;
  return Math.min(steps.filter(stepDone).length + 1, steps.length);
}
