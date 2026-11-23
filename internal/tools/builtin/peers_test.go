package builtin

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"reasonix/internal/contract/tool"
)

type fakePeers struct {
	peers []tool.PeerView
	sent  []string
	err   error
	state tool.PeerMessageState
}

func (f *fakePeers) Peers() []tool.PeerView { return f.peers }
func (f *fakePeers) SendPeerMessage(to, text, replyTo string) (tool.PeerReceipt, error) {
	if f.err != nil {
		return tool.PeerReceipt{}, f.err
	}
	f.sent = append(f.sent, to+"|"+text+"|"+replyTo)
	return tool.PeerReceipt{ID: "m-1", To: tool.PeerView{Key: "s-1", Title: "docs", Project: "notes"}}, nil
}
func (f *fakePeers) PeerMessageState(string) (tool.PeerMessageState, bool) {
	return f.state, true
}

func peerToolsFor(link *tool.PeerLink) (list, send tool.Tool) {
	tools := PeerTools(link)
	return tools[0], tools[1]
}

func TestPeerToolsSaySoWhenNoControllerIsBound(t *testing.T) {
	list, send := peerToolsFor(&tool.PeerLink{})
	out, err := list.Execute(context.Background(), nil)
	if err != nil || !strings.HasPrefix(out, "peer.disabled") {
		t.Fatalf("list = %q, %v", out, err)
	}
	if _, err := send.Execute(context.Background(), json.RawMessage(`{"to":"x","text":"y"}`)); err == nil || !strings.HasPrefix(err.Error(), "peer.disabled") {
		t.Fatalf("send = %v, want the typed disabled refusal", err)
	}
}

func TestPeerToolsListAndSendThroughTheBoundDirectory(t *testing.T) {
	link := &tool.PeerLink{}
	fake := &fakePeers{peers: []tool.PeerView{{Key: "s-1", Title: "docs", Project: "notes"}}}
	link.Bind(fake)
	list, send := peerToolsFor(link)
	if !list.ReadOnly() || send.ReadOnly() {
		t.Fatal("listing reads; sending is an outward effect")
	}
	out, err := list.Execute(context.Background(), nil)
	if err != nil || !strings.Contains(out, "notes/docs") || !strings.Contains(out, "key=s-1") {
		t.Fatalf("list = %q, %v", out, err)
	}
	got, err := send.Execute(context.Background(), json.RawMessage(`{"to":"notes/docs","text":"hello"}`))
	if err != nil || !strings.Contains(got, "m-1") || len(fake.sent) != 1 || fake.sent[0] != "notes/docs|hello|" {
		t.Fatalf("send = %q, %v, sent %v", got, err, fake.sent)
	}
}

func TestPeerSendRefusalsReachTheModelWithTheirIdentity(t *testing.T) {
	link := &tool.PeerLink{}
	link.Bind(&fakePeers{err: errors.New("peer.rate_limited: too many messages sent in a short time")})
	_, send := peerToolsFor(link)
	if _, err := send.Execute(context.Background(), json.RawMessage(`{"to":"a","text":"b"}`)); err == nil || !strings.HasPrefix(err.Error(), "peer.rate_limited") {
		t.Fatalf("err = %v", err)
	}
	if _, err := send.Execute(context.Background(), json.RawMessage(`not json`)); err == nil {
		t.Fatal("malformed arguments were accepted")
	}
	for _, tl := range PeerTools(link) {
		if strings.Contains(strings.ToLower(tl.Description()), "safe") {
			t.Fatalf("%s describes itself as safe instead of stating facts: %q", tl.Name(), tl.Description())
		}
	}
}
