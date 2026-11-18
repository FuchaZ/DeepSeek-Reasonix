package serve

import (
	"testing"

	"reasonix/internal/state/sessionstore"
)

// sessionNamed writes an empty transcript under dir with an optional recorded
// model, the way a session that was left on some model looks on disk.
func sessionNamed(t *testing.T, dir, name, model string) string {
	t.Helper()
	path := sessionstore.NewSessionPath(dir, name)
	if err := sessionstore.NewSession("").SaveIfAbsent(path); err != nil {
		t.Fatalf("SaveIfAbsent %s: %v", name, err)
	}
	if err := sessionstore.SaveBranchMeta(path, sessionstore.BranchMeta{Model: model, SchemaVersion: sessionstore.BranchMetaCountsVersion}); err != nil {
		t.Fatalf("SaveBranchMeta %s: %v", name, err)
	}
	return path
}

// Reading the recorded model before the assembly is what keeps a reopen from
// building a runtime on the window's default and replacing it a moment later.
func TestModelForReopenedSessionReadsWhatTheTranscriptRecorded(t *testing.T) {
	_, _, _, dir := twoModelServerAt(t)

	if got := modelForReopenedSession(dir, sessionNamed(t, dir, "left-on-other", "alternate/other-chat")); got != "alternate/other-chat" {
		t.Fatalf("reopened session assembles on %q, want alternate/other-chat", got)
	}
}

// Every case the old default-then-adopt path handled has to keep working: a
// transcript with no model, and one whose model left the catalog, both fall
// back to the window's default rather than failing the open.
func TestModelForReopenedSessionFallsBackToTheDefault(t *testing.T) {
	_, _, _, dir := twoModelServerAt(t)

	for _, tc := range []struct{ name, recorded string }{
		{"no-recorded-model", ""},
		{"unknown-recorded-model", "gone/removed"},
	} {
		if got := modelForReopenedSession(dir, sessionNamed(t, dir, tc.name, tc.recorded)); got != "" {
			t.Errorf("%s assembles on %q, want the empty default", tc.name, got)
		}
	}
}

// A new pane has no transcript, so there is nothing recorded to read.
func TestModelForReopenedSessionIgnoresAnEmptyPath(t *testing.T) {
	_, _, _, dir := twoModelServerAt(t)
	if got := modelForReopenedSession(dir, ""); got != "" {
		t.Fatalf("a pane with no session assembles on %q, want the empty default", got)
	}
}
