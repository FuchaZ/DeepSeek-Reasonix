package peermail

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"reasonix/internal/base/testenv"
)

func open(t *testing.T) (*Dir, string) {
	t.Helper()
	root := filepath.Join(testenv.TempDir(t), "peers")
	d, err := Open(root)
	if err != nil {
		t.Fatal(err)
	}
	return d, root
}

func msg(id string) Message {
	return Message{
		ID: id, SentAt: time.Unix(1, 0).UTC(), Hops: 0, Body: "hello from a",
		From: Party{SessionID: "sess-a", WriterID: "sess-a", Title: "A", Project: "alpha"},
		To:   Party{SessionID: "sess-b", WriterID: "sess-b"},
	}
}

func TestAMessageRoundTripsAndIsAddressedToItsReceiverOnly(t *testing.T) {
	d, _ := open(t)
	if err := d.Send(msg("m1")); err != nil {
		t.Fatal(err)
	}
	got, rejected := d.Pending("sess-b")
	if len(got) != 1 || got[0].ID != "m1" || got[0].Body != "hello from a" || len(rejected) != 0 {
		t.Fatalf("pending = %+v rejected %+v", got, rejected)
	}
	if other, _ := d.Pending("sess-c"); len(other) != 0 {
		t.Fatalf("another runtime read a message not addressed to it: %+v", other)
	}
}

func TestEveryIdentityThatBecomesAPathIsRefusedWhenItCouldEscape(t *testing.T) {
	d, root := open(t)
	for _, bad := range []string{"", ".", "..", "../x", "a/b", `a\b`, ".hidden", strings.Repeat("a", 65), "a b"} {
		m := msg("ok")
		m.ID = bad
		if err := d.Send(m); !errors.Is(err, ErrInvalid) {
			t.Fatalf("id %q: %v, want ErrInvalid", bad, err)
		}
		m = msg("ok")
		m.To.SessionID = bad
		if err := d.Send(m); !errors.Is(err, ErrInvalid) {
			t.Fatalf("receiver %q: %v, want ErrInvalid", bad, err)
		}
		if err := d.PublishLive(Live{SessionID: bad, Inbound: "hold"}); !errors.Is(err, ErrInvalid) {
			t.Fatalf("live %q: %v, want ErrInvalid", bad, err)
		}
		if err := d.Ack(bad, "x"); !errors.Is(err, ErrInvalid) {
			t.Fatalf("ack %q: %v, want ErrInvalid", bad, err)
		}
	}
	if entries, _ := os.ReadDir(filepath.Dir(root)); len(entries) != 1 {
		t.Fatalf("a refused identity left something beside the directory: %v", entries)
	}
}

func TestSizeHopsAndEmptyBodiesAreRefusedWithTheirOwnIdentity(t *testing.T) {
	d, _ := open(t)
	big := msg("big")
	big.Body = strings.Repeat("x", MaxBodyBytes+1)
	if err := d.Send(big); !errors.Is(err, ErrTooLarge) {
		t.Fatalf("oversize: %v", err)
	}
	far := msg("far")
	far.Hops = MaxHops + 1
	if err := d.Send(far); !errors.Is(err, ErrInvalid) {
		t.Fatalf("too many hops: %v", err)
	}
	blank := msg("blank")
	blank.Body = " \n\t"
	if err := d.Send(blank); !errors.Is(err, ErrInvalid) {
		t.Fatalf("blank body: %v", err)
	}
}

func TestControlCharactersAreDroppedFromTheBodyButTextSurvives(t *testing.T) {
	d, _ := open(t)
	m := msg("ctl")
	m.Body = "line one\nline\ttwo\x1b[31m red\x00 done"
	if err := d.Send(m); err != nil {
		t.Fatal(err)
	}
	got, _ := d.Pending("sess-b")
	if len(got) != 1 || got[0].Body != "line one\nline\ttwo[31m red done" {
		t.Fatalf("body = %q", got[0].Body)
	}
}

func TestAnIdAlreadySpooledIsRefusedNotReplaced(t *testing.T) {
	d, _ := open(t)
	if err := d.Send(msg("dup")); err != nil {
		t.Fatal(err)
	}
	again := msg("dup")
	again.Body = "replacement"
	if err := d.Send(again); !errors.Is(err, ErrDuplicate) {
		t.Fatalf("second send: %v, want ErrDuplicate", err)
	}
	got, _ := d.Pending("sess-b")
	if len(got) != 1 || got[0].Body != "hello from a" {
		t.Fatalf("the first message was replaced: %+v", got)
	}
}

