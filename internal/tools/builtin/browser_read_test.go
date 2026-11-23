package builtin

import (
	"context"
	"encoding/json"
	"io"
	"strings"
	"sync"
	"testing"

	"reasonix/internal/platform/browser"
)

// toolPage answers the CDP calls a snapshot read makes, with the page's
// accessibility tree behind a field the test moves between reads.
type toolPage struct {
	in     chan []byte
	closed chan struct{}
	once   sync.Once

	mu    sync.Mutex
	ax    string
	title string
	url   string
}

func newToolPage(ax, title, url string) *toolPage {
	return &toolPage{in: make(chan []byte, 64), closed: make(chan struct{}), ax: ax, title: title, url: url}
}

func (p *toolPage) setAX(ax string) {
	p.mu.Lock()
	p.ax = ax
	p.mu.Unlock()
}

func (p *toolPage) ReadMessage() ([]byte, error) {
	select {
	case msg := <-p.in:
		return msg, nil
	case <-p.closed:
		return nil, io.EOF
	}
}

func (p *toolPage) Close() error {
	p.once.Do(func() { close(p.closed) })
	return nil
}

func (p *toolPage) WriteMessage(raw []byte) error {
	var msg struct {
		ID     int64
		Method string
	}
	if err := json.Unmarshal(raw, &msg); err != nil {
		return err
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	result := map[string]any{}
	switch msg.Method {
	case "Target.createTarget":
		result["targetId"] = "page-1"
	case "Target.attachToTarget":
		result["sessionId"] = "sess-1"
	case "Page.getFrameTree":
		result["frameTree"] = map[string]any{"frame": map[string]string{"id": "frame-1", "url": p.url}}
	case "Page.navigate":
		result["loaderId"] = "loader-1"
	case "Accessibility.getFullAXTree":
		result["nodes"] = json.RawMessage(p.ax)
	case "Runtime.evaluate":
		result["result"] = map[string]any{"value": p.title}
	}
	reply, err := json.Marshal(map[string]any{"id": msg.ID, "result": result})
	if err != nil {
		return err
	}
	p.in <- reply
	if msg.Method == "Page.navigate" {
		ev, _ := json.Marshal(map[string]any{"method": "Page.lifecycleEvent", "sessionId": "sess-1", "params": map[string]any{"frameId": "frame-1", "loaderId": "loader-1", "name": "load"}})
		p.in <- ev
	}
	return nil
}

func readSession(t *testing.T, page *toolPage) *browser.Session {
	t.Helper()
	pool := &browser.Pool{}
	pool.SetEndpoint(func(context.Context, string) (browser.Endpoint, error) { return page, nil })
	session := browser.NewSession(browser.Config{Pool: pool, Launch: browser.LaunchSpec{ProfileDir: "/profiles/read"}})
	t.Cleanup(session.Close)
	return session
}

const toolSaveTree = `[
	{"nodeId":"1","role":{"value":"RootWebArea"},"name":{"value":"Greeter"},"childIds":["2","3"],"backendDOMNodeId":1},
	{"nodeId":"2","parentId":"1","role":{"value":"StaticText"},"name":{"value":"Hello"}},
	{"nodeId":"3","parentId":"1","role":{"value":"button"},"name":{"value":"Save"},"backendDOMNodeId":6}
]`

const toolSavedTree = `[
	{"nodeId":"1","role":{"value":"RootWebArea"},"name":{"value":"Greeter"},"childIds":["2","3"],"backendDOMNodeId":1},
	{"nodeId":"2","parentId":"1","role":{"value":"StaticText"},"name":{"value":"Hello"}},
	{"nodeId":"3","parentId":"1","role":{"value":"button"},"name":{"value":"Saved"},"backendDOMNodeId":6}
]`

const toolGreetedTree = `[
	{"nodeId":"1","role":{"value":"RootWebArea"},"name":{"value":"Greeter"},"childIds":["2","3"],"backendDOMNodeId":1},
	{"nodeId":"2","parentId":"1","role":{"value":"StaticText"},"name":{"value":"Hello again"}},
	{"nodeId":"3","parentId":"1","role":{"value":"button"},"name":{"value":"Saved"},"backendDOMNodeId":6}
]`

// The repeat of a default snapshot read answers with the page's standing
// identifiers instead of its lines again, and every explicit ask for text —
// force, a window, a subtree, a page that moved — still gets the text.
func TestARepeatSnapshotOfAnUnchangedPageCarriesOnlyThePagesIdentifiers(t *testing.T) {
	ctx := context.Background()
	page := newToolPage(toolSaveTree, "Greeter", "https://example.com/")
	session := readSession(t, page)
	open, read := browserOpen{session: session}, browserRead{session: session}

	first, err := open.Execute(ctx, json.RawMessage(`{"url":"https://example.com/"}`))
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{`- text: "Hello"`, `- button "Save" [e1]`, "Greeter", "https://example.com/"} {
		if !strings.Contains(first, want) {
			t.Fatalf("the open output is missing %q:\n%s", want, first)
		}
	}

	repeat, err := read.Execute(ctx, json.RawMessage(`{"what":"snapshot"}`))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(repeat, "Unchanged since your last snapshot of this page (2 lines); use that snapshot. force=true returns the full tree.") {
		t.Fatalf("the repeat did not carry the unchanged contract:\n%s", repeat)
	}
	if !strings.Contains(repeat, "Greeter") || !strings.Contains(repeat, "https://example.com/") {
		t.Fatalf("the repeat did not carry the page's identifiers:\n%s", repeat)
	}
	if strings.Contains(repeat, "Save") {
		t.Fatalf("the repeat repeated the tree:\n%s", repeat)
	}

	forced, err := read.Execute(ctx, json.RawMessage(`{"what":"snapshot","force":true}`))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(forced, `- button "Save" [e1]`) {
		t.Fatalf("force=true did not return the lines:\n%s", forced)
	}

	page.setAX(toolSavedTree)
	moved, err := read.Execute(ctx, json.RawMessage(`{"what":"snapshot"}`))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(moved, `- button "Saved" [e1]`) {
		t.Fatalf("a moved tree was answered as a repeat:\n%s", moved)
	}

	again, err := read.Execute(ctx, json.RawMessage(`{"what":"snapshot"}`))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(again, "Saved") || !strings.Contains(again, "Unchanged since your last snapshot") {
		t.Fatalf("the repeat after a delivery did not elide:\n%s", again)
	}

	windowed, err := read.Execute(ctx, json.RawMessage(`{"what":"snapshot","offset":1}`))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(windowed, "Lines 2-2 of 2.") || !strings.Contains(windowed, `- button "Saved" [e1]`) {
		t.Fatalf("an explicit window was answered as a repeat:\n%s", windowed)
	}

	peeked, err := read.Execute(ctx, json.RawMessage(`{"what":"snapshot","limit":1}`))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(peeked, "Unchanged since") || !strings.Contains(peeked, "Lines 1-1 of 2.") {
		t.Fatalf("an explicit peek was answered as a repeat:\n%s", peeked)
	}

	subtree, err := read.Execute(ctx, json.RawMessage(`{"what":"snapshot","ref":"e1"}`))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(subtree, "Unchanged since") || !strings.Contains(subtree, `- button "Saved" [e1]`) {
		t.Fatalf("a subtree ask was answered as a repeat:\n%s", subtree)
	}

	still, err := read.Execute(ctx, json.RawMessage(`{"what":"snapshot"}`))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(still, "Saved") || !strings.Contains(still, "Unchanged since your last snapshot") {
		t.Fatalf("a peek moved the baseline a repeat elides against:\n%s", still)
	}
}

// A find shows the agent only the lines it matched, so it establishes no
// snapshot for a later read to elide against.
func TestAFindIsNotASnapshotTheNextReadMayElideAgainst(t *testing.T) {
	ctx := context.Background()
	page := newToolPage(toolSaveTree, "Greeter", "https://example.com/")
	session := readSession(t, page)
	open, read := browserOpen{session: session}, browserRead{session: session}

	if _, err := open.Execute(ctx, json.RawMessage(`{"url":"https://example.com/"}`)); err != nil {
		t.Fatal(err)
	}
	page.setAX(toolGreetedTree)
	found, err := read.Execute(ctx, json.RawMessage(`{"what":"find","text":"again"}`))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(found, `text: "Hello again"`) {
		t.Fatalf("the find did not report its match:\n%s", found)
	}
	after, err := read.Execute(ctx, json.RawMessage(`{"what":"snapshot"}`))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(after, "Unchanged since") {
		t.Fatalf("the read after a find elided against a look that never showed the tree:\n%s", after)
	}
	if !strings.Contains(after, `text: "Hello again"`) {
		t.Fatalf("the read did not deliver the tree the agent lacks:\n%s", after)
	}
}
