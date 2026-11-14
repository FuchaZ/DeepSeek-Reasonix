// titleauto.go — naming a conversation from the turn that opened it.
package serve

import (
	"context"
	"encoding/json"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"reasonix/internal/base/nilutil"
	"reasonix/internal/state/sessionstore"
)

// watchFirstTurn names the pane's conversation from the first turn's own
// message. The ask starts when that turn does, so it runs beside the answer
// rather than after it; only the store waits for the transcript, because the
// sidebar matches a cached title against what that transcript records.
func (s *Server) watchFirstTurn() {
	ch, unsubscribe := s.bc.Subscribe()
	go func() {
		defer unsubscribe()
		var naming sync.Map
		for frame := range ch {
			var head struct {
				Kind         string `json:"kind"`
				AuthoredTurn *int   `json:"authoredTurn"`
				Text         string `json:"text"`
			}
			if json.Unmarshal(frame.Data, &head) != nil {
				continue
			}
			// Only an authored turn offers its number; a steer, a fold digest
			// and a synthetic continuation report none.
			if head.Kind != "turn_started" || head.AuthoredTurn == nil || *head.AuthoredTurn != 1 {
				continue
			}
			path := ""
			if ctrl := s.ctl(); !nilutil.IsNil(ctrl) {
				path = ctrl.SessionPath()
			}
			if path == "" || head.Text == "" {
				continue
			}
			// A repeated start names one turn, not two: without this the second
			// one asks again for a title the first is still waiting to store.
			if _, busy := naming.LoadOrStore(path, struct{}{}); busy {
				continue
			}
			go func(path, first string) {
				defer naming.Delete(path)
				s.nameFirstTurn(path, first)
			}(path, head.Text)
		}
	}()
}

// nameFirstTurn asks the title model over the message the person just sent,
// then stores the answer under the preview the sidebar will read. A title the
// person typed, or one already cached, needs no call.
func (s *Server) nameFirstTurn(path, first string) {
	model := s.currentTitleProvider()
	if nilutil.IsNil(model.prov) || !model.declared || s.namedByAPerson(path) {
		return
	}
	name := filepath.Base(path)
	if source, mod, ok := s.firstTurnPreview(path); ok && s.titles.display(name, source, mod, "") != "" {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), titleFillTimeout)
	defer cancel()
	title, err := s.tryGenerateTitle(ctx, first)
	if err != nil || title == "" || s.namedByAPerson(path) {
		return
	}
	source, mod, ok := s.awaitFirstTurnPreview(path)
	// A pane that moved on to another conversation would file this name under
	// whichever transcript it reads now.
	if !ok || s.currentSessionPath() != path {
		return
	}
	if s.titles.display(name, source, mod, "") != "" {
		return
	}
	s.titles.put(name, title, source, mod)
	s.bc.treeChanged()
}

// awaitFirstTurnPreview waits for the sidecar to carry the first turn. The save
// and the ask start together, so the model can answer before the transcript is
// written; Preview is what every reader hashes a cached title against.
func (s *Server) awaitFirstTurnPreview(path string) (string, int64, bool) {
	deadline := time.Now().Add(titleFillTimeout)
	for {
		if source, mod, ok := s.firstTurnPreview(path); ok {
			return source, mod, true
		}
		if !time.Now().Before(deadline) {
			return "", 0, false
		}
		time.Sleep(20 * time.Millisecond)
	}
}

// firstTurnPreview reads the listing preview the sidebar hashes, which is also
// the only preview a title written now would ever match.
func (s *Server) firstTurnPreview(path string) (string, int64, bool) {
	meta, ok, err := sessionstore.LoadBranchMeta(path)
	if err != nil || !ok || strings.TrimSpace(meta.Preview) == "" {
		return "", 0, false
	}
	return titleSource(meta.Preview), sessionstore.SessionContentModTime(path).UnixNano(), true
}

// namedByAPerson reports a title the user typed, which no generated name may
// replace.
func (s *Server) namedByAPerson(path string) bool {
	meta, ok, err := sessionstore.LoadBranchMeta(path)
	return err == nil && ok && meta.CustomTitle != ""
}

// currentSessionPath is ctl().SessionPath() with the absent controller a host
// may still be building answered as no conversation.
func (s *Server) currentSessionPath() string {
	if ctrl := s.ctl(); !nilutil.IsNil(ctrl) {
		return ctrl.SessionPath()
	}
	return ""
}
