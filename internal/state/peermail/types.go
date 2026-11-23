package peermail

import (
	"errors"
	"regexp"
	"strings"
	"time"
	"unicode"
)

const (
	// MaxBodyBytes bounds one message's text. A placeholder until measured.
	MaxBodyBytes = 64 << 10
	maxFileBytes = MaxBodyBytes + 8<<10
	maxLiveBytes = 8 << 10
	maxHops      = 8
	seenKeep     = 1000
)

var (
	ErrInvalid   = errors.New("peermail: invalid message")
	ErrTooLarge  = errors.New("peermail: message too large")
	ErrDuplicate = errors.New("peermail: message id already spooled")
	ErrUnsafeDir = errors.New("peermail: directory is not private to this user")
)

// idPattern is every identity this package turns into a path component. It
// has no separator, no dot-only name and no leading dot.
var idPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`)

func validID(s string) bool { return idPattern.MatchString(s) }

// Party is who a message is from or for. SessionID is the address and the only
// key the files are filed under: a process holds many sessions, so the writer
// of the lease names a process, not a place to deliver to. WriterID is the
// holder at the time, for the reader's information.
type Party struct {
	SessionID string `json:"session_id"`
	WriterID  string `json:"writer_id"`
	Title     string `json:"title,omitempty"`
	Project   string `json:"project,omitempty"`
}

// Message is one spooled message. It has no field for an approval, a mode, a
// write root or a credential, so none can travel. Proof is the one addition: a
// MAC over the message under a secret only the two hosts' memory holds, so it
// shows the sender is a session the receiver was paired with and reveals nothing.
type Message struct {
	ID     string    `json:"id"`
	From   Party     `json:"from"`
	To     Party     `json:"to"`
	SentAt time.Time `json:"sent_at"`
	Hops   int       `json:"hops"`
	Body   string    `json:"body"`
	// ReplyTo names the message this one answers. It rides outside the proof on
	// purpose: old messages keep verifying, and a forged pointer only misleads a
	// reader about which message is being answered.
	ReplyTo string `json:"reply_to,omitempty"`
	Proof   string `json:"proof,omitempty"`
	// Seq numbers the messages one session signs for one partner, from 1. The
	// proof covers it, so the receiver can refuse a number it has already taken.
	Seq uint64 `json:"seq,omitempty"`
}

// Live describes one running session. It is a description: whether the session
// is really alive is the caller's question, answered from the session lease.
// SessionID is the key; WriterID is the process holding the lease.
type Live struct {
	SessionID string `json:"session_id"`
	// Instance names the controller that published the record, so a controller
	// that is replaced does not withdraw the record its replacement just wrote.
	Instance    string    `json:"instance,omitempty"`
	WriterID    string    `json:"writer_id,omitempty"`
	SessionPath string    `json:"session_path"`
	PID         int       `json:"pid"`
	Hostname    string    `json:"hostname,omitempty"`
	Title       string    `json:"title,omitempty"`
	Project     string    `json:"project,omitempty"`
	StartedAt   time.Time `json:"started_at"`
	// BeatAt is when the session last said it was there. A session that stopped
	// without withdrawing, by a crash or a kill, goes quiet and is not listed.
	BeatAt time.Time `json:"beat_at"`
	// Inbound is the receiver's own policy for messages: "hold" or "refuse".
	Inbound string `json:"inbound"`
}

// Rejected is a file the reader would not accept, with the typed reason.
type Rejected struct {
	Name   string
	Reason Reason
}

// Reason is why a file was not accepted. It is an identity, not a sentence.
type Reason string

const (
	ReasonUnreadable   Reason = "unreadable"
	ReasonNotRegular   Reason = "not_regular"
	ReasonTooLarge     Reason = "too_large"
	ReasonMalformed    Reason = "malformed"
	ReasonNameMismatch Reason = "name_mismatch"
	ReasonInvalid      Reason = "invalid"
)

// Validate checks a message the way both the sender and the reader do.
func (m Message) Validate() error {
	switch {
	case !validID(m.ID), !validID(m.From.SessionID), !validID(m.To.SessionID):
		return ErrInvalid
	case m.From.WriterID != "" && !validID(m.From.WriterID), m.To.WriterID != "" && !validID(m.To.WriterID):
		return ErrInvalid
	case m.Hops < 0 || m.Hops > maxHops:
		return ErrInvalid
	case strings.TrimSpace(m.Body) == "":
		return ErrInvalid
	case len(m.Body) > MaxBodyBytes:
		return ErrTooLarge
	}
	return nil
}

// cleanBody keeps the text and drops what could pass for terminal or framing
// control: every control character except newline and tab, and the bidirectional
// marks that reorder what the reader sees.
func cleanBody(s string) string {
	return strings.Map(func(r rune) rune {
		if r == '\n' || r == '\t' || (!unicode.IsControl(r) && !bidiControl(r)) {
			return r
		}
		return -1
	}, s)
}

func bidiControl(r rune) bool {
	return r == '\u200e' || r == '\u200f' || (r >= '\u202a' && r <= '\u202e') || (r >= '\u2066' && r <= '\u2069')
}

func (l Live) validate() bool {
	return validID(l.SessionID) && (l.WriterID == "" || validID(l.WriterID)) && (l.Inbound == "hold" || l.Inbound == "refuse")
}
