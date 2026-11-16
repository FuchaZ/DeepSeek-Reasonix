import { t } from "../i18n";
import { SymbolMark } from "./RMark";

interface HeroProps {
  onSuggest?: (text: string) => void;
}

// The pane's empty welcome. Which project it belongs to is the composer pill's
// question, so this never asks for one — a conversation with no project is a
// task, and the palette moves it when the person wants it moved.
export function Hero({ onSuggest }: HeroProps) {
  return (
    <div className="hero">
      <SymbolMark />
      <div className="t">{t("chat.describe_the_task_reasonix_takes")}</div>
      <div className="s">{t("chat.it_can_read_code_research")}</div>
      {onSuggest ? (
        <div className="herostart">
          {[t("chat.starter_explain_the_project"), t("chat.starter_find_the_regression"), t("chat.starter_write_tests")].map((text) => (
            <button key={text} type="button" data-action="hero.suggest" onClick={() => onSuggest(text)}>{text}</button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