func TestAHalfWrittenFileIsNeverReadAsAMessage(t *testing.T) {
	d, root := open(t)
	dir := filepath.Join(root, "spool", "sess-b")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, ".tmp-half"), []byte(`{"id":"half"`), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "torn.json"), []byte(`{"id":"torn"`), 0o600); err != nil {
		t.Fatal(err)
	}
	got, rejected := d.Pending("sess-b")
	if len(got) != 0 {
		t.Fatalf("a torn file was read as a message: %+v", got)
	}
	if len(rejected) != 1 || rejected[0].Name != "torn.json" || rejected[0].Reason != ReasonMalformed {
		t.Fatalf("rejected = %+v, want the torn file named with its reason and the temp file ignored", rejected)
	}
}

// A file's name is what a sender addressed. A body that says otherwise was not
// written by Send, and is reported rather than delivered.
func TestAFileWhoseContentContradictsItsNameIsRejected(t *testing.T) {
	d, root := open(t)
	if err := d.Send(msg("real")); err != nil {
		t.Fatal(err)
	}
	dir := filepath.Join(root, "spool", "sess-b")
	data, err := os.ReadFile(filepath.Join(dir, "real.json"))
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "renamed.json"), data, 0o600); err != nil {
		t.Fatal(err)
	}
	wrongReceiver := strings.Replace(string(data), `"writer_id":"sess-b"`, `"writer_id":"sess-z"`, 1)
	if err := os.WriteFile(filepath.Join(dir, "real2.json"), []byte(wrongReceiver), 0o600); err != nil {
		t.Fatal(err)
	}
	got, rejected := d.Pending("sess-b")
	if len(got) != 1 || got[0].ID != "real" {
		t.Fatalf("pending = %+v", got)
	}
	if len(rejected) != 2 {
		t.Fatalf("rejected = %+v, want both contradicting files", rejected)
	}
	for _, r := range rejected {
		if r.Reason != ReasonNameMismatch {
			t.Fatalf("rejected %+v, want name_mismatch", r)
		}
	}
}

func TestAnAcknowledgedMessageIsGoneFromTheSpoolAndRemembered(t *testing.T) {
	d, root := open(t)
	if err := d.Send(msg("m1")); err != nil {
		t.Fatal(err)
	}
	if err := d.Ack("sess-b", "m1"); err != nil {
		t.Fatal(err)
	}
	if got, _ := d.Pending("sess-b"); len(got) != 0 {
		t.Fatalf("an acknowledged message is still pending: %+v", got)
	}
	if !d.Seen("sess-b", "m1") || d.Seen("sess-b", "m2") || d.Seen("sess-c", "m1") {
		t.Fatal("seen is not per receiver and per id")
	}
	// A crash between recording and removing leaves the file: it is skipped by
	// the caller through Seen, never delivered twice.
	if err := os.WriteFile(filepath.Join(root, "spool", "sess-b", "m1.json"), mustJSON(t, msg("m1")), 0o600); err != nil {
		t.Fatal(err)
	}
	got, _ := d.Pending("sess-b")
	if len(got) != 1 || !d.Seen("sess-b", got[0].ID) {
		t.Fatalf("the leftover file must still be recognised as already taken in: %+v", got)
	}
}

func TestTheSeenListIsBounded(t *testing.T) {
	d, _ := open(t)
	for i := range seenKeep + 5 {
		if err := d.Ack("sess-b", "id"+itoa(i)); err != nil {
			t.Fatal(err)
		}
	}
	if len(d.seenIDs("sess-b")) != seenKeep || d.Seen("sess-b", "id0") || !d.Seen("sess-b", "id"+itoa(seenKeep+4)) {
		t.Fatal("the seen list must keep the newest ids and drop the oldest")
	}
}

func TestLiveRecordsListOnlyWhatTheCallerSaysIsAliveAndNeverAForgedName(t *testing.T) {
	d, root := open(t)
	for _, id := range []string{"sess-a", "sess-b"} {
		if err := d.PublishLive(Live{SessionID: id, WriterID: "proc-1", PID: 1, Inbound: "hold", StartedAt: time.Unix(1, 0)}); err != nil {
			t.Fatal(err)
		}
	}
	forged := mustJSON(t, Live{SessionID: "sess-a", WriterID: "proc-1", Inbound: "hold"})
	if err := os.WriteFile(filepath.Join(root, "live", "sess-evil.json"), forged, 0o600); err != nil {
		t.Fatal(err)
	}
	live, rejected := d.ListLive(func(l Live) bool { return l.SessionID == "sess-a" })
	if len(live) != 1 || live[0].SessionID != "sess-a" {
		t.Fatalf("live = %+v, want only the session the caller vouched for", live)
	}
	if len(rejected) != 1 || rejected[0].Name != "sess-evil.json" || rejected[0].Reason != ReasonNameMismatch {
		t.Fatalf("rejected = %+v, want the forged record named", rejected)
	}
	if err := d.RemoveLive("sess-a"); err != nil {
		t.Fatal(err)
	}
	if live, _ := d.ListLive(func(Live) bool { return true }); len(live) != 1 || live[0].SessionID != "sess-b" {
		t.Fatalf("a withdrawn record is still listed: %+v", live)
	}
	if err := d.RemoveLive("sess-a"); err != nil {
		t.Fatalf("withdrawing twice must be harmless: %v", err)
	}
}

