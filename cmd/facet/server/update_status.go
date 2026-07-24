// Copyright (c) 2026 Julian Storer
// AGPL-3.0-or-later - see LICENSE

package server

import (
	"net/http"
	"os"
	"runtime"

	"facet/cmd/facet/core"
	"facet/cmd/facet/server/handlers"
	"facet/internal/updatecheck"
)

// updateManifestURL resolves the version-manifest URL: FACET_VERSION_MANIFEST_URL
// overrides the well-known default (used by tests and staging).
func updateManifestURL() string {
	if u := os.Getenv("FACET_VERSION_MANIFEST_URL"); u != "" {
		return u
	}
	return updatecheck.DefaultManifestURL
}

// newUpdateChecker builds the version-manifest checker for this build, wiring
// OnChange to push the new status to every connected viewer. The poll loop is
// started later by startUpdateChecker.
func (s *Server) newUpdateChecker() *updatecheck.Checker {
	return updatecheck.New(updatecheck.Config{
		URL:            updateManifestURL(),
		CurrentVersion: core.Version,
		OS:             runtime.GOOS,
		Arch:           runtime.GOARCH,
		OnChange: func(st updatecheck.Status) {
			s.broadcastToAll(updateStatusMsg{Type: "update-status", Status: st})
		},
	})
}

// startUpdateChecker begins polling, unless this is a test-mode server (the
// suite must never reach the network) — in which case /api/update-status still
// answers with the seeded "no update" status.
func (s *Server) startUpdateChecker() {
	// Prizmanyx fork: never poll upstream's version manifest. This build is
	// pinned — updates ship through the fork, and the upstream auto-updater
	// would replace the patched binary. /api/update-status still answers
	// with the seeded "no update" status, and the rest of the update
	// plumbing stays intact so a fork-owned manifest can revive it later.
	_ = s
}

// updateStatusMsg is the WS push envelope; embedding Status promotes its fields
// (currentVersion, latestVersion, updateAvailable, notice) to the top level
// alongside the type tag, matching the /api/update-status response shape.
type updateStatusMsg struct {
	Type string `json:"type"`
	updatecheck.Status
}

// handleUpdateStatus returns the latest computed update decision for this build.
func (s *Server) handleUpdateStatus(w http.ResponseWriter, r *http.Request) {
	var st updatecheck.Status
	if s.updateChecker != nil {
		st = s.updateChecker.Current()
	} else {
		st = updatecheck.Status{CurrentVersion: core.Version}
	}
	handlers.WriteJSON(w, r, 0, st)
}
