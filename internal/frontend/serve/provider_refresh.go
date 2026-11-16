// provider_refresh.go — re-reading a saved endpoint's model list, on request.
package serve

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"slices"
	"strings"
	"sync"

	"reasonix/internal/contract/config"
	"reasonix/internal/model/catalog"
)

// autoNamesOnce guards the startup pass: one read of every door's own names
// per process, whatever the panes.
var autoNamesOnce sync.Once

// autoRefreshDisplayNames runs once, when a server's routes first go up: every
// OpenAI-compatible door whose models carry no aliases yet is asked for its
// own listing, and the display names it offers — a relay's renamed models,
// magpie's "custom name without vendor" — land where the menu reads them. No
// name the person set is touched.
func (s *Server) autoRefreshDisplayNames() {
	autoNamesOnce.Do(func() {
		edit := config.LoadForEdit(config.UserConfigPath())
		changed := false
		for i := range edit.Providers {
			entry := &edit.Providers[i]
			if config.AnswersFor(entry.Kind) == config.AnswersDecision || entry.BaseURL == "" || len(entry.Models) == 0 {
				continue
			}
			unnamed := 0
			for _, model := range entry.Models {
				if strings.TrimSpace(entry.ModelAliases[model]) == "" {
					unnamed++
				}
			}
			if unnamed == 0 {
				continue
			}
			ctx, cancel := context.WithTimeout(context.Background(), providerProbeTimeout)
			proxied, direct := probeClients()
			got, probeErr := catalog.ProbeEndpoint(ctx, catalog.ProbeOptions{
				BaseURL: entry.BaseURL,
				APIKey:  entry.APIKey(),
				Client:  proxied,
				Direct:  direct,
			})
			cancel()
			if probeErr != nil {
				continue
			}
			// The list the person picked stays the spine; what the door now
			// serves joins it, and its names fill the blanks.
			merged := slices.Clone(entry.Models)
			for _, model := range got.Models {
				if !slices.Contains(merged, model) {
					merged = append(merged, model)
				}
			}
			entry.Models = merged
			for _, model := range merged {
				display := got.Names[model]
				if display == "" || display == model {
					continue
				}
				if strings.TrimSpace(entry.ModelAliases[model]) == "" {
					if entry.ModelAliases == nil {
						entry.ModelAliases = map[string]string{}
					}
					entry.ModelAliases[model] = display
					changed = true
				}
			}
		}
		if changed {
			if err := edit.SaveTo(config.UserConfigPath()); err != nil {
				slog.Warn("auto refresh: could not save the display names", "err", err)
				return
			}
			slog.Info("auto refresh: display names read from the doors")
		}
	})
}

// refreshProviderModels re-runs the add-a-source probe against what is saved
// and writes what it found back: chat models the endpoint now serves join the
// list, and the endpoint's own display names land as model aliases — which is
// what makes a relay's renamed models (magpie's "custom name without vendor")
// reach the menu: the name rides the listing's display_name field.
func (s *Server) refreshProviderModels(w http.ResponseWriter, r *http.Request) {
	if !s.grants.at(r).providerEdit {
		refuse(w, http.StatusForbidden, "provider.editing_disabled", "provider editing is not enabled on this server", nil)
		return
	}
	var body struct {
		Name string `json:"name"`
	}
	if !decodeProviderBody(w, r, &body) {
		return
	}
	name := strings.TrimSpace(body.Name)
	if name == "" {
		notFound(w, "provider", name)
		return
	}
	edit := config.LoadForEdit(config.UserConfigPath())
	entry, ok := edit.Provider(name)
	if !ok {
		notFound(w, "provider", name)
		return
	}
	// A decision protocol carries no listing to merge — its models are the
	// forms' answer, not the endpoint's. The settings UI hides the button for
	// these; this is the belt behind it.
	if config.AnswersFor(entry.Kind) == config.AnswersDecision {
		refuse(w, http.StatusUnprocessableEntity, codeProbeNotCompatible, "this source's protocol has no model listing to refresh", map[string]any{"kind": entry.Kind})
		return
	}
	assembled, wasListed := assemblyShape(entry), s.runsListedModelOf(entry)
	ctx, cancel := context.WithTimeout(r.Context(), providerProbeTimeout)
	defer cancel()
	proxied, direct := probeClients()
	got, probeErr := catalog.ProbeEndpoint(ctx, catalog.ProbeOptions{
		BaseURL: entry.BaseURL,
		APIKey:  entry.APIKey(),
		Client:  proxied,
		Direct:  direct,
	})
	if probeErr != nil {
		var probe *catalog.ProbeError
		if !errors.As(probeErr, &probe) {
			writeErr(w, http.StatusInternalServerError, probeErr)
			return
		}
		status, code := probeReasonRefusal(probe.Reason)
		refuse(w, status, code, endpointDetail(probe.Body, entry.APIKey), probe.Params)
		return
	}
	// The list the person picked stays the list's spine; what the endpoint now
	// serves joins it. A model gone from the endpoint stays listed: dropping it
	// here would silence a conversation mid-turn for the sake of tidiness.
	merged := slices.Clone(entry.Models)
	for _, model := range got.Models {
		if !slices.Contains(merged, model) {
			merged = append(merged, model)
		}
	}
	entry.Models = merged
	// The display names the endpoint offers become aliases for the models the
	// person has not named themselves; a set alias wins, always.
	for _, model := range merged {
		display := got.Names[model]
		if display == "" || display == model {
			continue
		}
		if entry.ModelAliases == nil {
			entry.ModelAliases = map[string]string{}
		}
		if strings.TrimSpace(entry.ModelAliases[model]) == "" {
			entry.ModelAliases[model] = display
		}
	}
	if err := edit.SaveTo(config.UserConfigPath()); err != nil {
		writeErr(w, http.StatusInternalServerError, err)
		return
	}
	s.applyEditedProvider(w, r, entry, assemblyShape(entry) != assembled, wasListed)
}
