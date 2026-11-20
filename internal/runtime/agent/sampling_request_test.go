package agent

import (
	"context"
	"path/filepath"
	"strings"
	"testing"

	"reasonix/internal/contract/provider"
	"reasonix/internal/contract/tool"
	"reasonix/internal/state/sessionstore"
)

// The sampling request names its conversation's branch id, so a gateway that
// groups usage by session keeps one conversation apart from another.
func TestPrepareSamplingRequestNamesItsSession(t *testing.T) {
	prov := &sharedWindowTestProvider{budget: 128 * 1024}
	sess := sessionstore.NewSession("")
	sess.Replace([]provider.Message{{Role: provider.RoleUser, Content: "hi"}})
	a := &Agent{
		agentConfig: agentConfig{contextWindow: 1_048_576, compactRatio: 2},
		svc:         agentServices{prov: prov, tools: tool.NewRegistry()},
		sess: sessionRuntime{
			conversation: sess,
			path:         filepath.Join("sessions", "20260101-120000.123456789-worker.jsonl"),
		},
	}
	prepared, err := a.prepareSamplingRequest(context.Background())
	if err != nil {
		t.Fatalf("prepareSamplingRequest: %v", err)
	}
	if want := "20260101-120000.123456789-worker"; prepared.req.SessionID != want {
		t.Fatalf("SessionID = %q, want %q", prepared.req.SessionID, want)
	}
}

func TestSessionIDIgnoresAnUnboundTranscript(t *testing.T) {
	a := &Agent{sess: sessionRuntime{path: strings.Repeat(" ", 3)}}
	if got := a.sess.branchID(); got != "" {
		t.Fatalf("branchID = %q, want none for a blank path", got)
	}
}
