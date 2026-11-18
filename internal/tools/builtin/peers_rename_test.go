package builtin

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"reasonix/internal/contract/tool"
)

type fakeRenamer struct {
	fakePeers
	to, title string
}

func (f *fakeRenamer) RenameSession(to, title string) (tool.RenamedSession, error) {
	f.to, f.title = to, title
	return tool.RenamedSession{Path: "/sessions/a.jsonl", Title: title, Target: to}, nil
}

func renameTool(link *tool.PeerLink) tool.Tool {
	for _, t := range RenameTools(link) {
		if t.Name() == "rename_session" {
			return t
		}
	}
	panic("rename_session not registered")
}

func TestRenameSessionNeedsABoundHost(t *testing.T) {
	out, err := renameTool(&tool.PeerLink{}).Execute(context.Background(), json.RawMessage(`{"title":"x"}`))
	if err != nil || !strings.HasPrefix(out, "rename.disabled") {
		t.Fatalf("out = %q, err = %v", out, err)
	}
}

// A bound directory that cannot name sessions is a different refusal from an
// unbound one: this session has peers but its frontend has no panes to name.
func TestRenameSessionSaysSoWhenTheDirectoryCannotName(t *testing.T) {
	link := &tool.PeerLink{}
	link.Bind(&fakePeers{})
	out, err := renameTool(link).Execute(context.Background(), json.RawMessage(`{"title":"x"}`))
	if err != nil || !strings.HasPrefix(out, "rename.disabled") {
		t.Fatalf("out = %q, err = %v", out, err)
	}
}

func TestRenameSessionPassesTheNameThrough(t *testing.T) {
	link := &tool.PeerLink{}
	host := &fakeRenamer{}
	link.Bind(host)
	out, err := renameTool(link).Execute(context.Background(), json.RawMessage(`{"to":"s-1","title":"  研究组  "}`))
	if err != nil {
		t.Fatal(err)
	}
	if host.to != "s-1" || host.title != "研究组" {
		t.Fatalf("host got to=%q title=%q", host.to, host.title)
	}
	if !strings.Contains(out, "研究组") {
		t.Fatalf("out = %q, want the new name", out)
	}
}

func TestRenameSessionRefusesAnEmptyName(t *testing.T) {
	link := &tool.PeerLink{}
	link.Bind(&fakeRenamer{})
	_, err := renameTool(link).Execute(context.Background(), json.RawMessage(`{"title":"   "}`))
	if err == nil || !strings.Contains(err.Error(), "rename.empty") {
		t.Fatalf("err = %v, want rename.empty refusal", err)
	}
}

// The tool takes only a target and a name: a caller cannot smuggle a path or
// an extra field that the host would then have to re-validate.
func TestRenameSessionSchemaTakesATargetAndAName(t *testing.T) {
	schema := string(renameTool(&tool.PeerLink{}).Schema())
	for _, want := range []string{`"to"`, `"title"`, `"required":["title"]`, `"additionalProperties":false`} {
		if !strings.Contains(schema, want) {
			t.Errorf("schema missing %s:\n%s", want, schema)
		}
	}
}
