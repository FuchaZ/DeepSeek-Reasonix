package workspacelist

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"slices"
	"strings"
	"time"

	"reasonix/internal/base/filelock"
	"reasonix/internal/base/fileutil"
)

// FileName is where the list lives, at the top of the state root.
const FileName = "serve-workspaces.json"

// AdoptedSuffix marks a list that has been merged into the current one, so the
// merge happens once.
const AdoptedSuffix = ".adopted"

// List is the remembered project order and the project a launch opens first.
type List struct {
	Paths  []string `json:"paths"`
	Launch string   `json:"launch,omitempty"`
	// Names are the display names a project reads by in the sidebar: a folder
	// renamed there keeps its on-disk path and its files whole.
	Names map[string]string `json:"names,omitempty"`
	// Pinned are the projects that lead the list, in the order they pinned.
	Pinned []string `json:"pinned,omitempty"`
	// Removed are the projects the user took off the sidebar, as opaque
	// identity keys the caller owns. The folder stops being listed; its files
	// stay, and asking for it again is what lifts the removal.
	Removed []string `json:"removed,omitempty"`
	// RemovedPaths keeps the folder path each Removed identity named, so the
	// sidebar can still show the project's archive after a removal — the row
	// needs the folder the tombstone alone cannot name. Cleared with Removed.
	RemovedPaths map[string]string `json:"removedPaths,omitempty"`
}

// maxRemoved bounds the tombstones the list carries, so a long session of
// adding and removing cannot grow the file without end; the oldest gives way.
const maxRemoved = 64

// Remove records that the folder named by the identity id was taken off the
// sidebar. Path is the folder spelling the removal saw, kept so the sidebar can
// still reach the project's archive; empty is allowed. Empty ids and duplicates
// are ignored — a later spelling is ignored too — and the oldest entry gives
// way once the list is full.
func (l *List) Remove(id, path string) {
	id = strings.TrimSpace(id)
	if id == "" || slices.Contains(l.Removed, id) {
		return
	}
	if path = strings.TrimSpace(path); path != "" {
		if l.RemovedPaths == nil {
			l.RemovedPaths = map[string]string{}
		}
		l.RemovedPaths[id] = path
	}
	l.Removed = append(l.Removed, id)
	if len(l.Removed) > maxRemoved {
		for _, gone := range l.Removed[:len(l.Removed)-maxRemoved] {
			delete(l.RemovedPaths, gone)
		}
		l.Removed = l.Removed[len(l.Removed)-maxRemoved:]
	}
}

// Restore clears a removal, so the folder may be listed again. Removing the
// entry is what an explicit add-back means: the user asking for the folder
// outranks a removal, however old.
func (l *List) Restore(id string) {
	id = strings.TrimSpace(id)
	if id == "" {
		return
	}
	delete(l.RemovedPaths, id)
	l.Removed = slices.DeleteFunc(l.Removed, func(removed string) bool { return removed == id })
}

// SetName records the display name a project reads by; empty clears it.
func (l *List) SetName(path, name string) {
	path = strings.TrimSpace(path)
	if path == "" {
		return
	}
	name = strings.TrimSpace(name)
	if name == "" {
		delete(l.Names, path)
		return
	}
	if l.Names == nil {
		l.Names = map[string]string{}
	}
	l.Names[path] = name
}

// SetPinned marks or clears a project's pin; a pinned project leads the list.
func (l *List) SetPinned(path string, pinned bool) {
	path = strings.TrimSpace(path)
	if path == "" {
		return
	}
	at := slices.Index(l.Pinned, path)
	if pinned && at < 0 {
		l.Pinned = append(l.Pinned, path)
	}
	if !pinned && at >= 0 {
		l.Pinned = append(l.Pinned[:at], l.Pinned[at+1:]...)
	}
}