// One process holds many sessions, so they share a writer id. Two of them must
// still be separate places to deliver to.
func TestTwoSessionsOfOneProcessAreSeparateAddresses(t *testing.T) {
	d, _ := open(t)
	for _, id := range []string{"sess-b", "sess-c"} {
		if err := d.PublishLive(Live{SessionID: id, WriterID: "proc-1", PID: 1, Inbound: "hold"}); err != nil {
			t.Fatal(err)
		}
	}
	if live, _ := d.ListLive(func(Live) bool { return true }); len(live) != 2 {
		t.Fatalf("sessions sharing a writer id collapsed into %d records", len(live))
	}
	toC := msg("for-c")
	toC.To = Party{SessionID: "sess-c", WriterID: "proc-1"}
	if err := d.Send(msg("for-b")); err != nil {
		t.Fatal(err)
	}
	if err := d.Send(toC); err != nil {
		t.Fatal(err)
	}
	if got, _ := d.Pending("sess-b"); len(got) != 1 || got[0].ID != "for-b" {
		t.Fatalf("sess-b pending = %+v", got)
	}
	if got, _ := d.Pending("sess-c"); len(got) != 1 || got[0].ID != "for-c" {
		t.Fatalf("sess-c pending = %+v", got)
	}
}

func TestALiveRecordWithAnUnknownInboundPolicyIsNotPublished(t *testing.T) {
	d, _ := open(t)
	if err := d.PublishLive(Live{SessionID: "s", Inbound: "allow"}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("a policy the receiver cannot honour was published: %v", err)
	}
}

func TestALinkInThePlaceOfAFileIsNeverFollowed(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("symlinks need privileges on Windows")
	}
	d, root := open(t)
	secret := filepath.Join(testenv.TempDir(t), "secret.json")
	if err := os.WriteFile(secret, mustJSON(t, msg("linked")), 0o600); err != nil {
		t.Fatal(err)
	}
	dir := filepath.Join(root, "spool", "sess-b")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(secret, filepath.Join(dir, "linked.json")); err != nil {
		t.Fatal(err)
	}
	got, rejected := d.Pending("sess-b")
	if len(got) != 0 || len(rejected) != 1 || rejected[0].Reason != ReasonNotRegular {
		t.Fatalf("pending %+v rejected %+v, want the link refused as not regular", got, rejected)
	}
}

