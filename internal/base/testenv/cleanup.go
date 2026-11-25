package testenv

import (
	"context"
	"fmt"
	"os"
	"sync"
	"time"
)

// cleanupHookBudget bounds one hook. Closing a catalog cancels its work rather
// than draining it, so this only catches a hang and never asserts latency.
const cleanupHookBudget = 30 * time.Second

var (
	cleanupHookMu sync.Mutex
	cleanupHooks  []func(context.Context) error
)

// OnCleanup registers fn to run before the isolated user home is removed.
// A package-global resource that still holds a file there keeps the directory
// undeletable, and its handle outlives cleanup because it is a singleton.
// Every hook runs on each cleanup, so a hook must tolerate a second call.
func OnCleanup(fn func(context.Context) error) {
	if fn == nil {
		return
	}
	cleanupHookMu.Lock()
	cleanupHooks = append(cleanupHooks, fn)
	cleanupHookMu.Unlock()
}

// runCleanupHooks runs every registered hook. A hook that fails is reported
// rather than fatal: the home it protected is still removed afterwards, and
// the caller has no test to fail.
func runCleanupHooks() {
	cleanupHookMu.Lock()
	hooks := append([]func(context.Context) error(nil), cleanupHooks...)
	cleanupHookMu.Unlock()
	for _, fn := range hooks {
		ctx, cancel := context.WithTimeout(context.Background(), cleanupHookBudget)
		err := fn(ctx)
		cancel()
		if err != nil {
			fmt.Fprintf(os.Stderr, "testenv: user-state cleanup hook: %v\n", err)
		}
	}
}
