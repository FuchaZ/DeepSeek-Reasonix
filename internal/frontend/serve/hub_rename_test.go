package serve

import (
	"errors"
	"testing"

	"reasonix/internal/session/control"
	"reasonix/internal/state/sessionstore"
)

// writeSession puts an empty transcript with an explicit title into dir and
// returns its path, the way a conversation the sidebar lists looks on disk.
func writeSession(t *testing.T, dir, name, title string) string {
	t.Helper()
	path := sessionstore.NewSessionPath(dir, name)
	if err := sessionstore.NewSession("sys").SaveIfAbsent(path); err != nil {
		t.Fatalf("SaveIfAbsent %s: %v", name, err)
	}
	if title != "" {
		if err := sessionstore.SaveBranchMeta(path, sessionstore.BranchMeta{CustomTitle: title, SchemaVersion: sessionstore.BranchMetaCountsVersion}); err != nil {
			t.Fatalf("SaveBranchMeta %s: %v", name, err)
		}
	}
	return path
}

// Naming your own conversation is the baseline: an empty target, and the name
// lands where the sidebar reads titles from.
func TestRenameSessionNamesTheCallersOwnConversation(t *testing.T) {
	f := newDispatchFixture(t, "")
	root := f.project("alpha", true)
	path := writeSession(t, SessionDirFor(root), "mine", "")
	rt := f.adopt(root, path)

	got, err := f.hub.renameSessionFor(rt, "", "研究组")
	if err != nil {
		t.Fatalf("rename own session: %v", err)
	}
	if got.Target != "self" || got.Title != "研究组" {
		t.Fatalf("renamed %q as %q, want self/研究组", got.Target, got.Title)
	}
	if title := f.hub.titleForSession(path); title != "研究组" {
		t.Fatalf("title read back as %q, want 研究组", title)
	}
}

// A session this one never dispatched to cannot be named from here, and that is
// a different answer from a name nobody has: the first is a refused boundary,
// the second is a typo.
func TestRenameSessionRefusesASessionItDidNotDispatchTo(t *testing.T) {
	f := newDispatchFixture(t, "")
	root := f.project("alpha", true)
	mine := writeSession(t, SessionDirFor(root), "mine", "")
	other := writeSession(t, SessionDirFor(root), "someone-elses", "别人的会话")
	rt := f.adopt(root, mine)

	if _, err := f.hub.renameSessionFor(rt, other, "hijacked"); !errors.Is(err, errRenameNotYours) {
		t.Fatalf("renaming a foreign session = %v, want errRenameNotYours", err)
	}
	if title := f.hub.titleForSession(other); title != "别人的会话" {
		t.Fatalf("the foreign session's title changed to %q", title)
	}
	if _, err := f.hub.renameSessionFor(rt, "no-such-session", "x"); !errors.Is(err, errRenameUnknown) {
		t.Fatalf("renaming an unknown name = %v, want errRenameUnknown", err)
	}
}

// A dispatched member is in scope, and the role is what the person typed when
// it was handed the task: naming a member by its role reaches that transcript.
func TestRenameSessionReachesADispatchedMemberByItsRole(t *testing.T) {
	f := newDispatchFixture(t, dispatchOn)
	root := f.project("alpha", true)
	mine := writeSession(t, SessionDirFor(root), "mine", "")
	member := writeSession(t, SessionDirFor(root), "member", "组员A")
	rt := f.adopt(root, mine)

	sender := rt.Server.Controller().(*control.Controller)
	f.hub.dispatch.noteThread(sender.SessionPath(), "组员A", member, control.PeerKeyForPath(member))

	got, err := f.hub.renameSessionFor(rt, "组员A", "组员A 的活")
	if err != nil {
		t.Fatalf("renaming a dispatched member by its role: %v", err)
	}
	if got.Target != "member" || got.Path != member {
		t.Fatalf("renamed %q (%s), want member %s", got.Target, got.Path, member)
	}
	if title := f.hub.titleForSession(member); title != "组员A 的活" {
		t.Fatalf("member title = %q, want 组员A 的活", title)
	}
}

// An empty name is refused before any target is resolved, so a blank rename
// cannot clear a title that a person needs to find the conversation by.
func TestRenameSessionRefusesABlankName(t *testing.T) {
	f := newDispatchFixture(t, "")
	root := f.project("alpha", true)
	mine := writeSession(t, SessionDirFor(root), "mine", "原来的名字")
	rt := f.adopt(root, mine)

	if _, err := f.hub.renameSessionFor(rt, "", "   "); err == nil {
		t.Fatal("a blank name was accepted")
	}
	if title := f.hub.titleForSession(mine); title != "原来的名字" {
		t.Fatalf("title changed to %q by a refused rename", title)
	}
}
