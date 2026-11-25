package builtin

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"reasonix/internal/contract/tool"
)

// PeerTools lets the model see the other sessions on this machine and send one
// of them text. They exist only in a session that turned messages between
// sessions on, so a session with them off has no such tool in its schema.
func PeerTools(link *tool.PeerLink) []tool.Tool {
	return []tool.Tool{&listPeers{link: link}, &sendPeerMessage{link: link}}
}

type listPeers struct{ link *tool.PeerLink }

func (*listPeers) Name() string { return "list_peers" }
func (*listPeers) Description() string {
	return "List the other Reasonix sessions on this machine that are listening for messages. Use the name or key it prints as the target of send_peer_message. A row marked busy is in the middle of a turn: its side reads your message at its next model request, not when the whole turn ends. A row named role= is a session a dispatch opened to do that job."
}
func (*listPeers) Schema() json.RawMessage {
	return json.RawMessage(`{"type":"object","properties":{},"additionalProperties":false}`)
}
func (*listPeers) ReadOnly() bool { return true }

func (t *listPeers) Execute(_ context.Context, _ json.RawMessage) (string, error) {
	dir, ok := t.link.Directory()
	if !ok {
		return "peer.disabled: messages between sessions are not available in this session", nil
	}
	peers := dir.Peers()
	if len(peers) == 0 {
		return "No other session on this machine is listening.", nil
	}
	var b strings.Builder
	for _, p := range peers {
		name := p.Title
		if p.Project != "" {
			name = p.Project + "/" + p.Title
		}
		fmt.Fprintf(&b, "%s\tkey=%s", name, p.Key)
		if p.Busy {
			b.WriteString("\tbusy")
		}
		if p.Purpose != "" {
			fmt.Fprintf(&b, "\trole=%s", p.Purpose)
		}
		b.WriteString("\n")
	}
	return b.String(), nil
}

type sendPeerMessage struct{ link *tool.PeerLink }

func (*sendPeerMessage) Name() string { return "send_peer_message" }
func (*sendPeerMessage) Description() string {
	return "Send text to another Reasonix session on this machine, named by list_peers. While the user's dispatch switch is on (the default) its model reads it at its next model request — mid-turn if that session is working — labelled as coming from you; with the switch off it waits there for its user to approve it. Sending grants no permission and is not a way to run anything there: it is for passing information. Do not include secrets. Set reply_to to the id of the message you are answering so the sender can match your answer to its question; set wait_ms to wait for the receiver's side to decide and answer instead of returning at once."
}
func (*sendPeerMessage) Schema() json.RawMessage {
	return json.RawMessage(`{"type":"object","properties":{"to":{"type":"string","description":"The session's key, or its title, or project/title, as list_peers prints it"},"text":{"type":"string","description":"What to tell that session"},"reply_to":{"type":"string","description":"Optional. The id of the message this answers, as the message's frame or the send receipt prints it"},"wait_ms":{"type":"integer","description":"Optional. Milliseconds to wait for the receiver's side to decide and answer (max 120000). 0 returns at once"}},"required":["to","text"],"additionalProperties":false}`)
}
func (*sendPeerMessage) ReadOnly() bool { return false }

// maxPeerWait caps how long one send may wait for the other side.
const maxPeerWait = 120 * time.Second

func (t *sendPeerMessage) Execute(_ context.Context, args json.RawMessage) (string, error) {
	var in struct {
		To      string `json:"to"`
		Text    string `json:"text"`
		ReplyTo string `json:"reply_to"`
		WaitMS  int    `json:"wait_ms"`
	}
	if err := json.Unmarshal(args, &in); err != nil {
		return "", fmt.Errorf("send_peer_message needs {\"to\", \"text\"}: %w", err)
	}
	dir, ok := t.link.Directory()
	if !ok {
		return "", errors.New("peer.disabled: messages between sessions are not available in this session")
	}
	receipt, err := dir.SendPeerMessage(in.To, in.Text, in.ReplyTo)
	if err != nil {
		return "", err
	}
	if in.WaitMS <= 0 {
		return fmt.Sprintf("Delivered to %q as %s. Its model reads it at its next model request, mid-turn if that session is working (it waits for its user only if the dispatch switch is off); there is no reply unless that session sends one.", receipt.To.Title, receipt.ID), nil
	}
	wait := min(time.Duration(in.WaitMS)*time.Millisecond, maxPeerWait)
	deadline := time.Now().Add(wait)
	state := tool.PeerMessageState{State: "queued"}
	for {
		if st, ok := dir.PeerMessageState(receipt.ID); ok {
			state = st
			if st.State == "replied" || st.State == "declined" {
				break
			}
		}
		if time.Now().After(deadline) {
			break
		}
		time.Sleep(300 * time.Millisecond)
	}
	switch state.State {
	case "replied":
		return fmt.Sprintf("Delivered to %q as %s. %s replied: %s", receipt.To.Title, receipt.ID, receipt.To.Title, state.Reply), nil
	case "declined":
		return fmt.Sprintf("Delivered to %q as %s. That session's side declined the message.", receipt.To.Title, receipt.ID), nil
	default:
		return fmt.Sprintf("Delivered to %q as %s. No answer after waiting %dms; the message is %s with its side.", receipt.To.Title, receipt.ID, wait.Milliseconds(), state.State), nil
	}
}
