package serve

import (
	"testing"

	"reasonix/internal/session/control"
	"reasonix/internal/state/sessionstore"
)

func archiveSessionForTest(t *testing.T, path string) {
	t.Helper()
	m, _, err := sessionstore.LoadBranchMeta(path)
	if err != nil {
		t.Fatal(err)
	}
	m.Archived = true
	if err := sessionstore.SaveBranchMeta(path, m); err != nil {
		t.Fatal(err)
	}
}

// The board exists so a person can read what was handed to whom: both ends of
// the dispatch named, the role the sender gave, and the state it stands in.
func TestDispatchBoardCollectsBothEndsOfADispatch(t *testing.T) {
	f := newDispatchFixture(t, dispatchOn)
	sender := f.sender(f.project("alpha", true))
	billing := f.project("billing", true)
	got, err := sender.DispatchToProject(t.Context(), billing, "rotate the key", "reviewer")
	if err != nil {
		t.Fatal(err)
	}
	pane := f.paneOf(got.Key)
	writeSessionAt(t, pane.SessionPath())

	rows := f.hub.dispatchBoard()
	if len(rows) != 1 {
		t.Fatalf("board rows = %+v, want one", rows)
	}
	row := rows[0]
	if row.Assignee.SessionPath != pane.SessionPath() || row.Assignee.Project != billing {
		t.Fatalf("assignee = %+v, want path %q in %q", row.Assignee, pane.SessionPath(), billing)
	}
	if row.Dispatcher.SessionPath != sender.SessionPath() {
		t.Fatalf("dispatcher = %+v, want %q", row.Dispatcher, sender.SessionPath())
	}
	if row.Role != "reviewer" || row.State != string(control.PeerWaiting) {
		t.Fatalf("row = %+v, want role reviewer and waiting", row)
	}
	if !row.CrossProject {
		t.Fatalf("row = %+v, want crossProject across alpha and billing", row)
	}
}

// A member's reply must not read as a second task: the role-bearing row is the
// dispatch, and it is the one that carries the state.
func TestDedupeBoardRepliesKeepsTheRoleBearingRow(t *testing.T) {
	rows := []DispatchBoardRow{
		{Dispatcher: DispatchBoardParty{SessionPath: "/member"}, Assignee: DispatchBoardParty{SessionPath: "/lead"}, State: "working"},
		{Dispatcher: DispatchBoardParty{SessionPath: "/lead"}, Assignee: DispatchBoardParty{SessionPath: "/member"}, Role: "研究员", State: "replied"},
	}
	kept := dedupeBoardReplies(rows)
	if len(kept) != 1 || kept[0].Role != "研究员" || kept[0].Dispatcher.SessionPath != "/lead" {
		t.Fatalf("kept = %+v, want the single role-bearing dispatch", kept)
	}
}

func TestDedupeBoardRepliesKeepsUnpairedMessages(t *testing.T) {
	rows := []DispatchBoardRow{
		{Dispatcher: DispatchBoardParty{SessionPath: "/a"}, Assignee: DispatchBoardParty{SessionPath: "/b"}, State: "waiting"},
	}
	if kept := dedupeBoardReplies(rows); len(kept) != 1 {
		t.Fatalf("kept = %+v, want the row kept when no role-bearing reverse exists", kept)
	}
}

// A closed chapter must not keep asking for attention: once either end is
// archived, its row leaves the board.
func TestDispatchBoardHidesArchivedEnds(t *testing.T) {
	f := newDispatchFixture(t, dispatchOn)
	sender := f.sender(f.project("alpha", true))
	billing := f.project("billing", true)
	got, err := sender.DispatchToProject(t.Context(), billing, "rotate the key", "reviewer")
	if err != nil {
		t.Fatal(err)
	}
	pane := f.paneOf(got.Key)
	writeSessionAt(t, pane.SessionPath())

	archiveSessionForTest(t, pane.SessionPath())
	if rows := f.hub.dispatchBoard(); len(rows) != 0 {
		t.Fatalf("board rows = %+v, want none once the assignee is archived", rows)
	}
}
