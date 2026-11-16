package sessionstore

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"reasonix/internal/base/testenv"
)

// A sessions tree that nests its transcripts by date is walked whole: the
// scans that decide what the sidebar lists, what archives and what is
// reclaimable read the dated folders, not only the folder's own files.
func TestEachSessionDirVisitsTheDatedFoldersUnderIt(t *testing.T) {
	dir := testenv.TempDir(t)
	dated := filepath.Join(dir, "2026", "11", "14")
	if err := os.MkdirAll(dated, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dated, "20261114-101500.jsonl"), []byte("{}\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	seen := map[string]int{}
	if err := eachSessionDir(dir, func(sub string, entries []os.DirEntry) {
		seen[filepath.Clean(sub)] = len(entries)
	}); err != nil {
		t.Fatalf("walk: %v", err)
	}
	for _, want := range []string{dir, filepath.Join(dir, "2026"), filepath.Join(dir, "2026", "11"), dated} {
		if _, ok := seen[filepath.Clean(want)]; !ok {
			t.Fatalf("%s was not visited; visited %v", want, seen)
		}
	}
	if seen[filepath.Clean(dated)] != 1 {
		t.Fatalf("the dated folder's listing = %d entries, want the one transcript", seen[filepath.Clean(dated)])
	}
}

// A missing tree is not an error: a folder nobody has written a session in
// answers empty rather than failing the scan above it.
func TestEachSessionDirAcceptsAMissingTree(t *testing.T) {
	called := false
	if err := eachSessionDir(filepath.Join(testenv.TempDir(t), "absent"), func(string, []os.DirEntry) { called = true }); err != nil {
		t.Fatalf("missing tree: %v", err)
	}
	if called {
		t.Fatal("a missing tree visited a folder")
	}
}

// The dated path a fresh task conversation gets: three date segments then the
// transcript's own name, so one folder reads back as a calendar.
func TestNewDatedSessionPathNestsByYearMonthDay(t *testing.T) {
	dir := testenv.TempDir(t)
	path := NewDatedSessionPath(dir, "deepseek-chat")
	rel, err := filepath.Rel(dir, path)
	if err != nil {
		t.Fatal(err)
	}
	parts := strings.Split(filepath.ToSlash(rel), "/")
	if len(parts) != 4 {
		t.Fatalf("dated path = %q, want year/month/day/file", rel)
	}
	if len(parts[0]) != 4 || len(parts[1]) != 2 || len(parts[2]) != 2 {
		t.Fatalf("date segments = %v, want yyyy/mm/dd", parts[:3])
	}
	if !strings.HasSuffix(parts[3], ".jsonl") || !strings.Contains(parts[3], "deepseek-chat") {
		t.Fatalf("transcript name = %q, want the flat path's own name", parts[3])
	}
}
