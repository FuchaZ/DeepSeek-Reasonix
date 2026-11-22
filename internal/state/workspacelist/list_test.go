package workspacelist

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"reasonix/internal/base/testenv"
)

func put(t *testing.T, path, body string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
}

func TestReadKeepsWindowsPathsIntact(t *testing.T) {
	path := filepath.Join(testenv.TempDir(t), FileName)
	put(t, path, `{"paths":["D:\\work\\app"," C:\\Users\\_\\x ",""],"launch":"C:\\Users\\_\\x"}`)
	list, err := Read(path)
	if err != nil {
		t.Fatal(err)
	}
	if len(list.Paths) != 2 || list.Paths[0] != `D:\work\app` || list.Paths[1] != `C:\Users\_\x` || list.Launch != `C:\Users\_\x` {
		t.Fatalf("list = %+v", list)
	}
}

func TestMergeOnceAppendsAndSetsAside(t *testing.T) {
	dir := testenv.TempDir(t)
	cur, old := filepath.Join(dir, "cur.json"), filepath.Join(dir, "old.json")
	put(t, cur, `{"paths":["a","b"],"launch":"b"}`)
	put(t, old, `["b","c"]`)
	n, err := MergeOnce(context.Background(), cur, old)
	if err != nil || n != 1 {
		t.Fatalf("merge = %d, %v", n, err)
	}
	list, _ := Read(cur)
	if len(list.Paths) != 3 || list.Paths[2] != "c" || list.Launch != "b" {
		t.Fatalf("list = %+v", list)
	}
	if _, err := os.Stat(old); !os.IsNotExist(err) {
		t.Fatal("old list not set aside")
	}
	if n, err := MergeOnce(context.Background(), cur, old); n != 0 || err != nil {
		t.Fatalf("second merge = %d, %v", n, err)
	}
}

func TestMergeOnceIntoAMissingListCreatesIt(t *testing.T) {
	dir := testenv.TempDir(t)
	cur, old := filepath.Join(dir, "cur.json"), filepath.Join(dir, "old.json")
	put(t, old, `{"paths":["x"],"launch":"x"}`)
	if _, err := MergeOnce(context.Background(), cur, old); err != nil {
		t.Fatal(err)
	}
	if list, _ := Read(cur); len(list.Paths) != 1 || list.Launch != "x" {
		t.Fatalf("list = %+v", list)
	}
}

func TestMergeOnceRefusesAnUnreadableOldListAndKeepsIt(t *testing.T) {
	dir := testenv.TempDir(t)
	cur, old := filepath.Join(dir, "cur.json"), filepath.Join(dir, "old.json")
	put(t, cur, `{"paths":["a"]}`)
	put(t, old, `{broken`)
	if _, err := MergeOnce(context.Background(), cur, old); err == nil {
		t.Fatal("a corrupt list merged without an error")
	}
	if _, err := os.Stat(old); err != nil {
		t.Fatal("a list that could not be read was set aside")
	}
}

// A merge racing ordinary updates must never leave the list half written or
// drop an entry an update added.
func TestMergeOnceRacesUpdatesWithoutLosingEntries(t *testing.T) {
	dir := testenv.TempDir(t)
	cur := filepath.Join(dir, "cur.json")
	put(t, cur, `{"paths":["seed"]}`)
	var wg sync.WaitGroup
	for i := range 8 {
		wg.Go(func() {
			_ = Update(context.Background(), cur, true, func(l *List) error {
				l.Paths = append(l.Paths, fmt.Sprintf("u%d", i))
				return nil
			})
		})
		wg.Go(func() {
			old := filepath.Join(dir, fmt.Sprintf("old%d.json", i))
			put(t, old, fmt.Sprintf(`["m%d"]`, i))
			_, _ = MergeOnce(context.Background(), cur, old)
		})
	}
	wg.Wait()
	list, err := Read(cur)
	if err != nil {
		t.Fatalf("list unreadable after the race: %v", err)
	}
	if len(list.Paths) != 17 {
		t.Fatalf("got %d paths %v, want 17", len(list.Paths), list.Paths)
	}
}

