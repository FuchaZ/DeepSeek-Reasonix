package control

import (
	"testing"
	"time"

	"reasonix/internal/safety/permission"
)

// "Full access" is the person's standing yes to the agent acting in this
// session, and the two tools that speak in their name to somewhere else are
// part of it. What the posture may not answer is a run with nobody watching:
// that is permission.RefusalUnattended, decided below this manager.
func TestFullAccessAnswersThePeerToolsWithoutACard(t *testing.T) {
	for _, tool := range []string{permission.SendPeerMessage, permission.DispatchToProject} {
		t.Run(tool, func(t *testing.T) {
			a := newApprovalManager(permission.New("ask", nil, nil, nil), ToolApprovalYolo, time.Minute, true)
			if !a.preApprovedForRequiredHuman(tool, "s-1: hello") {
				t.Fatalf("full access still asks for %s", tool)
			}
			if !a.preApprovedForDecisionOptions(tool, "s-1: hello", nil, false, true) {
				t.Fatalf("full access still asks for %s where the prompt is drawn", tool)
			}
		})
	}
}

// Widening the answer to those two tools must not widen it to a decision the
// host answers nowhere else: a sandbox escape, a config write, a sign-in.
func TestFullAccessStillAsksForTheOtherHumanDecisions(t *testing.T) {
	a := newApprovalManager(permission.New("ask", nil, nil, nil), ToolApprovalYolo, time.Minute, true)
	for _, tool := range []string{
		permission.OriginConfirmTool,
		permission.ConfirmTool,
		ManagedConfigWriteApprovalTool,
		SandboxEscapeApprovalTool,
		NetworkEgressApprovalTool,
		MCPSignInApprovalTool,
	} {
		if a.preApprovedForRequiredHuman(tool, "x") {
			t.Fatalf("full access answered %s, which no posture may", tool)
		}
	}
}

// Auto allows writers; it does not speak on the person's behalf. The card is
// what the person reads before words leave this session under their name.
func TestAutoStillAsksForThePeerTools(t *testing.T) {
	a := newApprovalManager(permission.New("ask", nil, nil, nil), ToolApprovalAuto, time.Minute, true)
	for _, tool := range []string{permission.SendPeerMessage, permission.DispatchToProject} {
		if a.preApprovedForRequiredHuman(tool, "s-1: hello") {
			t.Fatalf("auto answered %s", tool)
		}
		if a.preApprovedForDecisionOptions(tool, "s-1: hello", nil, false, true) {
			t.Fatalf("auto answered %s where the prompt is drawn", tool)
		}
	}
}

// A session grant is an answer to one subject, not to the class. Widening the
// posture must not open these two tools to a bare grant either.
func TestASessionGrantStillDoesNotAnswerAPeerTool(t *testing.T) {
	a := newApprovalManager(permission.New("ask", nil, nil, nil), ToolApprovalAsk, time.Minute, true)
	a.grantSession(permission.SendPeerMessage, "s-1: hello")
	if a.preApprovedForRequiredHuman(permission.SendPeerMessage, "s-1: hello") {
		t.Fatal("a session grant stood in for the person on a peer message")
	}
}
