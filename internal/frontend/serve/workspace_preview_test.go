package serve

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"reasonix/internal/base/testenv"
	"reasonix/internal/base/workspacefile"
	"reasonix/internal/contract/config"
	"reasonix/internal/contract/provider"
	"reasonix/internal/session/control"
)

func TestWorkspacePreviewRoutesKeepBinaryOutOfJSON(t *testing.T) {
	dir := testenv.TempDir(t)
	data := []byte("%PDF-1.7\n\x00binary")
	if err := os.WriteFile(filepath.Join(dir, "report.pdf"), data, 0o600); err != nil {
		t.Fatal(err)
	}
	bc := NewBroadcaster()
	ctrl := control.New(control.Options{Runner: fakeRunner{}, Sink: bc, WorkspaceRoot: dir})
	t.Cleanup(ctrl.Close)
	handler := operatorHandler(New(ctrl, bc, config.ServeConfig{}))
	for _, tc := range []struct {
		path string
		code int
	}{
		{"/workspace/preview/info?path=report.pdf", 200},
		{"/workspace/preview/content?path=report.pdf", 200},
		{"/workspace/preview/info?path=../secret", 403},
		{"/workspace/preview/info?path=missing", 404},
	} {
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, tc.path, nil))
		if rec.Code != tc.code {
			t.Fatalf("%s: %d %s", tc.path, rec.Code, rec.Body.String())
		}
		if tc.path == "/workspace/preview/info?path=report.pdf" {
			var info workspacefile.Info
			if err := json.Unmarshal(rec.Body.Bytes(), &info); err != nil || info.Kind != "pdf" {
				t.Fatalf("info %+v, %v", info, err)
			}
		}
		if tc.path == "/workspace/preview/content?path=report.pdf" {
			if rec.Body.String() != string(data) || rec.Header().Get("X-Content-Type-Options") != "nosniff" {
				t.Fatalf("binary response: %s", rec.Body.String())
			}
		}
	}
}

func TestWorkspaceResolveFindsAFileSpelledFromASubdirectory(t *testing.T) {
	dir := testenv.TempDir(t)
	at := filepath.Join(dir, "misyrup-rs", "target", "release", "app.exe")
	if err := os.MkdirAll(filepath.Dir(at), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(at, []byte("binary"), 0o600); err != nil {
		t.Fatal(err)
	}
	bc := NewBroadcaster()
	ctrl := control.New(control.Options{Runner: fakeRunner{}, Sink: bc, WorkspaceRoot: dir})
	t.Cleanup(ctrl.Close)
	handler := operatorHandler(New(ctrl, bc, config.ServeConfig{}))

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/workspace/resolve?path=target/release/app.exe", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("resolve = %d %s", rec.Code, rec.Body.String())
	}
	var ref workspacefile.Ref
	if err := json.Unmarshal(rec.Body.Bytes(), &ref); err != nil {
		t.Fatal(err)
	}
	if ref.Path != "misyrup-rs/target/release/app.exe" || ref.Root != "" {
		t.Fatalf("resolve = %+v, want the file's own path", ref)
	}

	// The resolved path is what the caller then reads, so it has to open.
	read := httptest.NewRecorder()
	handler.ServeHTTP(read, httptest.NewRequest(http.MethodGet, "/workspace/preview/info?path="+ref.Path, nil))
	if read.Code != http.StatusOK {
		t.Fatalf("the resolved path does not read: %d %s", read.Code, read.Body.String())
	}
}

func TestWorkspaceResolveKeepsAnAmbiguousOrAbsentAnswerOut(t *testing.T) {
	dir := testenv.TempDir(t)
	for _, rel := range []string{"a/target/release/app.exe", "b/target/release/app.exe"} {
		at := filepath.Join(dir, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(at), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(at, []byte("binary"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	bc := NewBroadcaster()
	ctrl := control.New(control.Options{Runner: fakeRunner{}, Sink: bc, WorkspaceRoot: dir})
	t.Cleanup(ctrl.Close)
	handler := operatorHandler(New(ctrl, bc, config.ServeConfig{}))
	for _, tc := range []struct {
		query string
		code  int
	}{
		{"target/release/app.exe", http.StatusConflict},
		{"target/release/gone.exe", http.StatusNotFound},
		{"../outside.exe", http.StatusNotFound},
	} {
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/workspace/resolve?path="+tc.query, nil))
		if rec.Code != tc.code {
			t.Fatalf("%s = %d %s, want %d", tc.query, rec.Code, rec.Body.String(), tc.code)
		}
	}
}

func TestHistoryReconstructsOnlyConfirmedDeliveryResults(t *testing.T) {
	body := `{"version":1,"files":[{"path":"docs/report.md","description":"Report"}]}`
	msgs := []provider.Message{
		{Role: provider.RoleAssistant, ToolCalls: []provider.ToolCall{
			{ID: "real", Name: "use_capability", ResolvedName: "present_files", CapabilityID: "tool:present_files"},
			{ID: "fake", Name: "bash", ResolvedName: "bash", CapabilityID: "tool:bash"},
		}},
		{Role: provider.RoleTool, ToolCallID: "real", Content: body},
		{Role: provider.RoleTool, ToolCallID: "fake", Content: body},
	}
	history := historyMessages(msgs)
	if len(history[1].Deliveries) != 1 || len(history[2].Deliveries) != 0 {
		t.Fatalf("history = %+v", history)
	}
	msgs[1].Content, msgs[1].RawContent = "[result truncated]", body
	if len(historyMessages(msgs)[1].Deliveries) != 1 {
		t.Fatal("context truncation erased a persisted delivery")
	}
	msgs[1].ToolFailure = &provider.ToolFailure{}
	if len(historyMessages(msgs)[1].Deliveries) != 0 {
		t.Fatal("failed declaration became delivery")
	}
}

func TestOpenOfficeAndTextDocuments(t *testing.T) {
	f := newDocumentFixture(t, true)
	for _, name := range []string{"report.docx", "budget.xlsx", "slides.pptx", "notes.md", "table.csv"} {
		path := filepath.Join(f.work, name)
		if err := os.WriteFile(path, []byte("fixture"), 0o600); err != nil {
			t.Fatal(err)
		}
		if code, why := f.open(t, path); code != http.StatusOK {
			t.Fatalf("%s: %d %s", name, code, why)
		}
	}
}
