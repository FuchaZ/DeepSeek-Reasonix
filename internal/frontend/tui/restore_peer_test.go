package tui

import "testing"

// A steer another session sent is not the person's own speech. It still leaves
// a visible trace on a reopened session, so it restores as a notice and never
// as a user row.
func TestRestoreShowsAPeerSteerAsANotice(t *testing.T) {
	tr := &Transcript{}
	tr.Restore([]HistoryMessage{{
		Role: "user", Content: "message from another session: docs",
		Steer: true, HostAuthored: true, PeerSteer: true,
	}})
	if len(tr.Items) != 1 {
		t.Fatalf("restored %d rows, want one: %+v", len(tr.Items), tr.Items)
	}
	row := tr.Items[0]
	if row.Kind != ItemNotice || row.Text != "message from another session: docs" || row.Level != "info" {
		t.Fatalf("peer steer restored as %+v, want an info notice carrying its text", row)
	}
	for _, it := range tr.Items {
		if it.Kind == ItemUser {
			t.Fatalf("a peer steer was drawn as the person's own speech: %+v", it)
		}
	}
}

// A host-authored steer that is not from a peer stays hidden: it was never
// shown live, so a reload must not invent a row for it either.
func TestRestoreHidesAHostAuthoredSteerWithoutAPeer(t *testing.T) {
	tr := &Transcript{}
	tr.Restore([]HistoryMessage{{
		Role: "user", Content: "message from another session: docs",
		Steer: true, HostAuthored: true,
	}})
	if len(tr.Items) != 0 {
		t.Fatalf("restored %d rows, want none: %+v", len(tr.Items), tr.Items)
	}
}
