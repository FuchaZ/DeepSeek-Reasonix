import { useEffect, useState } from "react";
import { t } from "../i18n";
import { ComposerHintSection } from "./ComposerHintSection";
import { EscStopSetting } from "./EscStopSetting";
import { GlobalShortcutSection } from "./GlobalShortcutSection";
import { KeysSheet } from "./KeysSheet";
import { LiveStreamBudgetSection } from "./LiveStreamBudgetSection";
import { OpenSessionLimitSection } from "./OpenSessionLimitSection";
import { PageSleepSetting } from "./PageSleepSetting";
import { RunningMessageSetting } from "./RunningMessageSetting";
import { SectionCard } from "./SectionCard";
import { StudioIcon } from "./StudioIcon";

// The keys card answers a reference question more often than it is changed, so
// it folds shut and stands last; a landing on one of its rows opens it, so a
// chip or a search result never points at a shut card.
export function OpsSettings({ landed }: { landed?: string }) {
  const [keysOpen, setKeysOpen] = useState(false);
  const landedOnKeys = landed === "keys" || landed === "global-shortcut" || landed === "esc-stop";
  useEffect(() => {
    if (landedOnKeys) setKeysOpen(true);
  }, [landedOnKeys]);
  return (
    <>
      <SectionCard title={t("settings.while_running_card")}>
        <RunningMessageSetting />
        <ComposerHintSection />
      </SectionCard>
      <SectionCard title={t("settings.performance_card")}>
        <OpenSessionLimitSection />
        <LiveStreamBudgetSection />
        <PageSleepSetting />
      </SectionCard>
      <section className="prefs-card" data-shut={!keysOpen || undefined}>
        <header className="cardhead">
          <h3>{t("settings.keyboard_shortcuts")}</h3>
          <button type="button" className="foldhead" aria-expanded={keysOpen} aria-controls="keys-card-body" data-action="settings.keys-fold"
            aria-label={t("settings.keyboard_shortcuts")} onClick={() => setKeysOpen((v) => !v)}>
            <StudioIcon name="down" />
          </button>
        </header>
        {keysOpen && <div id="keys-card-body">
          <KeysSheet />
          <GlobalShortcutSection />
          <EscStopSetting />
        </div>}
      </section>
    </>
  );
}
