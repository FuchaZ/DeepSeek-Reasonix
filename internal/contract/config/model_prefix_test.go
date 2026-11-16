package config

import (
	"os"
	"strings"
	"testing"

	"reasonix/internal/base/testenv"
)

func labelOf(e ProviderEntry, model string) string { return e.ModelShort(model) }

// A relay's ids carry the upstream group in front, and one entry may mix
// groups: the display reads each model by its last path segment, which the
// mark and the account heading make unambiguous. The id and ref never change,
// and a stored toggle rides along unread.
func TestTheModelReadsByItsLastSegmentByDefault(t *testing.T) {
	e := ProviderEntry{Models: []string{
		"group/deepseek-v4.1-flash", "auto/dfmodel", "workbuddy-ai/glm-5.3-flash",
	}}
	for _, model := range e.Models {
		want := model[strings.LastIndex(model, "/")+1:]
		if got := labelOf(e, model); got != want {
			t.Fatalf("%s short = %q, want %q", model, got, want)
		}
	}
	if e.Models[0] != "group/deepseek-v4.1-flash" {
		t.Fatal("the model id the wire carries was changed")
	}
}

func TestAnIdWithoutASlashIsDrawnAsItIs(t *testing.T) {
	e := ProviderEntry{Models: []string{"deepseek-chat"}}
	if got := labelOf(e, "deepseek-chat"); got != "" {
		t.Fatalf("short = %q, want the id drawn as it is", got)
	}
}

func TestTwoDoorsOntoOneModelReadAlike(t *testing.T) {
	e := ProviderEntry{Models: []string{"group/glm-5.3-flash", "auto/glm-5.3-flash", "group/qwen3.8-flash"}}
	// Two doors onto one model read alike, and that is honest: the door
	// heading above the rows carries the distinction.
	if got := labelOf(e, "group/glm-5.3-flash"); got != "glm-5.3-flash" {
		t.Fatalf("group/glm-5.3-flash short = %q", got)
	}
	if got := labelOf(e, "auto/glm-5.3-flash"); got != "glm-5.3-flash" {
		t.Fatalf("auto/glm-5.3-flash short = %q", got)
	}
	if got := labelOf(e, "group/qwen3.8-flash"); got != "qwen3.8-flash" {
		t.Fatalf("qwen3.8-flash short = %q", got)
	}
}

func TestAnAliasPrefilledFromTheDoorReadsInstead(t *testing.T) {
	// The alias the refresh prefilled is the row's own display name; the short
	// form stays for the places that read it, and the label chain prefers the
	// alias.
	e := ProviderEntry{Models: []string{"group/glm-5.3-flash", "auto/dfmodel"}, ModelAliases: map[string]string{"group/glm-5.3-flash": "GLM 5.3 FLASH", "auto/dfmodel": "DeepSeek-Flash"}}
	for _, m := range e.Models {
		if got := labelOf(e, m); got != m[strings.LastIndex(m, "/")+1:] {
			t.Fatalf("%s short = %q", m, got)
		}
	}
}

func TestHideModelPrefixStillRoundTripsThroughTheConfigFile(t *testing.T) {
	cfg := &Config{Providers: []ProviderEntry{{Name: "mag", Kind: "openai", BaseURL: "https://m.example/v1", Models: []string{"group/a"}, HideModelPrefix: true}}}
	out := RenderTOMLForScope(cfg, RenderScopeUser)
	if !strings.Contains(out, "hide_model_prefix = true") {
		t.Fatalf("not rendered:\n%s", out)
	}
	path := testenv.TempDir(t) + "/config.toml"
	if err := os.WriteFile(path, []byte(out), 0o600); err != nil {
		t.Fatal(err)
	}
	back, err := LoadForEditReadOnlyStrict(path)
	if err != nil || len(back.Providers) != 1 || !back.Providers[0].HideModelPrefix {
		t.Fatalf("reload err=%v providers=%+v", err, back.Providers)
	}
}