// Read parses the list at path. A missing file or empty path is an empty list.
func Read(path string) (List, error) {
	var list List
	if path == "" {
		return list, nil
	}
	data, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return list, nil
	}
	if err != nil {
		return list, err
	}
	data = bytes.TrimSpace(data)
	if len(data) > 0 && data[0] == '[' {
		err = json.Unmarshal(data, &list.Paths)
	} else {
		err = json.Unmarshal(data, &list)
	}
	if err != nil {
		return List{}, err
	}
	paths := make([]string, 0, len(list.Paths))
	for _, dir := range list.Paths {
		dir = strings.TrimSpace(dir)
		if dir != "" && !slices.Contains(paths, dir) {
			paths = append(paths, dir)
		}
	}
	list.Paths = paths
	removed := make([]string, 0, len(list.Removed))
	for _, id := range list.Removed {
		id = strings.TrimSpace(id)
		if id != "" && !slices.Contains(removed, id) {
			removed = append(removed, id)
		}
	}
	list.Removed = removed
	// A path whose tombstone did not survive the read (a hand-edited file, an
	// older writer) can serve no ghost row: keep the two fields one shape.
	for id := range list.RemovedPaths {
		if !slices.Contains(list.Removed, id) {
			delete(list.RemovedPaths, id)
		}
	}
	if !slices.Contains(paths, list.Launch) {
		list.Launch = ""
		if len(paths) > 0 {
			list.Launch = paths[0]
		}
	}
	return list, nil
}

// defaultLockWait bounds a caller that set no deadline of its own. A caller
// that did owns the bound: writers queue on one lock, so how long the last one
// may wait is a property of how many it expects, not of this package.
var defaultLockWait = 5 * time.Second

// Update applies mutate to the list under its lock and publishes the result
// atomically. With repair, a list that is not valid JSON is set aside as a
// backup and replaced rather than refusing every later write.
func Update(ctx context.Context, path string, repair bool, mutate func(*List) error) error {
	if path == "" {
		return errors.New("no workspace list directory")
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	if _, bounded := ctx.Deadline(); !bounded {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, defaultLockWait)
		defer cancel()
	}
	unlock, err := filelock.Acquire(ctx, path+".lock")
	if err != nil {
		return err
	}
	defer unlock()
	return updateLocked(path, repair, mutate)
}

func updateLocked(path string, repair bool, mutate func(*List) error) error {
	list, err := Read(path)
	if err != nil {
		var syntax *json.SyntaxError
		var shape *json.UnmarshalTypeError
		if !repair || (!errors.As(err, &syntax) && !errors.As(err, &shape)) {
			return err
		}
		if err := backup(path); err != nil {
			return err
		}
		list = List{}
	}
	if err := mutate(&list); err != nil {
		return err
	}
	data, err := json.MarshalIndent(list, "", "  ")
	if err != nil {
		return err
	}
	return fileutil.AtomicWriteFile(path, data, 0o644)
}

func backup(path string) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	f, err := os.CreateTemp(filepath.Dir(path), filepath.Base(path)+".bak-*")
	if err != nil {
		return err
	}
	_, writeErr := f.Write(data)
	return errors.Join(writeErr, f.Close())
}

// MergeOnce appends the projects of the list at old that the list at current
// lacks, then renames old aside so it is merged exactly once: a project the
// user forgets afterwards is not brought back by the next run. Current keeps
// its order and its launch project. It returns how many projects were added.
func MergeOnce(ctx context.Context, current, old string) (int, error) {
	if current == "" || old == "" {
		return 0, nil
	}
	if _, err := os.Stat(old); err != nil {
		if os.IsNotExist(err) {
			return 0, nil
		}
		return 0, err
	}
	incoming, err := Read(old)
	if err != nil {
		return 0, fmt.Errorf("workspace list %s: %w", old, err)
	}
	added := 0
	err = Update(ctx, current, false, func(list *List) error {
		for _, dir := range incoming.Paths {
			if !slices.ContainsFunc(list.Paths, func(have string) bool { return samePath(have, dir) }) {
				list.Paths = append(list.Paths, dir)
				added++
			}
		}
		if list.Launch == "" && len(list.Paths) > 0 {
			list.Launch = list.Paths[0]
		}
		return nil
	})
	if err != nil {
		return 0, err
	}
	return added, fileutil.RenameAside(old, AdoptedSuffix)
}

func samePath(a, b string) bool {
	if runtime.GOOS == "windows" {
		return strings.EqualFold(a, b)
	}
	return a == b
}
