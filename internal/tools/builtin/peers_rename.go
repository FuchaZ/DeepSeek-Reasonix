package builtin

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"reasonix/internal/contract/tool"
)

// RenameTools are the tools that name a session. The rename_session tool lets
// a lead name its own conversation or one it dispatched to, so a collaboration
// board shows a word instead of a timestamp. It is a peer tool: only present
// while the user has session collaboration on.
func RenameTools(link *tool.PeerLink) []tool.Tool {
	return []tool.Tool{&renameSession{link: link}}
}

type renameSession struct{ link *tool.PeerLink }

func (*renameSession) Name() string { return "rename_session" }
func (*renameSession) Description() string {
	return "Give a session a name you can read. Leave `to` empty to name this conversation; pass the key or title printed by list_peers to name a session you handed a task to. A session you did not open or dispatch to cannot be renamed. The name appears in the sidebar and in the session-collaboration board instead of a timestamp."
}
func (*renameSession) Schema() json.RawMessage {
	return json.RawMessage(`{"type":"object","properties":{"to":{"type":"string","description":"Empty to name this session; else the key or title of a session you dispatched to"},"title":{"type":"string","description":"The human-readable name"}},"required":["title"],"additionalProperties":false}`)
}
func (*renameSession) ReadOnly() bool { return false }

func (t *renameSession) Execute(_ context.Context, args json.RawMessage) (string, error) {
	var in struct {
		To    string `json:"to"`
		Title string `json:"title"`
	}
	if err := json.Unmarshal(args, &in); err != nil {
		return "", fmt.Errorf("rename_session needs {\"to\", \"title\"}: %w", err)
	}
	title := strings.TrimSpace(in.Title)
	if title == "" {
		return "", tool.Refusal{Code: "rename.empty", Message: "a session name cannot be empty"}
	}
	dir, ok := t.link.Directory()
	if !ok {
		return "rename.disabled: session collaboration is not available in this session", nil
	}
	renamer, ok := dir.(tool.SessionRenamer)
	if !ok {
		return "rename.disabled: this session cannot name others", nil
	}
	got, err := renamer.RenameSession(strings.TrimSpace(in.To), title)
	if err != nil {
		return "", err
	}
	who := got.Target
	if who == "" {
		who = "this session"
	}
	return fmt.Sprintf("Named %s (%s) as %q.", who, got.Path, got.Title), nil
}
