package sessionstore

import (
	"path/filepath"
	"testing"

	"reasonix/internal/base/testenv"
	"reasonix/internal/contract/provider"
)

func saveHostOpenedSession(t *testing.T, dir string) string {
	t.Helper()
	path := filepath.Join(dir, "20260101-000000-dispatch.jsonl")
	s := NewSession("system instructions")
	s.Add(provider.Message{
		Role: provider.RoleUser, HostAuthored: true,
		Content:    "<workspace>\nCurrent workspace: D:\\work\n</workspace>\n\n<peer-message from=\"sender\">\nfix the login loop\n</peer-message>",
		RawContent: "fix the login loop",
	})
	s.Add(provider.Message{Role: provider.RoleAssistant, Content: "done"})
	if err := s.SaveSnapshot(path); err != nil {
		t.Fatal(err)
	}
	return path
}

// A dispatched session's only opening turn is host-authored. The person never
// typed, so the turn count stays zero; the task it was opened to do is still the
// session's subject, and a session with a subject is not an empty conversation.
func TestAHostOpenedSessionKeepsItsSubjectAndIsListed(t *testing.T) {
	dir := testenv.TempDir(t)
	path := saveHostOpenedSession(t, dir)

	preview, turns := SessionPreview(path)
	if turns != 0 {
		t.Fatalf("turns = %d, want 0: the person opened no turn", turns)
	}
	if preview != "fix the login loop" {
		t.Fatalf("preview = %q, want the task the session was opened to do", preview)
	}
	infos, err := ListSessions(dir)
	if err != nil || len(infos) != 1 {
		t.Fatalf("ListSessions = %d rows, err=%v; want the dispatched session listed", len(infos), err)
	}
	if infos[0].Preview != "fix the login loop" || infos[0].Turns != 0 {
		t.Fatalf("listed row = %+v, want the task as preview and zero person turns", infos[0])
	}
	src, err := UserMessagesTitleSource(path)
	if err != nil || src != "fix the login loop" {
		t.Fatalf("title source = %q, err=%v; want the opening task", src, err)
	}
}

// A sidecar written before the subject rule cached zero preview and zero turns.
// Listing revalidates it from the transcript once, then records the new count
// version so later listings stay O(1).
func TestAStaleZeroCountSidecarIsRevalidated(t *testing.T) {
	dir := testenv.TempDir(t)
	path := saveHostOpenedSession(t, dir)
	if err := UpdateBranchMeta(path, false, func(meta *BranchMeta) error {
		meta.Preview, meta.Turns, meta.SchemaVersion = "", 0, 2
		return nil
	}); err != nil {
		t.Fatal(err)
	}

	infos, err := ListSessions(dir)
	if err != nil || len(infos) != 1 {
		t.Fatalf("ListSessions over a stale sidecar = %d rows, err=%v; want it revalidated", len(infos), err)
	}
	meta, ok, err := LoadBranchMeta(path)
	if err != nil || !ok {
		t.Fatalf("sidecar after revalidation: ok=%v err=%v", ok, err)
	}
	if meta.SchemaVersion != BranchMetaCountsVersion || meta.Preview != "fix the login loop" {
		t.Fatalf("sidecar = {version:%d preview:%q}, want version %d with the subject",
			meta.SchemaVersion, meta.Preview, BranchMetaCountsVersion)
	}
}

// A host line that arrives inside a conversation the person is having does not
// become the preview: only the session's opening turn is its subject.
func TestAHostLineAfterAUserTurnStaysOutOfThePreview(t *testing.T) {
	dir := testenv.TempDir(t)
	path := filepath.Join(dir, "20260101-000001-chat.jsonl")
	s := NewSession("system instructions")
	s.Add(provider.Message{Role: provider.RoleUser, Content: "first topic"})
	s.Add(provider.Message{Role: provider.RoleAssistant, Content: "answer"})
	s.Add(provider.Message{Role: provider.RoleUser, Content: "host notification", HostAuthored: true})
	if err := s.SaveSnapshot(path); err != nil {
		t.Fatal(err)
	}
	preview, turns := SessionPreview(path)
	if preview != "first topic" || turns != 1 {
		t.Fatalf("preview/turns = %q/%d, want the person's first topic and one turn", preview, turns)
	}
	src, err := UserMessagesTitleSource(path)
	if err != nil || src != "first topic" {
		t.Fatalf("title source = %q, err=%v; want only the person's turn", src, err)
	}
}