func TestUpdateWaitsAsLongAsItsCallerAllows(t *testing.T) {
	prev := defaultLockWait
	defaultLockWait = 50 * time.Millisecond
	t.Cleanup(func() { defaultLockWait = prev })
	path := filepath.Join(testenv.TempDir(t), FileName)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	const writers = 6
	errs := make(chan error, writers)
	for range writers {
		go func() {
			errs <- Update(ctx, path, false, func(l *List) error {
				time.Sleep(30 * time.Millisecond)
				l.Paths = append(l.Paths, "p")
				return nil
			})
		}()
	}
	for range writers {
		if err := <-errs; err != nil {
			t.Fatalf("a writer queued inside its caller's deadline gave up: %v", err)
		}
	}
}

func TestUpdateWithoutADeadlineStillGivesUp(t *testing.T) {
	prev := defaultLockWait
	defaultLockWait = 50 * time.Millisecond
	t.Cleanup(func() { defaultLockWait = prev })
	path := filepath.Join(testenv.TempDir(t), FileName)
	release := make(chan struct{})
	held := make(chan struct{})
	done := make(chan struct{})
	go func() {
		defer close(done)
		_ = Update(context.Background(), path, false, func(*List) error {
			close(held)
			<-release
			return nil
		})
	}()
	<-held
	defer func() { close(release); <-done }()
	err := Update(context.Background(), path, false, func(*List) error { return nil })
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("contended update without a deadline = %v, want deadline exceeded", err)
	}
}

// A removal is the user's last word about a folder: it round-trips through the
// file, survives a duplicate, and a restore is the one thing that lifts it.
// The folder path rides along — the ghost row needs it — and goes with the
// removal it belongs to.
func TestRemovalRoundTripsAndRestoreLiftsIt(t *testing.T) {
	path := filepath.Join(testenv.TempDir(t), FileName)
	if err := Update(context.Background(), path, false, func(l *List) error {
		l.Paths = []string{"kept"}
		l.Remove("gone", `D:\gone folder`)
		l.Remove("gone", "a later spelling is ignored")
		l.Remove(" ", "no identity")
		l.Remove("pathless", "")
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	list, err := Read(path)
	if err != nil {
		t.Fatal(err)
	}
	if len(list.Removed) != 2 || list.Removed[0] != "gone" || list.Removed[1] != "pathless" {
		t.Fatalf("removed = %+v, want [gone pathless]", list.Removed)
	}
	if list.RemovedPaths["gone"] != `D:\gone folder` {
		t.Fatalf("removedPaths = %+v, want the folder the removal saw", list.RemovedPaths)
	}
	if _, ok := list.RemovedPaths["pathless"]; ok {
		t.Error("a removal without a path recorded one anyway")
	}
	if err := Update(context.Background(), path, false, func(l *List) error {
		l.Restore("gone")
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if list, err = Read(path); err != nil || len(list.Removed) != 1 {
		t.Fatalf("after a restore removed = %+v (%v), want [pathless]", list.Removed, err)
	}
}

// The tombstones stay bounded: the oldest gives way, so a session of adding
// and removing projects cannot grow the file without end.
func TestRemovalsStayBounded(t *testing.T) {
	var list List
	for i := range maxRemoved + 16 {
		list.Remove(fmt.Sprintf("r%d", i), "")
	}
	if len(list.Removed) != maxRemoved {
		t.Fatalf("kept %d removals, want %d", len(list.Removed), maxRemoved)
	}
	if list.Removed[0] != "r16" || list.Removed[len(list.Removed)-1] != fmt.Sprintf("r%d", maxRemoved+15) {
		t.Fatalf("the oldest removal did not give way: %+v", list.Removed)
	}
}

// A file written with empty or duplicated removal entries reads clean, so a
// hand-edited list cannot wedge the reads below.
func TestReadCleansRemovalEntries(t *testing.T) {
	path := filepath.Join(testenv.TempDir(t), FileName)
	put(t, path, `{"paths":["a"],"removed":["x"," x ","",null]}`)
	list, err := Read(path)
	if err != nil {
		t.Fatal(err)
	}
	if len(list.Removed) != 1 || list.Removed[0] != "x" {
		t.Fatalf("removed = %+v, want [x]", list.Removed)
	}
}
