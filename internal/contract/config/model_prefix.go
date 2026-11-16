package config

import "strings"

func renderHideModelPrefix(b *strings.Builder, p ProviderEntry) {
	if p.HideModelPrefix {
		b.WriteString("hide_model_prefix = true   # display only: leave out the prefix every model of this entry shares\n")
	}
}

// ModelShort is how model is drawn on its own: the last path segment, when the
// id carries one. A relay's ids carry the upstream group or door in front —
// group/…, auto/…, workbuddy/… — and one entry may mix them, so the prefix is
// each id's own front matter to leave off. Two doors onto one model then read
// alike, and that is honest: the door heading carries the distinction.
func (e *ProviderEntry) ModelShort(model string) string {
	at := strings.LastIndex(model, "/")
	if at < 0 {
		return ""
	}
	return model[at+1:]
}
