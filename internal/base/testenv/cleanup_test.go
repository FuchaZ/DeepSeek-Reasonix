package testenv

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

// resetCleanupHooks isolates the process-wide hook list so one test's
// registration cannot run inside the next one's cleanup.
func resetCleanupHooks(t *testing.T) {
	t.Helper()
	cleanupHookMu.Lock()
	saved := cleanupHooks
	cleanupHooks = nil
	cleanupHookMu.Unlock()
	t.Cleanup(func() {
		cleanupHookMu.Lock()
		cleanupHooks = saved
		cleanupHookMu.Unlock()
	})
}

// The home is only removable once whatever held a file inside it has let go.
// A hook that runs after RemoveAll cannot do that job, so its position relative
// to the removal is the whole contract.
func TestCleanupHooksRunWhileIsolatedHomeStillExists(t *testing.T) {
	resetCleanupHooks(t)

	cleanup, err := IsolateUserState()
	if err != nil {
		t.Fatal(err)
	}
	home := os.Getenv("HOME")

	var ran bool
	var sawHome bool
	var sawEmpty bool
	var envHome string
	OnCleanup(func(context.Context) error {
		ran = true
		_, statErr := os.Stat(home)
		sawHome = statErr == nil
		entries, readErr := os.ReadDir(home)
		sawEmpty = readErr == nil && len(entries) == 0
		envHome = os.Getenv("HOME")
		return nil
	})

	cleanup()

	if !ran {
		t.Fatal("cleanup hook did not run")
	}
	if !sawHome {
		t.Fatal("cleanup hook ran after the isolated home was removed; it must run before")
	}
	if !sawEmpty {
		t.Fatal("cleanup hook did not see an empty isolated home")
	}
	// A hook that resolves user paths — flushing a usage projection does — must
	// still see the isolated home, or it writes into the real user's state.
	if envHome != home {
		t.Fatalf("HOME inside cleanup hook = %q, want the isolated home %q", envHome, home)
	}
	if _, err := os.Stat(home); !os.IsNotExist(err) {
		t.Fatalf("isolated home still exists after cleanup: %v", err)
	}
}

// A hook that fails leaves the directory behind exactly as an unremovable file
// would, and there is no *testing.T left to fail: reporting is the only channel.
func TestCleanupHookErrorDoesNotStopRemoval(t *testing.T) {
	resetCleanupHooks(t)

	cleanup, err := IsolateUserState()
	if err != nil {
		t.Fatal(err)
	}
	home := os.Getenv("HOME")
	if err := os.WriteFile(filepath.Join(home, "held.txt"), []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}

	var second bool
	OnCleanup(func(context.Context) error { return errors.New("catalog still open") })
	OnCleanup(func(context.Context) error { second = true; return nil })

	cleanup()

	if !second {
		t.Fatal("a failing hook stopped the hooks after it from running")
	}
	if _, err := os.Stat(home); !os.IsNotExist(err) {
		t.Fatalf("isolated home still exists after a failing hook: %v", err)
	}
}

// Every package's TestMain shares one hook list, so a hook runs on each cleanup
// in the binary rather than once per registration.
func TestCleanupHooksAreNotConsumedByOneCleanup(t *testing.T) {
	resetCleanupHooks(t)

	var calls int
	OnCleanup(func(context.Context) error { calls++; return nil })

	for range 2 {
		cleanup, err := IsolateUserState()
		if err != nil {
			t.Fatal(err)
		}
		cleanup()
	}
	if calls != 2 {
		t.Fatalf("hook ran %d times across two cleanups, want 2", calls)
	}
}

func TestOnCleanupIgnoresNil(t *testing.T) {
	resetCleanupHooks(t)
	OnCleanup(nil)
	if len(cleanupHooks) != 0 {
		t.Fatalf("nil hook was registered: %d hooks", len(cleanupHooks))
	}
}
