package control

import "testing"

func TestDispatchGrantRunsTheDispatchUnattended(t *testing.T) {
	for _, tc := range []struct{ set, want string }{
		{ToolApprovalAsk, ToolApprovalAuto},
		{ToolApprovalAuto, ToolApprovalAuto},
		{ToolApprovalYolo, ToolApprovalYolo},
		{ToolApprovalDontAsk, ToolApprovalDontAsk},
		{ToolApprovalReadOnly, ToolApprovalReadOnly},
	} {
		c := New(Options{})
		c.SetToolApprovalMode(tc.set)
		if got := c.DispatchGrant().Approval; got != tc.want {
			t.Errorf("lead %q passes %q, want %q", tc.set, got, tc.want)
		}
		c.Close()
	}
}

func TestDispatchedSessionDoesNotAskItsLeadToApprove(t *testing.T) {
	// The lead cannot see the dispatched session's approval card, so handing
	// "ask" on would stall it and announce a card nobody there can answer.
	lead := New(Options{})
	lead.SetToolApprovalMode(ToolApprovalAsk)
	grant := lead.DispatchGrant()

	member := New(Options{})
	member.AdoptSessionGrant(grant)
	if got := member.ToolApprovalMode(); got == ToolApprovalAsk {
		t.Fatalf("dispatched session inherited ask posture; it would stall on every tool")
	}
	member.Close()
	lead.Close()
}
