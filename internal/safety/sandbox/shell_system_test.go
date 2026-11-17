package sandbox

import (
	"os/exec"
	"testing"
)

// Android has no bash and no PATH entry that reaches /system/bin, so a resolver
// that only looks for "bash" hands every phone session the bare name — which
// cannot start, and which the person sees as "no usable shell was found" on
// every launch. The system shell is the one interpreter there is.
func TestAndroidFindsTheSystemShell(t *testing.T) {
	h := shellHost{
		goos:     "android",
		lookPath: func(string) (string, error) { return "", exec.ErrNotFound },
		exists:   func(p string) bool { return p == "/system/bin/sh" },
		isWSL:    func(string) bool { return false },
	}
	got := h.bashCandidates()
	if len(got) == 0 || got[0] != "/system/bin/sh" {
		t.Fatalf("bashCandidates on Android = %v, want /system/bin/sh first", got)
	}
}

// The same host with the shell missing must still answer nothing rather than
// inventing a path, so a resolution that finds no interpreter keeps saying so.
func TestAndroidWithNoSystemShellFindsNothing(t *testing.T) {
	h := shellHost{
		goos:     "android",
		lookPath: func(string) (string, error) { return "", exec.ErrNotFound },
		exists:   func(string) bool { return false },
		isWSL:    func(string) bool { return false },
	}
	if got := h.bashCandidates(); len(got) != 0 {
		t.Fatalf("bashCandidates = %v, want none", got)
	}
}

// A desktop Linux host keeps its PATH lookup and gains no /system/bin guess:
// the Android paths are a fact about that platform, not a fallback anywhere.
func TestLinuxDoesNotGuessAndroidPaths(t *testing.T) {
	h := shellHost{
		goos: "linux",
		lookPath: func(name string) (string, error) {
			if name == "bash" {
				return "/usr/bin/bash", nil
			}
			return "", exec.ErrNotFound
		},
		exists: func(p string) bool { return p == "/system/bin/sh" },
		isWSL:  func(string) bool { return false },
	}
	got := h.bashCandidates()
	if len(got) != 1 || got[0] != "/usr/bin/bash" {
		t.Fatalf("bashCandidates on Linux = %v, want only /usr/bin/bash", got)
	}
}
