package control

import (
	"context"
	"testing"
	"time"

	"reasonix/internal/safety/permission"
	"reasonix/internal/state/peermail"
)

func pairedController(t *testing.T) (*Controller, []byte) {
	t.Helper()
	f := newPeerFixture(t)
	secret := []byte("0123456789abcdef0123456789abcdef")
	f.c.NoteDispatchedSession("s-peer", secret, "reviewer")
	return f.c, secret
}

func signedFrom(c *Controller, secret []byte, seq uint64) peermail.Message {
	m := peermail.Message{ID: "m-x", From: peermail.Party{SessionID: "s-peer"}, To: peermail.Party{SessionID: "s-me"}, SentAt: time.Now().UTC(), Body: "task", Seq: seq}
	m.Proof = peermail.Proof(secret, m)
	return m
}

// A message the receiver already took in proves nothing a second time: the seen
// log forgets ids after a thousand acknowledgements, so the pairing itself
// remembers which sequence numbers it has accepted for as long as it lives.
func TestAProofedMessageIsAcceptedOnceForThePairingsLifetime(t *testing.T) {
	c, secret := pairedController(t)
	first := signedFrom(c, secret, 1)
	if !c.dispatchPartner(first) {
		t.Fatal("a fresh proofed message was refused")
	}
	if c.dispatchPartner(first) {
		t.Fatal("the same proofed message was accepted twice")
	}
	if !c.dispatchPartner(signedFrom(c, secret, 2)) {
		t.Fatal("the next sequence number was refused")
	}
	if c.dispatchPartner(signedFrom(c, secret, 0)) {
		t.Fatal("an unnumbered message was accepted")
	}
}

// Messages are numbered in the order they were signed, not the order they are
// read, so a later one read first must not shut out an earlier one.
func TestAnOlderSequenceNumberStillGetsInWhileTheWindowHoldsIt(t *testing.T) {
	c, secret := pairedController(t)
	if !c.dispatchPartner(signedFrom(c, secret, 5)) || !c.dispatchPartner(signedFrom(c, secret, 3)) {
		t.Fatal("an out-of-order but unseen number was refused")
	}
	for i := range uint64(dispatchWindow + 10) {
		c.dispatchPartner(signedFrom(c, secret, 100+i))
	}
	if c.dispatchPartner(signedFrom(c, secret, 3)) {
		t.Fatal("a number older than the window was accepted again")
	}
}

func TestEachMessageSentToAPartnerCarriesTheNextSequenceNumber(t *testing.T) {
	c, _ := pairedController(t)
	var got []uint64
	for range 3 {
		m := peermail.Message{ID: "m-y", From: peermail.Party{SessionID: "s-me"}, To: peermail.Party{SessionID: "s-peer"}, SentAt: time.Now().UTC(), Body: "b"}
		c.signDispatch(&m)
		got = append(got, m.Seq)
		if m.Proof == "" {
			t.Fatal("a message to a partner went out unsigned")
		}
	}
	if got[0] != 1 || got[1] != 2 || got[2] != 3 {
		t.Fatalf("sequence numbers = %v, want 1 2 3", got)
	}
	stranger := peermail.Message{To: peermail.Party{SessionID: "s-nobody"}, Body: "b"}
	c.signDispatch(&stranger)
	if stranger.Proof != "" || stranger.Seq != 0 {
		t.Fatalf("a message to a non-partner was signed: %+v", stranger)
	}
}

// The grant a dispatching session passes on sets the approval posture; it must
// not reach past the target project's own rules. A deny rule the project holds
// keeps refusing under an adopted yolo, and a call outside it is the only thing
// the posture lets through.
func TestAdoptingAnApprovalGrantDoesNotLiftTheTargetProjectsDenyRules(t *testing.T) {
	deny, ok := permission.ParseRule("bash(rm:*)")
	if !ok {
		t.Fatal("ParseRule failed")
	}
	c := New(Options{Policy: permission.Policy{Deny: []permission.Rule{deny}}})
	c.AdoptSessionGrant(SessionGrant{Approval: ToolApprovalYolo})
	if c.ToolApprovalMode() != ToolApprovalYolo {
		t.Fatalf("posture = %q, want the grant's", c.ToolApprovalMode())
	}
	gate := c.newInteractiveGate()
	if v, err := permission.VerdictOf(context.Background(), gate, "bash", bashCall(t, "rm -rf build"), false); err != nil || v.Allow {
		t.Fatalf("a call the project denies under an adopted yolo: allow=%v err=%v", v.Allow, err)
	}
	if v, err := permission.VerdictOf(context.Background(), gate, "bash", bashCall(t, "ls"), false); err != nil || !v.Allow {
		t.Fatalf("a call no rule names under yolo: allow=%v err=%v", v.Allow, err)
	}
}
