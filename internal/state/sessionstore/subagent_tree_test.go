package sessionstore

import (
	"os"
	"path/filepath"
	"slices"
	"testing"

	"reasonix/internal/base/testenv"
)

// A subagents/ tree holds one parent session's worker transcripts. They mean
// nothing on their own, so the walk that decides what a folder lists never
// enters it — while the dated folders beside it are still walked whole.
func TestEachSessionDirNeverEntersTheSubagentTree(t *testing.T) {
	dir := testenv.TempDir(t)
	sub := filepath.Join(dir, "subagents")
	dated := filepath.Join(dir, "2026", "11", "14")
	for _, d := range []string{sub, dated} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(sub, "sa_20261124_115222_000000000_35529d6d4160.jsonl"), []byte("{}\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dated, "20261114-101500.jsonl"), []byte("{}\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	var visited []string
	if err := eachSessionDir(dir, func(s string, _ []os.DirEntry) {
		visited = append(visited, filepath.Clean(s))
	}); err != nil {
		t.Fatalf("walk: %v", err)
	}
	if slices.Contains(visited, filepath.Clean(sub)) {
		t.Fatalf("the walk entered the subagent tree; visited %v", visited)
	}
	if !slices.Contains(visited, filepath.Clean(dated)) {
		t.Fatalf("the dated folder was skipped; visited %v", visited)
	}
}

// What a folder lists is the user's own conversations. A worker transcript is
// reached through the session that spawned it, never as one of them.
func TestListSessionsLeavesOutWorkerTranscripts(t *testing.T) {
	dir := testenv.TempDir(t)
	sub := filepath.Join(dir, "subagents")
	if err := os.MkdirAll(sub, 0o755); err != nil {
		t.Fatal(err)
	}
	body := []byte(`{"type":"user","content":"go review this"}` + "\n" + `{"type":"assistant","content":"done"}` + "\n")
	for _, name := range []string{
		filepath.Join(dir, "20261124-120000-own.jsonl"),
		filepath.Join(sub, "sa_20261124_115222_000000000_35529d6d4160.jsonl"),
	} {
		if err := os.WriteFile(name, body, 0o600); err != nil {
			t.Fatal(err)
		}
	}

	listed, err := ListSessions(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(listed) != 1 {
		paths := make([]string, len(listed))
		for i, si := range listed {
			paths[i] = si.Path
		}
		t.Fatalf("ListSessions returned %d sessions, want only the user's own: %v", len(listed), paths)
	}
	if got := filepath.Base(listed[0].Path); got != "20261124-120000-own.jsonl" {
		t.Fatalf("ListSessions returned %q, want the user's own conversation", got)
	}
}