func TestADirectoryAnotherAccountCouldWriteIsRefused(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("no mode bits to read on Windows")
	}
	root := filepath.Join(testenv.TempDir(t), "peers")
	if err := os.MkdirAll(filepath.Join(root, "spool"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(filepath.Join(root, "spool"), 0o770); err != nil {
		t.Fatal(err)
	}
	if _, err := Open(root); !errors.Is(err, ErrUnsafeDir) {
		t.Fatalf("Open over a group-writable spool: %v, want ErrUnsafeDir", err)
	}
}

func TestADirectoryThatIsALinkIsRefused(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("symlinks need privileges on Windows")
	}
	base := testenv.TempDir(t)
	elsewhere := filepath.Join(base, "elsewhere")
	if err := os.MkdirAll(elsewhere, 0o700); err != nil {
		t.Fatal(err)
	}
	root := filepath.Join(base, "peers")
	if err := os.MkdirAll(root, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(elsewhere, filepath.Join(root, "spool")); err != nil {
		t.Fatal(err)
	}
	if _, err := Open(root); !errors.Is(err, ErrUnsafeDir) {
		t.Fatalf("Open over a linked spool: %v, want ErrUnsafeDir", err)
	}
}

func TestAnInstanceThatWasReplacedDoesNotWithdrawItsReplacementsRecord(t *testing.T) {
	d, _ := open(t)
	old := Live{SessionID: "sess-a", Instance: "old", Inbound: "hold"}
	if err := d.PublishLive(old); err != nil {
		t.Fatal(err)
	}
	next := Live{SessionID: "sess-a", Instance: "new", Inbound: "hold"}
	if err := d.PublishLive(next); err != nil {
		t.Fatal(err)
	}
	if err := d.RemoveLiveIf("sess-a", "old"); err != nil {
		t.Fatal(err)
	}
	if live, _ := d.ListLive(func(Live) bool { return true }); len(live) != 1 || live[0].Instance != "new" {
		t.Fatalf("the replacement's record was withdrawn: %+v", live)
	}
	if err := d.RemoveLiveIf("sess-a", "new"); err != nil {
		t.Fatal(err)
	}
	if live, _ := d.ListLive(func(Live) bool { return true }); len(live) != 0 {
		t.Fatalf("the owner could not withdraw its own record: %+v", live)
	}
}

func TestTheAuditTrailNamesPartiesAndDecisionsButNeverTheWords(t *testing.T) {
	d, root := open(t)
	body := "the secret plan for tuesday"
	if err := d.Audit(AuditRecord{Receiver: "sess-b", Sender: "sess-a", ID: "m1", Decision: DecisionHeld, Bytes: len(body), SHA256: Digest(body)}); err != nil {
		t.Fatal(err)
	}
	if err := d.Audit(AuditRecord{Receiver: "sess-b", ID: "x", Decision: DecisionRejected, Reason: ReasonMalformed}); err != nil {
		t.Fatal(err)
	}
	files, _ := filepath.Glob(filepath.Join(root, "audit", "*.jsonl"))
	if len(files) != 1 {
		t.Fatalf("audit files = %v, want one for the month", files)
	}
	data, err := os.ReadFile(files[0])
	if err != nil {
		t.Fatal(err)
	}
	text := string(data)
	if strings.Contains(text, "secret plan") {
		t.Fatalf("the audit trail carries the body: %s", text)
	}
	if !strings.Contains(text, Digest(body)) || !strings.Contains(text, `"decision":"held"`) || !strings.Contains(text, `"reason":"malformed"`) {
		t.Fatalf("the audit trail lacks its identities: %s", text)
	}
	if strings.Count(text, "\n") != 2 {
		t.Fatalf("want one line per record: %q", text)
	}
}

// A sender that died between creating its temporary file and linking it into
// place must not make that id unusable for ever.
func TestAStaleTemporaryFileIsSweptAndTheIdBecomesUsableAgain(t *testing.T) {
	d, root := open(t)
	dir := filepath.Join(root, "spool", "sess-b")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	stale, fresh := filepath.Join(dir, ".tmp-m1"), filepath.Join(dir, ".tmp-m2")
	for _, p := range []string{stale, fresh} {
		if err := os.WriteFile(p, []byte("{"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	old := time.Now().Add(-time.Hour)
	if err := os.Chtimes(stale, old, old); err != nil {
		t.Fatal(err)
	}
	if err := d.Send(msg("m1")); !errors.Is(err, ErrDuplicate) {
		t.Fatalf("before the sweep a retry under the leftover id = %v, want ErrDuplicate", err)
	}
	d.SweepTemp("sess-b", 10*time.Minute)
	if _, err := os.Lstat(stale); !os.IsNotExist(err) {
		t.Fatal("the stale temporary file survived the sweep")
	}
	if _, err := os.Lstat(fresh); err != nil {
		t.Fatal("a fresh temporary file, possibly mid-write, was swept")
	}
	if err := d.Send(msg("m1")); err != nil {
		t.Fatalf("after the sweep a retry = %v, want it accepted", err)
	}
}

// Send drops terminal control from a body, but the spool is a folder of files:
// one written by hand arrives with whatever it holds. Reading applies the same
// reduction, so a clear-screen, an OSC title, a C1 control and a right-to-left
// override never reach a terminal or a window as part of an approval prompt.
func TestAHandWrittenBodyIsReducedWhereItIsRead(t *testing.T) {
	d, root := open(t)
	if err := d.Send(msg("real")); err != nil {
		t.Fatal(err)
	}
	dir := filepath.Join(root, "spool", "sess-b")
	data, err := os.ReadFile(filepath.Join(dir, "real.json"))
	if err != nil {
		t.Fatal(err)
	}
	var m Message
	if err := json.Unmarshal(data, &m); err != nil {
		t.Fatal(err)
	}
	m.Body = "ok\x1b[2J\x1b]0;pwned\x07 line\n\ttab \u0085next ‮gnp.exe"
	forged, _ := json.Marshal(m)
	if err := os.WriteFile(filepath.Join(dir, "real.json"), forged, 0o600); err != nil {
		t.Fatal(err)
	}
	got, _ := d.Pending("sess-b")
	if len(got) != 1 {
		t.Fatalf("pending = %+v", got)
	}
	want := "ok[2J]0;pwned line\n\ttab next gnp.exe"
	if got[0].Body != want {
		t.Fatalf("body = %q, want %q", got[0].Body, want)
	}
}
