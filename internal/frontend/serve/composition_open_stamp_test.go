package serve

import (
	"path/filepath"
	"testing"

	"reasonix/internal/base/testenv"
	"reasonix/internal/contract/provider"
	"reasonix/internal/state/sessionstore"
)

// Skipping the second read is only safe while the bytes are the ones already
// read. Every way a transcript can move on disk has to invalidate the load, or
// opening a session would bind a stale transcript.
func TestLoadedSessionReusableOnlyWhileBytesAreUnchanged(t *testing.T) {
	root := testenv.TempDir(t)
	path := sessionstore.NewSessionPath(SessionDirFor(root), "stamp")

	sess := sessionstore.NewSession("sys")
	sess.Add(provider.Message{Role: provider.RoleUser, Content: "hello"})
	if err := sess.SaveIfAbsent(path); err != nil {
		t.Fatalf("SaveIfAbsent: %v", err)
	}

	opened, err := loadOwnedSession(path)
	if err != nil {
		t.Fatalf("loadOwnedSession: %v", err)
	}
	if !opened.reusableFor(path) {
		t.Fatal("a load must be reusable while nothing changed on disk")
	}

	// Appending a turn grows the event log, so the stamp moves and the load must
	// be refused rather than bound as if it were current.
	sess.Add(provider.Message{Role: provider.RoleAssistant, Content: "second"})
	if err := sess.SaveSnapshot(path); err != nil {
		t.Fatalf("SaveSnapshot: %v", err)
	}
	if opened.reusableFor(path) {
		t.Fatal("a load must not be reusable after the log grew")
	}

	// A fresh load of the new bytes is reusable again, proving the refusal above
	// was about staleness and not about the path.
	fresh, err := loadOwnedSession(path)
	if err != nil {
		t.Fatalf("reload: %v", err)
	}
	if !fresh.reusableFor(path) {
		t.Fatal("a load taken after the append must be reusable")
	}
	if len(fresh.session.Messages) <= len(opened.session.Messages) {
		t.Fatalf("reload saw %d messages, want more than the pre-append %d",
			len(fresh.session.Messages), len(opened.session.Messages))
	}
}

func TestLoadedSessionRefusesAnotherFilesPath(t *testing.T) {
	root := testenv.TempDir(t)
	first := sessionstore.NewSessionPath(SessionDirFor(root), "one")
	second := sessionstore.NewSessionPath(SessionDirFor(root), "two")
	for _, p := range []string{first, second} {
		if err := sessionstore.NewSession("sys").SaveIfAbsent(p); err != nil {
			t.Fatalf("SaveIfAbsent %s: %v", p, err)
		}
	}

	opened, err := loadOwnedSession(first)
	if err != nil {
		t.Fatalf("loadOwnedSession: %v", err)
	}
	if opened.reusableFor(second) {
		t.Fatal("a load of one transcript must never be bound to another")
	}
	// The same file spelled differently is still the same file.
	alternative := filepath.Join(filepath.Dir(first), ".", filepath.Base(first))
	if !opened.reusableFor(alternative) {
		t.Fatalf("%q must resolve to the same transcript as %q", alternative, first)
	}
}

func TestNilLoadedSessionIsNeverReusable(t *testing.T) {
	var opened *loadedSession
	if opened.reusableFor("anything.jsonl") {
		t.Fatal("a nil load must never be reused")
	}
	if opened.bindingOf() != nil {
		t.Fatal("a nil load has no composition")
	}
}
