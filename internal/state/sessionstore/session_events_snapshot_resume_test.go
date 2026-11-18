package sessionstore

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"reasonix/internal/base/testenv"
	"reasonix/internal/contract/provider"
	"reasonix/internal/state/store"
)

// sessionWithRewritesAndAppends builds a log holding several full replace
// snapshots interleaved with small appends — the shape a long session grows
// when history is rewritten (rewind, compaction, recovery). Every rewrite
// appends a whole transcript, so stale snapshots dominate the file's size.
func sessionWithRewritesAndAppends(t *testing.T, path string, rewrites int) *Session {
	t.Helper()
	s := NewSession("sys")
	for i := range rewrites {
		s.Replace([]provider.Message{
			{Role: provider.RoleSystem, Content: "sys"},
			{Role: provider.RoleUser, Content: "rewrite " + strconv.Itoa(i)},
			{Role: provider.RoleAssistant, Content: "done " + strconv.Itoa(i)},
		})
		if err := s.SaveRewrite(path); err != nil {
			t.Fatalf("SaveRewrite %d: %v", i, err)
		}
		s.Add(provider.Message{Role: provider.RoleUser, Content: "after " + strconv.Itoa(i)})
		if err := s.SaveSnapshot(path); err != nil {
			t.Fatalf("SaveSnapshot %d: %v", i, err)
		}
	}
	return s
}

func sameTranscriptMessages(a, b []provider.Message) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i].Role != b[i].Role || a[i].Content != b[i].Content {
			return false
		}
	}
	return true
}

// The whole point of resuming at the last snapshot: a log full of superseded
// replace records must produce exactly what replaying it from byte 0 produces.
func TestReplayFromLastSnapshotMatchesFullReplay(t *testing.T) {
	path := filepath.Join(testenv.TempDir(t), "session.jsonl")
	sessionWithRewritesAndAppends(t, path, 5)
	logPath := store.SessionEventLog(path)

	full, err := replaySessionEventRecordsFrom(logPath, defaultSessionReplayLimits, 0)
	if err != nil {
		t.Fatalf("full replay: %v", err)
	}
	fromSnapshot, err := replaySessionEventRecordsFrom(logPath, defaultSessionReplayLimits, -1)
	if err != nil {
		t.Fatalf("snapshot replay: %v", err)
	}
	if full.records < 6 {
		t.Fatalf("fixture too small to prove anything: %d records", full.records)
	}
	if !sameTranscriptMessages(full.msgs, fromSnapshot.msgs) {
		t.Fatalf("snapshot replay diverged: %d msgs vs %d from byte 0", len(fromSnapshot.msgs), len(full.msgs))
	}
	if fromSnapshot.lastGoodEnd != full.lastGoodEnd {
		t.Fatalf("lastGoodEnd = %d, want %d (absolute offset must survive a jump)", fromSnapshot.lastGoodEnd, full.lastGoodEnd)
	}
	if fromSnapshot.damaged || full.damaged {
		t.Fatalf("unexpected damage: snapshot=%v full=%v", fromSnapshot.damaged, full.damaged)
	}
	if fromSnapshot.records >= full.records {
		t.Fatalf("snapshot replay applied %d records, expected fewer than the full %d — it did not skip", fromSnapshot.records, full.records)
	}
}

// A torn tail after the last snapshot must still be reported and positioned at
// the right absolute byte, or the healing truncate would cut the log short.
func TestReplayFromLastSnapshotReportsAbsoluteTornTail(t *testing.T) {
	path := filepath.Join(testenv.TempDir(t), "session.jsonl")
	sessionWithRewritesAndAppends(t, path, 3)
	logPath := store.SessionEventLog(path)

	full, err := replaySessionEventRecordsFrom(logPath, defaultSessionReplayLimits, 0)
	if err != nil {
		t.Fatalf("full replay: %v", err)
	}
	intact := full.lastGoodEnd

	f, err := os.OpenFile(logPath, os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		t.Fatalf("open log: %v", err)
	}
	if _, err := f.Write([]byte(`{"schema_version":1,"type":"append","message_index":999,"mess`)); err != nil {
		t.Fatalf("write torn tail: %v", err)
	}
	f.Close()

	replay, err := replaySessionEventRecordsFrom(logPath, defaultSessionReplayLimits, -1)
	if err != nil {
		t.Fatalf("snapshot replay: %v", err)
	}
	if !replay.damaged {
		t.Fatal("damaged = false, want true for a torn tail")
	}
	if replay.lastGoodEnd != intact {
		t.Fatalf("lastGoodEnd = %d, want %d (the intact boundary, not a jumped-relative one)", replay.lastGoodEnd, intact)
	}
	if !sameTranscriptMessages(replay.msgs, full.msgs) {
		t.Fatalf("torn tail changed the replayed transcript: %d msgs vs %d", len(replay.msgs), len(full.msgs))
	}
}

// The scan finds the replace marker by bytes, which a message's own text can
// contain. A record is only a snapshot when the marker sits in its header.
func TestLastSnapshotOffsetIgnoresTheMarkerInsideMessageText(t *testing.T) {
	path := filepath.Join(testenv.TempDir(t), "session.jsonl")

	s := NewSession("sys")
	s.Replace([]provider.Message{
		{Role: provider.RoleSystem, Content: "sys"},
		{Role: provider.RoleUser, Content: `look for "type":"replace" in this log`},
		{Role: provider.RoleAssistant, Content: `{"schema_version":1,"type":"replace"}`},
	})
	if err := s.SaveRewrite(path); err != nil {
		t.Fatalf("SaveRewrite: %v", err)
	}

	logPath := store.SessionEventLog(path)
	info, err := os.Stat(logPath)
	if err != nil {
		t.Fatalf("stat: %v", err)
	}
	off, ok := lastSnapshotOffset(logPath, info.Size())
	if !ok {
		t.Fatal("lastSnapshotOffset found nothing")
	}
	if off != 0 {
		t.Fatalf("lastSnapshotOffset = %d, want 0: the only record is one replace", off)
	}

	replay, err := replaySessionEventRecordsFrom(logPath, defaultSessionReplayLimits, -1)
	if err != nil {
		t.Fatalf("replay: %v", err)
	}
	if len(replay.msgs) != 3 {
		t.Fatalf("messages = %d, want 3", len(replay.msgs))
	}
	if !strings.Contains(replay.msgs[1].Content, `"type":"replace"`) {
		t.Fatal("fixture lost the misleading message text")
	}
}

// A log whose records are all appends must fall back to reading from the start.
func TestReplayWithoutAnySnapshotReadsFromTheStart(t *testing.T) {
	path := filepath.Join(testenv.TempDir(t), "session.jsonl")
	s := NewSession("sys")
	s.Add(provider.Message{Role: provider.RoleUser, Content: "first"})
	if err := s.SaveSnapshot(path); err != nil {
		t.Fatalf("SaveSnapshot: %v", err)
	}
	s.Add(provider.Message{Role: provider.RoleAssistant, Content: "second"})
	if err := s.SaveSnapshot(path); err != nil {
		t.Fatalf("SaveSnapshot: %v", err)
	}
	logPath := store.SessionEventLog(path)

	replay, err := replaySessionEventRecordsFrom(logPath, defaultSessionReplayLimits, -1)
	if err != nil {
		t.Fatalf("replay: %v", err)
	}
	if replay.damaged {
		t.Fatal("damaged = true without a torn tail")
	}
	if len(replay.msgs) != 3 {
		t.Fatalf("messages = %d, want 3 (a log starting with a snapshot keeps it)", len(replay.msgs))
	}
}
