package serve

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"reasonix/internal/contract/config"
	"reasonix/internal/contract/event"
	"reasonix/internal/contract/provider"
	"reasonix/internal/runtime/agent"
	"reasonix/internal/session/control"
	"reasonix/internal/state/sessionstore"
)

// The number on the rail counts what the person sent to open a turn. A
// mid-turn steer and a fold digest are user-role lines that opened none, so
// counting role=user would say a longer conversation than anybody had.
func TestStatusCountsOnlyAuthoredTurns(t *testing.T) {
	sess := sessionstore.NewSession("system")
	sess.Add(provider.Message{Role: provider.RoleUser, Content: "first"})
	sess.Add(provider.Message{Role: provider.RoleAssistant, Content: "ok"})
	sess.Add(provider.Message{Role: provider.RoleUser, Content: "second"})
	sess.Add(provider.Message{Role: provider.RoleUser, Content: sessionstore.MidTurnSteerMessage("keep going", false)})
	sess.Add(provider.Message{Role: provider.RoleUser, Content: "<compaction-summary>\ndigest\n</compaction-summary>"})
	sess.Add(provider.Message{Role: provider.RoleUser, Content: "third"})
	executor := agent.New(nil, nil, sess, agent.Options{}, event.Discard)
	bc := NewBroadcaster()
	ctrl := control.New(control.Options{Runner: executor, Executor: executor, Sink: bc})
	srv := httptest.NewServer(operatorHandler(New(ctrl, bc, config.ServeConfig{})))
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/status")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var body map[string]json.RawMessage
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	raw, ok := body["authoredTurns"]
	if !ok {
		t.Fatal("/status did not report authoredTurns")
	}
	var got int
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatal(err)
	}
	if got != 3 {
		t.Fatalf("authoredTurns = %d, want 3", got)
	}
}
