package serve

import (
	"errors"
	"testing"

	"reasonix/internal/contract/agentcomposition"
	"reasonix/internal/contract/config"
	"reasonix/internal/contract/tool"
	"reasonix/internal/runtime/agent"
	"reasonix/internal/session/control"
	"reasonix/internal/state/sessionstore"
)

func TestDispatchKeepsTheExactCompositionAndRefusesAnotherWorkspace(t *testing.T) {
	f := newDispatchFixture(t, dispatchOn)
	root, other := f.project("alpha", true), f.project("other", true)
	d := agentcomposition.Builtins()[1]
	b := &agentcomposition.Binding{Version: agentcomposition.Version{Definition: d, Revision: agentcomposition.Revision(d)}, Resolved: d, Workspace: root, SystemPrompt: "retained prompt"}
	b.Seal()
	session := sessionstore.NewSession(b.SystemPrompt)
	session.BindComposition(b)
	exec := agent.New(nil, tool.NewRegistry(), session, agent.Options{}, nil)
	ctrl := control.New(control.Options{Executor: exec, Runner: exec, WorkspaceRoot: root, SessionDir: SessionDirFor(root),
		SessionPath: sessionstore.NewSessionPath(SessionDirFor(root), "bound"), Peers: control.PeersOptions{Dir: f.peersDir}, Posture: control.PostureEvidence{Home: f.home}})
	t.Cleanup(ctrl.Close)
	bc := NewBroadcaster()
	rt, err := f.hub.Adopt(New(ctrl, bc, config.ServeConfig{}), bc)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.hub.openDispatchSession(t.Context(), rt, ctrl, root, "", []byte("pair")); err != nil {
		t.Fatal(err)
	}
	got := f.bindings[0]
	if got == nil || got.Digest != b.Digest || got.SystemPrompt != b.SystemPrompt {
		t.Fatalf("dispatched runtime lost its exact composition: %+v", got)
	}
	opened := f.opened
	if _, err := f.hub.openDispatchSession(t.Context(), rt, ctrl, other, "", []byte("pair")); !errors.Is(err, agentcomposition.ErrUnavailable) {
		t.Fatalf("another workspace accepted a bound composition: %v", err)
	}
	if f.opened != opened {
		t.Fatal("cross-workspace refusal still opened a runtime")
	}

	if _, err := f.hub.openBound(t.Context(), OpenRequest{Root: other}, b); !errors.Is(err, agentcomposition.ErrUnavailable) {
		t.Fatalf("an invalid inherited binding opened a history-only runtime: %v", err)
	}
	if len(f.hub.localRuntimes()) != 2 {
		t.Fatal("a failed inherited binding still published a runtime")
	}
}
