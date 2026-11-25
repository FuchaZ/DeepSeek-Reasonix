package serve

import (
	"testing"

	"reasonix/internal/contract/provider"
	"reasonix/internal/state/sessionstore"
)

// A steer another session sent must still read as that session's when the
// transcript is rebuilt: the person sees it arrived, without the reopened view
// drawing it as their own speech.
func TestHistoryMarksAPeerSteerAsAnotherSessions(t *testing.T) {
	msgs := []provider.Message{{
		Role:       provider.RoleUser,
		Content:    sessionstore.MidTurnSteerSource("body", sessionstore.SteerByPeer),
		RawContent: "message from another session: docs",
	}}
	out := historyMessages(msgs)
	if len(out) != 1 {
		t.Fatalf("history = %d messages, want 1", len(out))
	}
	if !out[0].Steer || !out[0].PeerSteer {
		t.Fatalf("peer steer = %+v, want Steer and PeerSteer", out[0])
	}
	if out[0].Content != "message from another session: docs" {
		t.Fatalf("content = %q, want the display stored with it", out[0].Content)
	}
}

// Only another session's steer carries the marker: the person's own guidance
// and the runtime's notice must not be drawn as peer data.
func TestHistoryLeavesPersonAndHostSteersUnmarkedAsPeer(t *testing.T) {
	for _, tc := range []struct {
		name    string
		content string
	}{
		{"user", sessionstore.MidTurnSteerSource("keep going", sessionstore.SteerByUser)},
		{"host", sessionstore.MidTurnSteerSource("job finished", sessionstore.SteerByHost)},
	} {
		out := historyMessages([]provider.Message{{Role: provider.RoleUser, Content: tc.content}})
		if len(out) != 1 || !out[0].Steer || out[0].PeerSteer {
			t.Fatalf("%s steer = %+v, want Steer without PeerSteer", tc.name, out)
		}
	}
}
