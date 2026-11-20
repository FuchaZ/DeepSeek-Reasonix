package serve

import (
	"context"
	"path/filepath"
	"testing"

	"reasonix/internal/base/testenv"
	"reasonix/internal/state/sessionstore"
)

// The title call names the conversation it titles, so a gateway groups it with
// that conversation's own turns instead of under an unnamed bucket.
func TestTitleRequestNamesTheConversation(t *testing.T) {
	prov := &recordingTitleProvider{}
	s := &Server{titleModel: titleProviderState{prov: prov}}
	const id = "20261119-083951.989165400-worker"
	if _, err := s.requestTitleWithin(context.Background(), "login loops forever", s.currentTitleProvider(), titleMaxTokens, id); err != nil {
		t.Fatalf("requestTitleWithin: %v", err)
	}
	if prov.count() != 1 {
		t.Fatalf("requests = %d, want 1", prov.count())
	}
	if got := prov.at(0).SessionID; got != id {
		t.Fatalf("SessionID = %q, want %q", got, id)
	}
}

// A caller with no transcript to name sends no session: an id nothing lists
// would be a bucket of its own.
func TestTitleRequestWithoutATranscriptNamesNothing(t *testing.T) {
	prov := &recordingTitleProvider{}
	s := &Server{titleModel: titleProviderState{prov: prov}}
	if _, err := s.requestTitleWithin(context.Background(), "hi", s.currentTitleProvider(), titleMaxTokens, ""); err != nil {
		t.Fatalf("requestTitleWithin: %v", err)
	}
	if got := prov.at(0).SessionID; got != "" {
		t.Fatalf("SessionID = %q, want none", got)
	}
}

// The first turn's naming call names that conversation: the pane triggers it
// from the transcript path it just started.
func TestGenerateTitleNamesThePane(t *testing.T) {
	prov := &recordingTitleProvider{}
	s := &Server{titleModel: titleProviderState{prov: prov}}
	path := filepath.Join(testenv.TempDir(t), "20260101-000000.000000001-pane.jsonl")
	if _, err := s.tryGenerateTitle(context.Background(), "name this pane", sessionstore.BranchID(path)); err != nil {
		t.Fatalf("tryGenerateTitle: %v", err)
	}
	if want := "20260101-000000.000000001-pane"; prov.at(0).SessionID != want {
		t.Fatalf("SessionID = %q, want %q", prov.at(0).SessionID, want)
	}
}

// The background fill holds a session's cache key, which carries the transcript's
// extension; the id it names must not.
func TestScheduledTitleNamesTheBranchNotTheCacheKey(t *testing.T) {
	prov := &recordingTitleProvider{}
	s := &Server{titleModel: titleProviderState{prov: prov}, titles: newTitleCache(testenv.TempDir(t)), fill: newTitleFiller()}
	const name = "20260101-000000.000000002-fill.jsonl"
	s.scheduleTitle(name, "fill this session", 1)
	waitTitle(t, s, name, "fill this session", 1)
	if want := "20260101-000000.000000002-fill"; prov.at(0).SessionID != want {
		t.Fatalf("SessionID = %q, want %q", prov.at(0).SessionID, want)
	}
}
