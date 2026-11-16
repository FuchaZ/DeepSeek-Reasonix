package serve

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"reasonix/internal/contract/config"
)

// The refresh fixture: a saved relay whose endpoint answers a listing with
// display names — the shape magpie's renamed models arrive in. The relay is
// not the conversation's provider, so a refresh never reaches the rebuild.
func refreshFixture(t *testing.T, upstream *httptest.Server, aliases map[string]string) {
	t.Helper()
	configPath := config.UserConfigPath()
	body := `default_model = "existing/model-a"

[[providers]]
name = "existing"
kind = "openai"
base_url = "https://example.invalid/v1"
models = ["model-a"]
default = "model-a"
api_key_env = "EXISTING_API_KEY"

[[providers]]
name = "relay"
kind = "openai"
base_url = "` + upstream.URL + `/v1"
models = ["relay/old-model"]
default = "relay/old-model"
api_key_env = "RELAY_API_KEY"
`
	if len(aliases) > 0 {
		pairs := make([]string, 0, len(aliases))
		for model, alias := range aliases {
			pairs = append(pairs, fmt.Sprintf("%q = %q", model, alias))
		}
		body += "model_aliases = { " + strings.Join(pairs, ", ") + " }\n"
	}
	if err := os.WriteFile(configPath, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
}

func savedRelay(t *testing.T) *config.ProviderEntry {
	t.Helper()
	saved := config.LoadForEdit(config.UserConfigPath())
	entry, ok := saved.Provider("relay")
	if !ok {
		t.Fatal("the relay vanished from the saved config")
	}
	return entry
}

func TestRefreshModelsMergesTheListAndPrefillsAliases(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/models" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = fmt.Fprint(w, `{"data":[
			{"id":"relay/new-model","display_name":"new model"},
			{"id":"relay/gone-model","display_name":"renamed"},
			{"id":"relay/old-model"},
			{"id":"relay/untouched","display_name":"relay/untouched"}
		]}`)
	}))
	defer upstream.Close()

	s := newProviderEditServer(t)
	refreshFixture(t, upstream, nil)
	s.AllowProviderEdit()
	srv := httptest.NewServer(operatorHandler(s))
	defer srv.Close()

	resp := postProvider(t, srv.URL, "/providers/refresh-models", `{"name":"relay"}`)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNoContent {
		b, _ := readAllString(resp)
		t.Fatalf("POST /providers/refresh-models = %d: %s", resp.StatusCode, b)
	}

	entry := savedRelay(t)
	for _, model := range []string{"relay/old-model", "relay/gone-model", "relay/new-model", "relay/untouched"} {
		if !entry.HasModel(model) {
			t.Fatalf("model %q is missing after the refresh: %v", model, entry.Models)
		}
	}
	if len(entry.Models) != 4 {
		t.Fatalf("models = %v, want the picked list kept and the listing joined", entry.Models)
	}
	// The endpoint's own names become aliases; a name equal to the id does not.
	want := map[string]string{"relay/gone-model": "renamed", "relay/new-model": "new model"}
	for model, alias := range want {
		if got := entry.ModelAliases[model]; got != alias {
			t.Fatalf("alias for %q = %q, want %q", model, got, alias)
		}
	}
	for _, model := range []string{"relay/old-model", "relay/untouched"} {
		if alias, ok := entry.ModelAliases[model]; ok && alias != "" {
			t.Fatalf("model %q grew an alias %q where the listing named it nothing new", model, alias)
		}
	}
}

// A name the person set themselves is theirs: the endpoint's display name
// pre-fills only the models nobody named.
func TestRefreshModelsKeepsAnAliasThePersonSet(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = fmt.Fprint(w, `{"data":[{"id":"relay/old-model","display_name":"endpoint says"}]}`)
	}))
	defer upstream.Close()

	s := newProviderEditServer(t)
	refreshFixture(t, upstream, map[string]string{"relay/old-model": "我的名字"})
	s.AllowProviderEdit()
	srv := httptest.NewServer(operatorHandler(s))
	defer srv.Close()

	resp := postProvider(t, srv.URL, "/providers/refresh-models", `{"name":"relay"}`)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNoContent {
		b, _ := readAllString(resp)
		t.Fatalf("POST /providers/refresh-models = %d: %s", resp.StatusCode, b)
	}
	if got := savedRelay(t).ModelAliases["relay/old-model"]; got != "我的名字" {
		t.Fatalf("alias = %q, want the one the person set kept", got)
	}
}

// A refresh that cannot reach the endpoint refuses with the probe's typed
// identity, the same family the add flow's refusals use.
func TestRefreshModelsRefusesWithTheProbeIdentity(t *testing.T) {
	s := newProviderEditServer(t)
	refreshFixture(t, httptest.NewServer(http.NotFoundHandler()), nil)
	s.AllowProviderEdit()
	srv := httptest.NewServer(operatorHandler(s))
	defer srv.Close()

	resp := postProvider(t, srv.URL, "/providers/refresh-models", `{"name":"relay"}`)
	defer resp.Body.Close()
	b, _ := readAllString(resp)
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("refreshing an endpoint that lists nothing = %d: %s", resp.StatusCode, b)
	}
	if !strings.Contains(b, codeProbePathNotFound) {
		t.Fatalf("the refusal names the probe finding, got: %s", b)
	}
}

// Writing to the config file waits on the same grant every provider edit does.
func TestRefreshModelsWaitsOnTheGrant(t *testing.T) {
	s := newProviderEditServer(t)
	srv := httptest.NewServer(operatorHandler(s))
	defer srv.Close()

	resp := postProvider(t, srv.URL, "/providers/refresh-models", `{"name":"existing"}`)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("POST /providers/refresh-models without the grant = %d, want 403", resp.StatusCode)
	}
}
