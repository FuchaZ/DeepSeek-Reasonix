package serve

import (
	"context"
	"path/filepath"
	"reasonix/internal/state/sessionstore"
	"sync"
	"time"

	"reasonix/internal/base/nilutil"
	"reasonix/internal/session/control"
)

// A cold title cache cost one model round-trip per session, serialized inside
// GET /sessions: 29 sessions with 17 misses took 11.7s before the list could
// render. A title is decoration on a navigation list, so the request never
// waits for one — the preview stands in and the generated title lands in the
// cache for the next read.
const titleFillWorkers = 4

// titleFillTimeout is a variable so a test can make a slow model cheap to wait for.
var titleFillTimeout = 30 * time.Second

type titleJob struct {
	name   string
	source string
	mod    int64
}

type titleFiller struct {
	mu      sync.Mutex
	pending map[string]struct{}
	// latest is the first message most recently asked for per session: a result
	// for any other is stale and is not stored over a newer one.
	latest map[string]string
	queue  []titleJob
	active int
}

// wanted reports whether source is still the first message to title for name.
func (f *titleFiller) wanted(name, source string) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.latest[name] == source
}

func newTitleFiller() *titleFiller {
	return &titleFiller{pending: map[string]struct{}{}, latest: map[string]string{}}
}

// scheduleTitle queues one generation, deduplicated by session and first message
// so a burst of list requests cannot stack N copies of the same call, while a
// changed first message is a new request and is never taken for the old one.
func (s *Server) scheduleTitle(name, source string, mod int64) {
	if nilutil.IsNil(s.currentTitleProvider().prov) || source == "" {
		return
	}
	f := s.fill
	key := name + "\x00" + source
	f.mu.Lock()
	f.latest[name] = source
	if _, dup := f.pending[key]; dup {
		f.mu.Unlock()
		return
	}
	f.pending[key] = struct{}{}
	f.queue = append(f.queue, titleJob{name: name, source: source, mod: mod})
	spawn := f.active < titleFillWorkers
	if spawn {
		f.active++
	}
	f.mu.Unlock()
	if spawn {
		go s.drainTitles()
	}
}

func (s *Server) drainTitles() {
	f := s.fill
	for {
		f.mu.Lock()
		if len(f.queue) == 0 {
			f.active--
			f.mu.Unlock()
			return
		}
		job := f.queue[0]
		f.queue = f.queue[1:]
		f.mu.Unlock()

		ctx, cancel := context.WithTimeout(context.Background(), titleFillTimeout)
		title := s.generateTitle(ctx, job.source, sessionstore.BranchID(job.name))
		cancel()
		if title != "" && s.titles.putIf(job.name, title, job.source, job.mod, func() bool { return f.wanted(job.name, job.source) }) {
			s.bc.treeChanged()
		}

		f.mu.Lock()
		delete(f.pending, job.name+"\x00"+job.source)
		if f.latest[job.name] == job.source {
			delete(f.latest, job.name)
		}
		f.mu.Unlock()
	}
}

// sessionTitle prefers an explicit title, then a matching automatic title.
// A miss shows the preview while background generation fills the cache.
func (s *Server) sessionTitle(name, first string, mod int64, custom string) string {
	return s.sessionTitleFrom(s.titles.snapshot(), name, first, mod, custom)
}

func (s *Server) sessionTitleFrom(titles titleSnapshot, name, first string, mod int64, custom string) string {
	source := titleSource(first)
	if cached := titles.display(name, source, mod, custom); cached != "" {
		return cached
	}
	s.scheduleTitle(name, source, mod)
	return previewTitle(source)
}

// nameWorkspaceHolder lets a session waiting on this workspace see which
// conversation is writing: the title the sidebar shows, else its first
// message. Only a cached title is read; naming a holder never costs a call.
func (s *Server) nameWorkspaceHolder(ctrl control.SessionAPI) {
	named, ok := ctrl.(interface{ NameWorkspaceHolder(func() string) })
	if !ok {
		return
	}
	named.NameWorkspaceHolder(func() string {
		path := ctrl.SessionPath()
		if path == "" {
			return ""
		}
		preview, _ := sessionstore.SessionPreview(path)
		if title, ok := s.titles.get(filepath.Base(path), titleSource(preview), sessionstore.SessionContentModTime(path).UnixNano()); ok {
			return title
		}
		return previewTitle(preview)
	})
}

func previewTitle(first string) string {
	first = titleSource(first)
	if r := []rune(first); len(r) > 50 {
		return string(r[:47]) + "..."
	}
	return first
}
