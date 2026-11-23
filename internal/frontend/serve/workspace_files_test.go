package serve

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"reasonix/internal/base/testenv"
	"reasonix/internal/contract/config"
	"reasonix/internal/session/control"
)

func TestWorkspaceFileEditRequiresTheRevisionItRead(t *testing.T) {
	dir := testenv.TempDir(t)
	path := filepath.Join(dir, "note.txt")
	if err := os.WriteFile(path, []byte("one\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	bc := NewBroadcaster()
	ctrl := control.New(control.Options{Runner: fakeRunner{}, Sink: bc, WorkspaceRoot: dir})
	srv := httptest.NewServer(operatorHandler(New(ctrl, bc, config.ServeConfig{})))
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/workspace/file?path=note.txt")
	if err != nil {
		t.Fatal(err)
	}
	var file workspaceFile
	if err := json.NewDecoder(resp.Body).Decode(&file); err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	file.Content = "two\n"
	body, _ := json.Marshal(file)
	put := func() (*http.Response, error) {
		req, _ := http.NewRequest(http.MethodPut, srv.URL+"/workspace/file", bytes.NewReader(body))
		req.Header.Set("content-type", "application/json")
		return http.DefaultClient.Do(req)
	}
	resp, err = put()
	if err != nil || resp.StatusCode != http.StatusOK {
		t.Fatalf("PUT = %v, %v", resp, err)
	}
	resp.Body.Close()
	if got, _ := os.ReadFile(path); string(got) != "two\n" {
		t.Fatalf("file = %q", got)
	}

	resp, err = put()
	if err != nil || resp.StatusCode != http.StatusConflict {
		t.Fatalf("stale PUT status = %v, %v; want 409", resp, err)
	}
	resp.Body.Close()
}

func TestWorkspaceFileRefusesPathsOutsideTheRoot(t *testing.T) {
	dir := testenv.TempDir(t)
	bc := NewBroadcaster()
	ctrl := control.New(control.Options{Runner: fakeRunner{}, Sink: bc, WorkspaceRoot: dir})
	srv := httptest.NewServer(operatorHandler(New(ctrl, bc, config.ServeConfig{})))
	defer srv.Close()
	resp, err := http.Get(srv.URL + "/workspace/file?path=../secret.txt")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("GET outside path = %d, want 400", resp.StatusCode)
	}
}

func TestWorkspaceFileSaysMissingOnlyForAFileThatIsNotThere(t *testing.T) {
	dir := testenv.TempDir(t)
	outside := testenv.TempDir(t)
	if err := os.WriteFile(filepath.Join(outside, "secret.txt"), []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(dir, "link")); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}
	bc := NewBroadcaster()
	ctrl := control.New(control.Options{Runner: fakeRunner{}, Sink: bc, WorkspaceRoot: dir})
	srv := httptest.NewServer(operatorHandler(New(ctrl, bc, config.ServeConfig{})))
	defer srv.Close()
	code := func(path string, status int) string {
		resp, err := http.Get(srv.URL + "/workspace/file?path=" + path)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		if resp.StatusCode != status {
			t.Fatalf("%s: status %d, want %d", path, resp.StatusCode, status)
		}
		var body struct {
			Code string `json:"code"`
		}
		_ = json.NewDecoder(resp.Body).Decode(&body)
		return body.Code
	}
	if got := code("absent.txt", http.StatusNotFound); got != "workspace.file_missing" {
		t.Fatalf("absent file: code %q, want workspace.file_missing", got)
	}
	if got := code("link/secret.txt", http.StatusForbidden); got != "workspace.preview_denied" {
		t.Fatalf("file behind a link the root refuses: code %q, want workspace.preview_denied", got)
	}
}

func TestWorkspaceFileCreateWhenTheRevisionSaysNew(t *testing.T) {
	dir := testenv.TempDir(t)
	bc := NewBroadcaster()
	ctrl := control.New(control.Options{Runner: fakeRunner{}, Sink: bc, WorkspaceRoot: dir})
	srv := httptest.NewServer(operatorHandler(New(ctrl, bc, config.ServeConfig{})))
	defer srv.Close()

	body, _ := json.Marshal(workspaceFile{Path: ".reasonix/annotations.json", Content: "{}", Revision: ""})
	req, _ := http.NewRequest(http.MethodPut, srv.URL+"/workspace/file", bytes.NewReader(body))
	req.Header.Set("content-type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("create PUT = %d, want 200", resp.StatusCode)
	}
	var file workspaceFile
	if err := json.NewDecoder(resp.Body).Decode(&file); err != nil {
		t.Fatal(err)
	}
	if file.Revision != fileRevision([]byte("{}")) {
		t.Fatalf("revision = %q, want the content's own", file.Revision)
	}
	if got, _ := os.ReadFile(filepath.Join(dir, ".reasonix", "annotations.json")); string(got) != "{}" {
		t.Fatalf("file = %q", got)
	}
}

func TestWorkspaceFileCreateRefusesAFileThatIsAlreadyThere(t *testing.T) {
	dir := testenv.TempDir(t)
	path := filepath.Join(dir, "note.txt")
	if err := os.WriteFile(path, []byte("one\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	bc := NewBroadcaster()
	ctrl := control.New(control.Options{Runner: fakeRunner{}, Sink: bc, WorkspaceRoot: dir})
	srv := httptest.NewServer(operatorHandler(New(ctrl, bc, config.ServeConfig{})))
	defer srv.Close()

	body, _ := json.Marshal(workspaceFile{Path: "note.txt", Content: "two\n", Revision: ""})
	req, _ := http.NewRequest(http.MethodPut, srv.URL+"/workspace/file", bytes.NewReader(body))
	req.Header.Set("content-type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusConflict {
		t.Fatalf("create-over-existing PUT = %d, want 409", resp.StatusCode)
	}
	var refusal struct {
		Code string `json:"code"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&refusal)
	if refusal.Code != "workspace.file_exists" {
		t.Fatalf("code = %q, want workspace.file_exists", refusal.Code)
	}
	if got, _ := os.ReadFile(path); string(got) != "one\n" {
		t.Fatalf("file = %q, want it left alone", got)
	}
}
