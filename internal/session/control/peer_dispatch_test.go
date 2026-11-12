package control

import (
	"context"
	"errors"
	"testing"

	"reasonix/internal/base/testenv"
	"reasonix/internal/contract/config"
)

func setDispatchSwitch(t *testing.T, enabled, dispatch bool) {
	t.Helper()
	t.Setenv("REASONIX_HOME", testenv.TempDir(t))
	cfg := config.LoadForEdit(config.UserConfigPath())
	cfg.Peers.Enabled = enabled
	cfg.Peers.Dispatch = dispatch
	if err := cfg.SaveTo(config.UserConfigPath()); err != nil {
		t.Fatal(err)
	}
}

// A dispatch refused because the user's switch is off is told apart from one
// refused because the host has no panes to open: the first has a fix in settings.
func TestDispatchSaysWhetherTheSwitchOrTheHostRefused(t *testing.T) {
	f := newPeerFixture(t)
	ctx := context.Background()

	setDispatchSwitch(t, true, false)
	_, err := f.c.DispatchToProject(ctx, "b", "x", "")
	if !errors.Is(err, ErrDispatchDisabled) || errors.Is(err, ErrDispatchUnavailable) {
		t.Fatalf("switch off = %v, want ErrDispatchDisabled only", err)
	}
	if got := peerErrorCode(err); got != "dispatch.disabled" {
		t.Fatalf("switch off code = %q", got)
	}

	setDispatchSwitch(t, true, true)
	_, err = f.c.DispatchToProject(ctx, "b", "x", "")
	if !errors.Is(err, ErrDispatchUnavailable) || errors.Is(err, ErrDispatchDisabled) {
		t.Fatalf("switch on, no host = %v, want ErrDispatchUnavailable only", err)
	}
}
