package stats

import (
	"context"
	"runtime"
	"testing"
	"time"

	"reasonix/internal/base/testenv"
)

// waitForDispatchers blocks until the process-wide map holds exactly want
// entries, so a leaked dispatcher is reported here instead of being read as a
// slow stop.
func waitForDispatchers(t *testing.T, want int) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if dispatcherCount() == want {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("dispatchers tracked = %d, want %d", dispatcherCount(), want)
}

func dispatcherCount() int {
	recorderDispatchers.Lock()
	defer recorderDispatchers.Unlock()
	return len(recorderDispatchers.byDir)
}

// drainDispatchers clears what earlier tests in this package left behind: they
// build recorders without going through the close path, so the map is not empty
// when a case here starts.
func drainDispatchers(t *testing.T) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := CloseUsageCatalogs(ctx); err != nil {
		t.Fatalf("drain usage catalogs: %v", err)
	}
	waitForDispatchers(t, 0)
}

// A test binary walks a fresh home per package, so a dispatcher that outlives
// cleanup leaves one goroutine behind per directory. CloseUsageCatalogs is the
// process boundary that must release them.
func TestCloseUsageCatalogsStopsRecordDispatchers(t *testing.T) {
	dirs := []string{
		testenv.TempDir(t),
		testenv.TempDir(t),
	}
	for _, dir := range dirs {
		r := NewRecorder(&spySink{}, dir, "desktop")
		r.Emit(usageEvent("deepseek/deepseek-v4-flash", 100, 50, 10, 20, 30, 150))
	}
	if got := dispatcherCount(); got < len(dirs) {
		t.Fatalf("dispatchers tracked = %d, want at least %d", got, len(dirs))
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := CloseUsageCatalogs(ctx); err != nil {
		t.Fatalf("close usage catalogs: %v", err)
	}

	waitForDispatchers(t, 0)
}

// Stopping must not drop what a caller already handed over: the queue is
// drained before it closes, so the last record still reaches the file.
func TestCloseUsageCatalogsDrainsBeforeStopping(t *testing.T) {
	drainDispatchers(t)

	dir := testenv.TempDir(t)
	r := NewRecorder(&spySink{}, dir, "desktop")
	r.Emit(usageEvent("deepseek/deepseek-v4-flash", 100, 50, 10, 20, 30, 150))

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := CloseUsageCatalogs(ctx); err != nil {
		t.Fatalf("close usage catalogs: %v", err)
	}

	if files := dailyJSONLFiles(t, dir); len(files) == 0 {
		t.Fatal("the queued record was dropped by the dispatcher stop")
	}
}

// A recorder built after the close must work: the stopped dispatcher is
// forgotten rather than handed back half-closed.
func TestRecorderAfterCloseStartsAFreshDispatcher(t *testing.T) {
	drainDispatchers(t)

	dir := testenv.TempDir(t)
	before := NewRecorder(&spySink{}, dir, "desktop")
	before.Emit(usageEvent("deepseek/deepseek-v4-flash", 100, 50, 10, 20, 30, 150))

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := CloseUsageCatalogs(ctx); err != nil {
		t.Fatalf("close usage catalogs: %v", err)
	}

	after := NewRecorder(&spySink{}, dir, "cli")
	after.Emit(usageEvent("deepseek/deepseek-v4-pro", 200, 100, 0, 0, 0, 300))
	flushRecorder(t, after)

	if files := dailyJSONLFiles(t, dir); len(files) == 0 {
		t.Fatal("a recorder created after the close wrote nothing")
	}
	waitForDispatchers(t, 1)

	if err := CloseUsageCatalogs(ctx); err != nil {
		t.Fatalf("second close: %v", err)
	}
	waitForDispatchers(t, 0)
}

// The goroutine count is the property that actually leaked; the map is only
// how it was tracked. Stopping N dispatchers must leave no extra goroutine.
func TestStoppedDispatchersLeaveNoGoroutines(t *testing.T) {
	drainDispatchers(t)
	goroutines := runtime.NumGoroutine()

	dirs := make([]string, 0, 8)
	for range 8 {
		dir := testenv.TempDir(t)
		dirs = append(dirs, dir)
		NewRecorder(&spySink{}, dir, "desktop")
	}
	waitForDispatchers(t, len(dirs))
	if grown := runtime.NumGoroutine(); grown < goroutines {
		t.Fatalf("goroutines fell from %d to %d while dispatchers started", goroutines, grown)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := CloseUsageCatalogs(ctx); err != nil {
		t.Fatalf("close usage catalogs: %v", err)
	}
	waitForDispatchers(t, 0)

	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if runtime.NumGoroutine() <= goroutines {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("goroutines = %d after stopping %d dispatchers, started from %d",
		runtime.NumGoroutine(), len(dirs), goroutines)
}

// stop is the dispatcher's own contract, independent of the map bookkeeping.
func TestStoppedDispatcherRejectsFurtherWork(t *testing.T) {
	dir := testenv.TempDir(t)
	r := NewRecorder(&spySink{}, dir, "desktop")
	dispatcher := r.dispatcher
	if dispatcher == nil {
		t.Fatal("recorder has no dispatcher")
	}

	dispatcher.stop()

	// Neither path may panic or block once the queue is closed.
	dispatcher.enqueue(record{Timestamp: time.Now(), Source: "desktop"})
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := dispatcher.flush(ctx); err != nil && ctx.Err() == nil {
		t.Fatalf("flush after stop = %v, want nil", err)
	}
	dispatcher.stop() // idempotent
}
