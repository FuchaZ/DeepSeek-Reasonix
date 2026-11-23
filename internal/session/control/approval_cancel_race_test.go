package control

import (
	"context"
	"errors"
	"testing"
	"time"

	"reasonix/internal/contract/event"
)

// A decision the person made belongs to them, not to the turn that asked for
// it: when the answer and the cancellation arrive together, the grant still
// matters to the next call.

func TestADecisionThatArrivesWithTheCancellationIsNotThrownAway(t *testing.T) {
	c, _, _ := newInboxDispatchController(t)

	// A prompt that no auto/yolo rule answers, so it really waits.
	ctx, cancel := context.WithCancel(t.Context())
	type reply struct {
		allow   bool
		session bool
		err     error
	}
	done := make(chan reply, 1)
	go func() {
		r, err := c.requestApprovalDecision(ctx, approvalRequest{
			tool: "write_file", subject: "notes.md", reason: "test",
		})
		done <- reply{r.allow, r.session, err}
	}()

	// Wait until the prompt is on the queue, then answer and cancel in the same
	// instant: whichever the runtime schedules first, both have happened.
	var id string
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		approvals, _ := c.approval.snapshotPrompts()
		for _, a := range approvals {
			id = a.ID
		}
		if id != "" {
			break
		}
		time.Sleep(5 * time.Millisecond)
	}
	if id == "" {
		t.Fatal("no prompt appeared")
	}

	c.Approve(id, true, true, false)
	cancel()

	select {
	case got := <-done:
		// Either ordering is legal for the *call*: the turn may be told it was
		// cancelled. What must survive is the grant, so the next call in the
		// same scope is not asked again.
		if got.err != nil && !errors.Is(got.err, context.Canceled) {
			t.Fatalf("unexpected error: %v", got.err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("the wait never returned")
	}

	if !c.approval.preApprovedForDecision("write_file", "notes.md", nil, false) {
		t.Fatal("an approved session grant was lost when the turn was cancelled")
	}
}

// The prompt the person answered must not stay on the queue either: a card left
// behind would be replayed to a reconnecting window as still waiting.
func TestAnAnsweredPromptDoesNotStayOnTheQueue(t *testing.T) {
	c, _, _ := newInboxDispatchController(t)
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	done := make(chan struct{})
	go func() {
		defer close(done)
		_, _ = c.requestApprovalDecision(ctx, approvalRequest{
			tool: "write_file", subject: "notes.md", reason: "test", fresh: true,
		})
	}()

	var id string
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		approvals, _ := c.approval.snapshotPrompts()
		for _, a := range approvals {
			id = a.ID
		}
		if id != "" {
			break
		}
		time.Sleep(5 * time.Millisecond)
	}
	if id == "" {
		t.Fatal("no prompt appeared")
	}
	c.Approve(id, true, true, false)
	<-done

	approvals, _ := c.approval.snapshotPrompts()
	for _, a := range approvals {
		if a.ID == id {
			t.Fatalf("an answered prompt %s is still queued", id)
		}
	}
}

var _ = event.Approval{}
