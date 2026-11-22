package computer

import (
	"encoding/json"
	"strings"

	"reasonix/internal/base/textutil"
)

// EffectClass is how far a step that reached the application is known to
// have worked. A step that did not reach it is a Failure, never a class.
type EffectClass string

const (
	EffectConfirmed     EffectClass = "confirmed"
	EffectUnverifiable  EffectClass = "unverifiable"
	EffectSuspectedNoop EffectClass = "suspected_noop"
)

// Evidence is the kind of fact the driver read that a class rests on.
type Evidence string

const (
	EvidenceValueReadback  Evidence = "value_readback"
	EvidenceValueUnchanged Evidence = "value_unchanged"
)

// DriverNextCall is the exact call the driver says moves the task forward. It
// is always a read or a call that keeps the person's window where it is, and
// the host renders it as guidance without ever executing it.
type DriverNextCall struct {
	Tool      string          `json:"tool"`
	Arguments json.RawMessage `json:"arguments"`
}

// hintLimit bounds the driver's one-sentence next-step guidance; the driver
// promises 240 characters.
var hintLimit = textutil.PreviewLimit{Graphemes: 240, Lines: 1}

// nextGuidance renders the driver's next-step sentence and the exact call it
// names, bounded, as the tail a refusal or an effect shows the model. It is
// guidance the model reads, never something the host executes.
func nextGuidance(hint string, call *DriverNextCall) string {
	var b strings.Builder
	if hint != "" {
		bounded, _ := textutil.BoundLiteral(hint, hintLimit)
		b.WriteString(" — next: " + bounded)
	}
	if call != nil {
		args, _ := textutil.BoundLiteral(strings.TrimSpace(string(call.Arguments)), textutil.PreviewLimit{Graphemes: 200, Lines: 1})
		b.WriteString(" (try " + ShownBundle(call.Tool) + " " + args + ")")
	}
	return b.String()
}

// Guidance is that tail on an effect.
func (e Effect) Guidance() string { return nextGuidance(e.Hint, e.NextCall) }

// Effect is what is known of a step that went through. Class is empty for a
// step that sends the application nothing, such as a wait.
type Effect struct {
	Driver   *DriverAction
	Class    EffectClass
	Evidence []Evidence
	// BlockedBy is the modal the input went to instead of the window behind it.
	BlockedBy *Modal
	// Hint and NextCall are the driver's next-step guidance on a refusal or an
	// unverifiable effect, rendered but never executed.
	Hint     string
	NextCall *DriverNextCall
}

// Modal is a window that holds an application's input until it is answered.
// Title and Blocks are names shown to the model, never read for a decision.
type Modal struct {
	Ref    string `json:"ref"`
	Title  string `json:"title"`
	Blocks string `json:"blocks"`
}

// modalNameLimit is the length the helpers clip every other label in a tree
// to; a modal's names are the application's to choose, so they get no more.
var modalNameLimit = textutil.PreviewLimit{Graphemes: 160, Lines: 1}

// ShownName quotes an application-chosen name bounded, with every control and
// invisible character, and the quote itself, rendered as a visible escape.
func ShownName(s string) string {
	bounded, _ := textutil.BoundLiteral(s, modalNameLimit)
	return `"` + strings.ReplaceAll(bounded, `"`, `\u{22}`) + `"`
}

// ShownBundle prints a bundle id as it is when nothing is hidden in it, so a
// normal id stays a key the model can send back, and escaped otherwise.
func ShownBundle(s string) string {
	bounded, _ := textutil.BoundLiteral(s, modalNameLimit)
	return bounded
}

func (m Modal) String() string {
	title := m.Title
	if title == "" {
		title = "(untitled)"
	}
	s := "the modal " + ShownName(title)
	if m.Ref != "" {
		s += " [" + m.Ref + "]"
	}
	if m.Blocks != "" {
		s += " over " + ShownName(m.Blocks)
	}
	return s
}
