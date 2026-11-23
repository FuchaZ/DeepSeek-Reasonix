package control

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"reasonix/internal/base/testenv"
	"reasonix/internal/contract/tool"
)

func TestPeerErrorsKeepTheirIdentityAcrossTheToolBoundary(t *testing.T) {
	for code, sentinel := range map[string]error{
		"peer.disabled": ErrPeersDisabled, "peer.not_found": ErrPeerNotFound, "peer.ambiguous": ErrPeerAmbiguous,
		"peer.self": ErrPeerSelf, "peer.refused": ErrPeerRefused, "peer.rate_limited": ErrPeerRateLimited,
		"peer.empty": ErrPeerEmpty, "dispatch.untrusted": ErrDispatchUntrusted,
		"dispatch.awaiting_trust": ErrDispatchAwaitingTrust, "dispatch.same_project": ErrDispatchSameProject,
	} {
		if got := peerErrorCode(sentinel); got != code {
			t.Errorf("%v is %q, want %q", sentinel, got, code)
		}
	}
	if got := peerErrorCode(errors.New("disk full")); got != "peer.send_failed" {
		t.Fatalf("an unknown failure = %q", got)
	}
}

func TestTheControllerBindsItselfToThePeerLinkAndAnswersThroughIt(t *testing.T) {
	peersDir := filepath.Join(testenv.TempDir(t), "peers")
	link := &tool.PeerLink{}
	dir := testenv.TempDir(t)
	path := filepath.Join(dir, "sessions", "alpha.jsonl")
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	a := New(Options{Runner: &inboxDispatchRunner{inputs: make(chan string, 8)}, SessionDir: filepath.Dir(path), SessionPath: path, Peers: PeersOptions{Dir: peersDir, Link: link}})
	t.Cleanup(func() {
		a.Close()
		a.autosaveWG.Wait()
	})
	if _, ok := link.Directory(); !ok {
		t.Fatal("the controller did not bind itself to the link it was given")
	}
	b := newPeerSession(t, peersDir, "beta")
	a.peerIngest()
	bound, _ := link.Directory()
	peers := bound.Peers()
	if len(peers) != 1 || peers[0].Key != b.peers.key {
		t.Fatalf("peers = %+v", peers)
	}
	if _, err := bound.SendPeerMessage("nobody", "hi", ""); err == nil || !strings.HasPrefix(err.Error(), "peer.not_found") {
		t.Fatalf("err = %v, want a refusal that leads with its code", err)
	}
}
