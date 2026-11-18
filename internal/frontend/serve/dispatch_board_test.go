package serve

import (
	"fmt"
	"net/http/httptest"
	"testing"

	"reasonix/internal/session/control"
	"reasonix/internal/state/peermail"
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

// The board reads the trail once per request, not once per session: only the
// sessions a dispatch names can have a row, so a machine holding hundreds of
// conversations answers from its dispatches.
func TestDispatchBoardReadsTheTrailOncePerRequest(t *testing.T) {
	f := newDispatchFixture(t, dispatchOn)
	alpha, billing := f.project("alpha", true), f.project("billing", true)
	sender := f.sender(alpha)
	for i := 0; i < 12; i++ {
		writeSessionAt(t, sessionstore.NewSessionPath(SessionDirFor(alpha), fmt.Sprintf("quiet-%02d", i)))
	}
	got, err := sender.DispatchToProject(t.Context(), billing, "rotate the key", "reviewer")
	if err != nil {
		t.Fatal(err)
	}
	writeSessionAt(t, f.paneOf(got.Key).SessionPath())

	opens := 0
	previous := openPeersTrail
	openPeersTrail = func(dir string) (*peermail.Dir, error) {
		opens++
		return previous(dir)
	}
	t.Cleanup(func() { openPeersTrail = previous })

	if rows := f.hub.dispatchBoard(); len(rows) != 1 {
		t.Fatalf("board rows = %+v, want the one dispatch", rows)
	}
	if opens != 1 {
		t.Fatalf("the trail was read %d times while answering one board, want once", opens)
	}
}

// One walk answers every pane polling the board: a session written after it is
// not named until a read asks for a peer the walk did not hold.
func TestDispatchJoinsSharesOneWalkBetweenReads(t *testing.T) {
	f := newDispatchFixture(t, dispatchOn)
	alpha := f.project("alpha", true)
	first := sessionstore.NewSessionPath(SessionDirFor(alpha), "first")
	writeSessionAt(t, first)
	firstKey := control.PeerKeyForPath(first)
	if _, ok := f.hub.dispatchJoins([]string{firstKey})[firstKey]; !ok {
		t.Fatal("the walk missed a session that was on disk")
	}

	second := sessionstore.NewSessionPath(SessionDirFor(alpha), "second")
	writeSessionAt(t, second)
	secondKey := control.PeerKeyForPath(second)
	if _, ok := f.hub.dispatchJoins([]string{firstKey})[secondKey]; ok {
		t.Fatal("the board walked the tree again for a peer it already knew")
	}
	if _, ok := f.hub.dispatchJoins([]string{secondKey})[secondKey]; !ok {
		t.Fatal("a peer nobody has seen must make the board look again")
	}

	// A peer whose session is gone is answered as absent for the rest of the
	// interval, not walked for again on every read.
	gone := control.PeerKeyForPath(sessionstore.NewSessionPath(SessionDirFor(alpha), "gone"))
	f.hub.dispatchJoins([]string{gone})
	third := sessionstore.NewSessionPath(SessionDirFor(alpha), "third")
	writeSessionAt(t, third)
	if _, ok := f.hub.dispatchJoins([]string{gone})[control.PeerKeyForPath(third)]; ok {
		t.Fatal("a missing peer made the board walk again")
	}
}

// The board's walk is shared between panes, so it has to be dropped when the
// tree changes: an end archived or removed after the walk must leave the board
// at once, not when the interval runs out.
func TestTreeChangedDropsTheBoardWalk(t *testing.T) {
	f := newDispatchFixture(t, dispatchOn)
	alpha := f.project("alpha", true)
	first := sessionstore.NewSessionPath(SessionDirFor(alpha), "first")
	writeSessionAt(t, first)
	firstKey := control.PeerKeyForPath(first)
	if _, ok := f.hub.dispatchJoins([]string{firstKey})[firstKey]; !ok {
		t.Fatal("the walk missed a session that was on disk")
	}

	second := sessionstore.NewSessionPath(SessionDirFor(alpha), "second")
	writeSessionAt(t, second)
	secondKey := control.PeerKeyForPath(second)
	if _, ok := f.hub.dispatchJoins([]string{firstKey})[secondKey]; ok {
		t.Fatal("the walk answered for a session written after it")
	}

	f.hub.treeChanged()
	if _, ok := f.hub.dispatchJoins([]string{secondKey})[secondKey]; !ok {
		t.Fatal("a tree change left the board reading a walk that predates it")
	}
}

// Archiving an end through the route the sidebar uses must reach the board's
// walk, or the row outlives the conversation it names.
func TestDispatchBoardDropsAnEndArchivedAfterTheWalk(t *testing.T) {
	f := newDispatchFixture(t, dispatchOn)
	sender := f.sender(f.project("alpha", true))
	billing := f.project("billing", true)
	got, err := sender.DispatchToProject(t.Context(), billing, "rotate the key", "reviewer")
	if err != nil {
		t.Fatal(err)
	}
	pane := f.paneOf(got.Key)
	writeSessionAt(t, pane.SessionPath())
	if rows := f.hub.dispatchBoard(); len(rows) != 1 {
		t.Fatalf("board rows = %+v, want the one dispatch", rows)
	}

	srv := httptest.NewServer(operatorHandler(f.hub))
	defer srv.Close()
	archiveTreeSession(t, srv, pane.SessionPath(), true)

	if rows := f.hub.dispatchBoard(); len(rows) != 0 {
		t.Fatalf("board rows = %+v, want none once the assignee is archived", rows)
	}
}
