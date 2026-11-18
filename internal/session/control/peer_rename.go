package control

import (
	"errors"
	"sync/atomic"

	"reasonix/internal/contract/tool"
)

// ErrRenameUnavailable says this session has no window to name a conversation
// in (a terminal or protocol session). The host that owns the panes supplies
// the ability; without it the rename tool fails closed.
var ErrRenameUnavailable = errors.New("this session has no window to name sessions in (it is a terminal or protocol session); naming a conversation needs Reasonix Studio or the web UI")

// SessionRename is the host-side ability to name a session. An empty to names
// the caller's own session; a non-empty one is a peer the host must verify the
// caller dispatched to before renaming.
type SessionRename func(to, title string) (tool.RenamedSession, error)

// renameState is the controller's side of session naming. The hook is injected
// by the serve layer, which owns the panes and the dispatch record, and is
// replaced whenever the controller is rebuilt.
type renameState struct {
	hook atomic.Pointer[SessionRename]
}

// PeerKeyForPath is the address a session at path is filed under, for a caller
// outside this package that has a path and needs the key peers list by. An
// empty path has no key.
func PeerKeyForPath(path string) string {
	return sessionPeerKey(path)
}

// SetSessionRenamer installs (or clears) the host that names sessions for this
// controller. A nil hook fails closed in RenameSession.
func (c *Controller) SetSessionRenamer(r SessionRename) {
	if c == nil || c.peers == nil {
		return
	}
	if r == nil {
		c.peers.rename.hook.Store(nil)
		return
	}
	c.peers.rename.hook.Store(&r)
}

// RenameSession names this session (empty to) or one it dispatched to.
func (c *Controller) RenameSession(to, title string) (tool.RenamedSession, error) {
	if c == nil || c.peers == nil {
		return tool.RenamedSession{}, ErrRenameUnavailable
	}
	hook := c.peers.rename.hook.Load()
	if hook == nil {
		return tool.RenamedSession{}, ErrRenameUnavailable
	}
	return (*hook)(to, title)
}
