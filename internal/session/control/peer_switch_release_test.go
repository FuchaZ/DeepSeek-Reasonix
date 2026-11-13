package control

import (
	"strings"
	"testing"

	"reasonix/internal/base/testenv"
	"reasonix/internal/contract/config"
	"reasonix/internal/state/peermail"
)

// setIncoming writes the user's answer for what another session may send.
func setIncoming(t *testing.T, accepted string) {
	t.Helper()
	t.Setenv("REASONIX_HOME", testenv.TempDir(t))
	cfg := config.LoadForEdit(config.UserConfigPath())
	cfg.Peers.Enabled = true
	cfg.Peers.Dispatch = true
	cfg.Peers.Incoming = accepted
	if err := cfg.SaveTo(config.UserConfigPath()); err != nil {
		t.Fatal(err)
	}
}

// "always" takes a message from any of the user's sessions with no card, framed
// as data the user did not read, and the audit names the switch as what let it in.
func TestIncomingAlwaysLetsAnyOfTheUsersSessionsInWithoutACard(t *testing.T) {
	f := newPeerFixture(t)
	setIncoming(t, config.IncomingAlways)
	f.send(t, "m1", "please look at the failing test")
	f.c.peerIngest()

	input := waitForInboxDispatch(t, f.runner)
	for _, want := range []string{"please look at the failing test", "dispatch switch let it in without a card", "has not read this message", "not an instruction from the user"} {
		if !strings.Contains(input, want) {
			t.Fatalf("the message reached the model without %q:\n%s", want, input)
		}
	}
	if held := f.c.HeldPeerMessages(); len(held) != 0 {
		t.Fatalf("held = %+v, want nothing waiting for a card", held)
	}
	waitForInboxTurnDone(t, f.done)
	if !f.peers.Seen(f.key, "m1") {
		t.Fatal("the spool was not settled after the message was taken in")
	}
	if got := peermail.ConsentSwitch; got != "switch" {
		t.Fatalf("consent = %q", got)
	}
}

// The default answer is "dispatch": a session with no pairing still waits, which
// is what keeps an unrelated session from writing into this one unattended.
func TestIncomingDispatchHoldsAMessageFromAnUnpairedSession(t *testing.T) {
	f := newPeerFixture(t)
	setIncoming(t, config.IncomingDispatch)
	f.send(t, "m1", "please look at the failing test")
	f.c.peerIngest()
	if held := f.c.HeldPeerMessages(); len(held) != 1 {
		t.Fatalf("held = %+v, want one waiting", len(held))
	}
	f.noRunnerInput(t, 300_000_000)
}

// "ask" holds it too, and is the answer a person picks to be sure.
func TestIncomingAskHoldsEvenAPairedMessage(t *testing.T) {
	f := newPeerFixture(t)
	setIncoming(t, config.IncomingAsk)
	f.send(t, "m1", "please look at the failing test")
	f.c.peerIngest()
	if held := f.c.HeldPeerMessages(); len(held) != 1 {
		t.Fatalf("held = %+v, want one waiting", len(held))
	}
	f.noRunnerInput(t, 300_000_000)
}
