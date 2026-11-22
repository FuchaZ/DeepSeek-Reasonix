package computer

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"reasonix/internal/base/testenv"
)

// lastLoggedDrag reads the fake driver's request log and returns the arguments
// of the last drag call, or nil when no drag reached the driver.
func lastLoggedDrag(t *testing.T, log string) map[string]any {
	t.Helper()
	body, err := os.ReadFile(log)
	if err != nil {
		t.Fatal(err)
	}
	var drag map[string]any
	for line := range strings.SplitSeq(string(body), "\n") {
		var req struct {
			Name      string         `json:"Name"`
			Arguments map[string]any `json:"Arguments"`
		}
		_ = json.Unmarshal([]byte(line), &req)
		if req.Name == "drag" {
			drag = req.Arguments
		}
	}
	return drag
}

// A background drag runs between two points of the latest screenshot in one
// capture, keeps background delivery, and spends the capture once: a second
// coordinate step needs a fresh screenshot.
func TestDragDeliversBackgroundBetweenTwoPoints(t *testing.T) {
	log := filepath.Join(testenv.TempDir(t), "requests.jsonl")
	t.Setenv("REASONIX_CUA_REQUEST_LOG", log)
	s := fakeSession(t)
	_, _, err := s.Screenshot(t.Context(), "com.example.Notes")
	if err != nil {
		t.Fatal(err)
	}
	x, y := 200.0, 100.0
	toX, toY := 400.0, 200.0
	if _, err := s.Act(t.Context(), "com.example.Notes", []Step{{Action: "drag", X: &x, Y: &y, ToX: &toX, ToY: &toY}}); err != nil {
		t.Fatal(err)
	}
	drag := lastLoggedDrag(t, log)
	if drag == nil {
		t.Fatal("no drag reached the driver")
	}
	if drag["scope"] != "window" || drag["delivery_mode"] != "background" {
		t.Fatalf("drag: %v", drag)
	}
	fromX := 200.0 * float64(s.state.captureWidth) / float64(s.state.imageWidth)
	fromY := 100.0 * float64(s.state.captureHeight) / float64(s.state.imageHeight)
	toCaptureX := 400.0 * float64(s.state.captureWidth) / float64(s.state.imageWidth)
	toCaptureY := 200.0 * float64(s.state.captureHeight) / float64(s.state.imageHeight)
	if drag["from_x"] != fromX || drag["from_y"] != fromY || drag["to_x"] != toCaptureX || drag["to_y"] != toCaptureY {
		t.Fatalf("drag coordinates: %v", drag)
	}
	if drag["pid"] == nil || drag["window_id"] == nil {
		t.Fatalf("drag target: %v", drag)
	}
	if _, err := s.Act(t.Context(), "com.example.Notes", []Step{{Action: "click", X: &x, Y: &y}}); CodeOf(err) != CodeNeedsScreenshot {
		t.Fatalf("capture not consumed by the drag: %v", err)
	}
}

// A drag is refused before the driver is asked when an endpoint is missing, a
// ref is mixed in, or the far end lands outside the screenshot.
func TestDragValidatesBothPointsBeforeTheDriver(t *testing.T) {
	log := filepath.Join(testenv.TempDir(t), "requests.jsonl")
	t.Setenv("REASONIX_CUA_REQUEST_LOG", log)
	s := fakeSession(t)
	_, _, err := s.Screenshot(t.Context(), "com.example.Notes")
	if err != nil {
		t.Fatal(err)
	}
	x, y := 200.0, 100.0
	far := 9999.0
	// Coordinate cases run against the screenshot; the ref-mixing case runs
	// after its own snapshot, which spends the screenshot's capture.
	steps := [][]Step{
		{{Action: "drag", X: &x, Y: &y}},
		{{Action: "drag", ToX: &x, ToY: &y}},
		{{Action: "drag", X: &x, Y: &y, ToX: &far, ToY: &y}},
		{{Action: "drag", X: &x, Y: &y, ToX: &x, ToY: &far}},
	}
	for _, batch := range steps {
		if _, err := s.Act(t.Context(), "com.example.Notes", batch); CodeOf(err) != CodeBadStep {
			t.Fatalf("drag %+v: %v", batch[0], err)
		}
	}
	ref := snapshotRef(t, s)
	if _, err := s.Act(t.Context(), "com.example.Notes", []Step{{Action: "drag", X: &x, Y: &y, ToX: &x, ToY: &y, Ref: ref}}); CodeOf(err) != CodeBadStep {
		t.Fatalf("drag with a ref: %v", err)
	}
	if drag := lastLoggedDrag(t, log); drag != nil {
		t.Fatalf("an invalid drag reached the driver: %v", drag)
	}
}

// An unverifiable drag carries the driver's next-step guidance through to the
// step result, so the model can act on it instead of guessing.
func TestDragEffectCarriesTheDriverNextGuidance(t *testing.T) {
	t.Setenv("REASONIX_CUA_OVERRIDE_TOOL", "drag")
	t.Setenv("REASONIX_CUA_OVERRIDE_RESULT", `{"structuredContent":{"effect":"unverifiable","route":"accessibility","summary":"drag ran","hint":"Cover the start point check failed; take a screenshot before retrying.","next_call":{"tool":"get_window_state","arguments":{"pid":1,"window_id":1}}},"content":[]}`)
	s := fakeSession(t)
	_, _, err := s.Screenshot(t.Context(), "com.example.Notes")
	if err != nil {
		t.Fatal(err)
	}
	x, y := 200.0, 100.0
	toX, toY := 400.0, 200.0
	res, err := s.Act(t.Context(), "com.example.Notes", []Step{{Action: "drag", X: &x, Y: &y, ToX: &toX, ToY: &toY}})
	// An unverified step is recorded and the batch continues; the guidance
	// rides the recorded effect.
	if err != nil {
		t.Fatalf("unverified drag stops the batch: %v", err)
	}
	effect := res.Steps[0].Effect
	if effect.Hint == "" || effect.NextCall == nil || effect.NextCall.Tool != "get_window_state" {
		t.Fatalf("guidance: %+v", effect)
	}
}

// A refusal carries the driver's hint and next call as guidance, kept apart
// from the refusal's own reason.
func TestRefusalCarriesNextGuidanceApartFromTheReason(t *testing.T) {
	t.Setenv("REASONIX_CUA_OVERRIDE_TOOL", "click")
	t.Setenv("REASONIX_CUA_OVERRIDE_RESULT", `{"isError":true,"structuredContent":{"code":"background_unavailable","reason":"a window still covers the start point","hint":"take a screenshot and retry while it is uncovered","next_call":{"tool":"get_window_state","arguments":{"pid":1,"window_id":1}}},"content":[]}`)
	s := fakeSession(t)
	if _, err := s.Snapshot(t.Context(), "com.example.Notes"); err != nil {
		t.Fatal(err)
	}
	_, err := s.Act(t.Context(), "com.example.Notes", []Step{{Action: "click", Ref: snapshotRef(t, s)}})
	if CodeOf(err) != CodeDriverRefused {
		t.Fatalf("refusal: %v", err)
	}
	detail := err.Error()
	for _, want := range []string{"background_unavailable", "a window still covers the start point", "next:", "take a screenshot and retry", "try get_window_state"} {
		if !strings.Contains(detail, want) {
			t.Fatalf("refusal detail misses %q: %s", want, detail)
		}
	}
}
