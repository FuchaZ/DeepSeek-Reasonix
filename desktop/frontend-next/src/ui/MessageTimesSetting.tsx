import { useSyncExternalStore } from "react";
import { t } from "../i18n";
import { showMessageTimes, onMessageTimesChange, setShowMessageTimes } from "../state/messagetimes";
import { Group } from "./Group";
import { Switch } from "./Switch";

// Whether the transcript stamps each message with its time — on hover, not
// always drawn: the row already ends in actions, and a permanent column of
// clocks would outshout them. Off here means the stamps are never composed.
export function MessageTimesSetting() {
  const on = useSyncExternalStore(onMessageTimesChange, showMessageTimes, showMessageTimes);
  return (
    <Group id="message-times" inline title={t("settings.message_times")} hint={t("settings.message_times_hint")}>
      <Switch data-action="appearance.message-times" on={on} label={t("settings.message_times")} onClick={() => setShowMessageTimes(!on)} />
    </Group>
  );
}
