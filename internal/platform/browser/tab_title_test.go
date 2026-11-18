package browser

import (
	"encoding/json"
	"sync"
	"testing"
	"time"
)

// titledPage answers document.title with whatever the test is standing in for
// the page having said.
func titledPage(title *string) *fakePage {
	return &fakePage{answers: func(msg wireMessage) (any, bool) {
		if msg.Method != "Runtime.evaluate" {
			return nil, false
		}
		var p struct {
			Expression string `json:"expression"`
		}
		if json.Unmarshal(msg.Params, &p) != nil || p.Expression != "document.title" {
			return nil, false
		}
		return map[string]any{"result": map[string]any{"value": *title}}, true
	}}
}

// A person's tab is named by the page, not by its address. The tab strip falls
// back to the URL when a tab has no title, and the title used to be read only
// when the agent asked for a tab, so a page nobody handed to the agent stayed
// named "https://…" for as long as it was open.
func TestLoadGivesTheTabThePagesTitle(t *testing.T) {
	title := "Reasonix"
	_, tb := newFakeSession(t, titledPage(&title))
	tb.onEvent(event{Method: "Page.frameNavigated", Params: json.RawMessage(`{"frame":{"id":"f2","url":"https://example.com/"}}`)})
	tb.onEvent(event{Method: "Page.lifecycleEvent", Params: json.RawMessage(`{"frameId":"f2","loaderId":"L1","name":"load"}`)})
	if got := waitForTitle(tb, "Reasonix"); got != "Reasonix" {
		t.Fatalf("title after load = %q; want the page's own", got)
	}
}

// The tab must not carry the page we left: a title names a document, and the
// new one has not spoken yet, so the address is the honest label until it has.
func TestNavigationDropsTheTitleOfThePageWeLeft(t *testing.T) {
	var title string
	_, tb := newFakeSession(t, titledPage(&title))
	tb.onEvent(event{Method: "Page.frameNavigated", Params: json.RawMessage(`{"frame":{"id":"f1","url":"https://first.example/"}}`)})
	title = "First"
	tb.onEvent(event{Method: "Page.lifecycleEvent", Params: json.RawMessage(`{"frameId":"f1","loaderId":"L1","name":"load"}`)})
	if got := waitForTitle(tb, "First"); got != "First" {
		t.Fatalf("title on the first page = %q", got)
	}
	tb.onEvent(event{Method: "Page.frameNavigated", Params: json.RawMessage(`{"frame":{"id":"f2","url":"https://second.example/"}}`)})
	if _, got := tb.location(); got != "" {
		t.Fatalf("title after navigating away = %q; want it dropped rather than carried over", got)
	}
}

// A read names the document it ran against, and the answer can arrive after the
// tab has moved on. That title belongs to the page we left, so writing it down
// would put the old page's name over the new one.
func TestATitleReadRacingNavigationIsDropped(t *testing.T) {
	var tb *tab
	var once sync.Once
	title := "First"
	page := &fakePage{answers: func(msg wireMessage) (any, bool) {
		if msg.Method != "Runtime.evaluate" {
			return nil, false
		}
		var p struct {
			Expression string `json:"expression"`
		}
		if json.Unmarshal(msg.Params, &p) != nil || p.Expression != "document.title" {
			return nil, false
		}
		// The page navigates away while this answer is still in flight.
		once.Do(func() {
			tb.onEvent(event{Method: "Page.frameNavigated", Params: json.RawMessage(`{"frame":{"id":"f2","url":"https://second.example/"}}`)})
		})
		return map[string]any{"result": map[string]any{"value": title}}, true
	}}
	_, tb = newFakeSession(t, page)
	tb.onEvent(event{Method: "Page.frameNavigated", Params: json.RawMessage(`{"frame":{"id":"f1","url":"https://first.example/"}}`)})
	if changed := tb.refreshTitle(); changed {
		t.Fatal("a title read across a navigation was taken as the new document's")
	}
	if _, got := tb.location(); got != "" {
		t.Fatalf("title after the racing read = %q; want it dropped rather than carried over", got)
	}
}

// A page renames itself as it goes: a script sets the title after load and a
// route change sets it again without any load at all. The host relays the
// view's own title event, so the tab follows the page.
func TestTheHostsTitleEventRenamesTheTab(t *testing.T) {
	_, tb := newFakeSession(t, &fakePage{})
	tb.onEvent(event{Method: "Page.frameNavigated", Params: json.RawMessage(`{"frame":{"id":"f1","url":"https://example.com/"}}`)})
	var changes sync.WaitGroup
	tb.s.OnTabsChanged(changes.Done)
	changes.Add(1)
	tb.onEvent(event{Method: "Page.frameTitleUpdated", Params: json.RawMessage(`{"title":"Second route"}`)})
	changes.Wait()
	if _, got := tb.location(); got != "Second route" {
		t.Fatalf("title after the host's event = %q; want the page's new name", got)
	}
	// The same title again is not news, so it must not wake the strip.
	tb.s.OnTabsChanged(func() { t.Error("an unchanged title notified the strip") })
	tb.onEvent(event{Method: "Page.frameTitleUpdated", Params: json.RawMessage(`{"title":"Second route"}`)})
}

// A subframe's name is not the tab's name: an advertisement in an iframe
// naming itself must not rename the page around it.
func TestASubframesTitleIsNotTheTabs(t *testing.T) {
	_, tb := newFakeSession(t, &fakePage{})
	tb.onEvent(event{Method: "Page.frameNavigated", Params: json.RawMessage(`{"frame":{"id":"f1","url":"https://example.com/"}}`)})
	tb.onEvent(event{Method: "Page.frameTitleUpdated", Params: json.RawMessage(`{"frameId":"other","title":"An advert"}`)})
	if _, got := tb.location(); got != "" {
		t.Fatalf("title = %q; want a subframe's name to leave the tab alone", got)
	}
}

// waitForTitle reads the tab until the load-time refresh lands, which happens on
// its own goroutine so the event queue is never held by a round trip.
func waitForTitle(tb *tab, want string) string {
	deadline := time.Now().Add(2 * time.Second)
	for {
		if _, got := tb.location(); got == want {
			return got
		}
		if time.Now().After(deadline) {
			_, got := tb.location()
			return got
		}
		time.Sleep(5 * time.Millisecond)
	}
}
