package builtin

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"reasonix/internal/contract/tool"
)

// seqPeers scripts the state a waiting send sees, one reading per call.
type seqPeers struct {
	fakePeers
	states []tool.PeerMessageState
	calls  int
}

func (f *seqPeers) PeerMessageState(string) (tool.PeerMessageState, bool) {
	st := f.states[min(f.calls, len(f.states)-1)]
	f.calls++
	return st, true
}

func sendWaitArgs(waitMS int) json.RawMessage {
	args, _ := json.Marshal(map[string]any{"to": "s-1", "text": "hello", "wait_ms": waitMS})
	return args
}

// Without wait_ms the send returns on the receipt and never reads state: the
// fire-and-forget shape stays exactly what it was.
func TestSendWithoutWaitReturnsOnTheReceipt(t *testing.T) {
	dir := &seqPeers{states: []tool.PeerMessageState{{State: "replied", Reply: "late"}}}
	link := &tool.PeerLink{}
	link.Bind(dir)
	_, send := peerToolsFor(link)
	out, err := send.Execute(context.Background(), sendWaitArgs(0))
	if err != nil {
		t.Fatal(err)
	}
	if dir.calls != 0 {
		t.Fatalf("state was read %d times without wait_ms", dir.calls)
	}
	if !strings.Contains(out, "Delivered") || strings.Contains(out, "replied") {
		t.Fatalf("receipt = %q, want the plain receipt", out)
	}
}

// A waiting send returns the answer the moment one names the message.
func TestSendWaitReturnsTheReply(t *testing.T) {
	dir := &seqPeers{states: []tool.PeerMessageState{
		{State: "queued"},
		{State: "accepted"},
		{State: "replied", Reply: "the answer"},
	}}
	link := &tool.PeerLink{}
	link.Bind(dir)
	_, send := peerToolsFor(link)
	out, err := send.Execute(context.Background(), sendWaitArgs(30000))
	if err != nil {
		t.Fatal(err)
	}
	if dir.calls != 3 {
		t.Fatalf("state readings = %d, want 3", dir.calls)
	}
	if !strings.Contains(out, "the answer") {
		t.Fatalf("result = %q, want the reply in it", out)
	}
}

// A decline ends the wait without an answer.
func TestSendWaitReturnsOnDecline(t *testing.T) {
	dir := &seqPeers{states: []tool.PeerMessageState{{State: "declined"}}}
	link := &tool.PeerLink{}
	link.Bind(dir)
	_, send := peerToolsFor(link)
	out, err := send.Execute(context.Background(), sendWaitArgs(30000))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out, "declined") {
		t.Fatalf("result = %q, want the decline reported", out)
	}
}

// No answer inside the window: the send says what it waited and what the
// message's state is, rather than guessing an outcome.
func TestSendWaitTimesOutOnTheLastState(t *testing.T) {
	dir := &seqPeers{states: []tool.PeerMessageState{{State: "accepted"}}}
	link := &tool.PeerLink{}
	link.Bind(dir)
	_, send := peerToolsFor(link)
	out, err := send.Execute(context.Background(), sendWaitArgs(700))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out, "No answer after waiting 700ms") || !strings.Contains(out, "accepted") {
		t.Fatalf("result = %q, want the timeout naming the state", out)
	}
	if dir.calls < 2 {
		t.Fatalf("state readings = %d, want the wait to poll", dir.calls)
	}
}
