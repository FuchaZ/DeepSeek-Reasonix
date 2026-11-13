package serve

import (
	"testing"

	"reasonix/internal/base/testenv"
)

// A pane opened after the host took the grant must be as capable as the one it
// started with: adding a second project must not find the provider form
// refusing there. Adopt and OpenWith take different roads, so both are checked.
func TestProviderEditGrantReachesAPaneOpenedLater(t *testing.T) {
	t.Setenv("REASONIX_HOME", testenv.TempDir(t))

	grant := &hostGrantProbe{addr: "127.0.0.1:8787"}
	h := NewHub(HubOptions{Grant: grant.apply})

	// The pane that existed when the host asked.
	first := hubRuntime(t, h, testenv.TempDir(t))
	if !first.Server.grants.providerEdit {
		t.Fatal("the first pane did not take the grant")
	}

	// A pane opened afterwards, the way a second project is.
	second := hubRuntime(t, h, testenv.TempDir(t))
	if !second.Server.grants.providerEdit {
		t.Fatal("a pane opened after the grant did not inherit it")
	}
}

// The same rule holds the other way: a listener that did not earn the grant
// leaves later panes without it too.
func TestProviderEditGrantStaysOffForLaterPanesWhenRefused(t *testing.T) {
	t.Setenv("REASONIX_HOME", testenv.TempDir(t))

	grant := &hostGrantProbe{addr: "0.0.0.0:8787"}
	h := NewHub(HubOptions{Grant: grant.apply})

	later := hubRuntime(t, h, testenv.TempDir(t))
	if later.Server.grants.providerEdit {
		t.Fatal("a pane inherited a grant the listener never earned")
	}
}

// hostGrantProbe stands in for the terminal frontend's grant, which reads the
// address the listener was bound to.
type hostGrantProbe struct{ addr string }

func (g *hostGrantProbe) apply(srv *Server) {
	if g == nil || g.addr == "" {
		return
	}
	srv.AllowProviderEditForListener(g.addr)
}
