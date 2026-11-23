package control

import (
	"errors"
	"path/filepath"
	"testing"

	"reasonix/internal/base/testenv"
	"reasonix/internal/contract/config"
	"reasonix/internal/state/peermail"
)

// The user's answer about what arrives is also the answer about what may be
// attempted: a session that takes nothing says so on its own record, so a sender
// is refused before it writes rather than after.

func setPeerIncoming(t *testing.T, answer string) {
	t.Helper()
	cfg := config.LoadForEdit(config.UserConfigPath())
	if err := cfg.SetPeersIncoming(answer); err != nil {
		t.Fatal(err)
	}
	if err := cfg.SaveTo(config.UserConfigPath()); err != nil {
		t.Fatal(err)
	}
}

func publishedInbound(t *testing.T, peersDir, key string) string {
	t.Helper()
	d, err := peermail.Open(peersDir)
	if err != nil {
		t.Fatal(err)
	}
	live, _ := d.ListLive(func(peermail.Live) bool { return true })
	for _, l := range live {
		if l.SessionID == key {
			return l.Inbound
		}
	}
	return ""
}

func TestASessionThatTakesNoMessagesPublishesItsRefusal(t *testing.T) {
	peersDir := filepath.Join(testenv.TempDir(t), "peers")
	a := newPeerSession(t, peersDir, "alpha")
	b := newPeerSession(t, peersDir, "beta")
	a.peerIngest()
	b.peerIngest()

	if got := publishedInbound(t, peersDir, b.peers.key); got != "hold" {
		t.Fatalf("default record says %q, want hold", got)
	}

	setPeerIncoming(t, config.IncomingNever)
	b.peerIngest()
	a.peerIngest()

	if got := publishedInbound(t, peersDir, b.peers.key); got != "refuse" {
		t.Fatalf("record says %q, want refuse", got)
	}
	if _, err := a.SendPeerMessage(b.peers.key, "hello"); !errors.Is(err, ErrPeerRefused) {
		t.Fatalf("send to a session that takes nothing = %v, want ErrPeerRefused", err)
	}
	a.peerIngest()
	if got, _ := a.peers.dir.Load().Pending(b.peers.key); len(got) != 0 {
		t.Fatalf("a refused send still reached the spool: %+v", got)
	}
}

// "Never" is the person's decision about arriving mail, so it does not stop this
// session from answering a session it was itself paired with: refusing mail and
// refusing to answer are different answers.
func TestTakingNoMessagesDoesNotSilenceASessionThatWasHandedATask(t *testing.T) {
	peersDir := filepath.Join(testenv.TempDir(t), "peers")
	a := newPeerSession(t, peersDir, "alpha")
	b := newPeerSession(t, peersDir, "beta")
	setDispatchSwitch(t, true, true)
	setPeerIncoming(t, config.IncomingNever)
	b.peerIngest()

	if _, err := a.SendPeerMessage(b.peers.key, "hello"); !errors.Is(err, ErrPeerRefused) {
		t.Fatalf("send = %v, want ErrPeerRefused", err)
	}
	// The pairing is what lets the other direction through, so a reply still
	// leaves this session.
	if _, err := b.SendPeerMessage(a.peers.key, "a reply"); err != nil {
		t.Fatalf("a reply from the refusing session = %v, want it sent", err)
	}
}

// A value nobody meant must not quietly become a wider answer, and the four
// words are the whole vocabulary.
func TestNeverIsOneOfTheFourAnswers(t *testing.T) {
	cfg := &config.Config{}
	if err := cfg.SetPeersIncoming(config.IncomingNever); err != nil {
		t.Fatalf("SetPeersIncoming(never) = %v", err)
	}
	if got := cfg.PeersIncoming(); got != config.IncomingNever {
		t.Fatalf("PeersIncoming() = %q, want never", got)
	}
	if err := cfg.SetPeersIncoming("nope"); err == nil {
		t.Fatal("a value nobody meant was accepted")
	}
}
