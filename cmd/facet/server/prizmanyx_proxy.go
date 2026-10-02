// Copyright (c) 2026 Julian Storer
// AGPL-3.0-or-later - see LICENSE

package server

import (
	"io"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"strings"
	"sync/atomic"

	"facet/internal/jlog"
)

// pzxContext holds the Prizmanyx console capability (program id + token +
// web origin, an opaque JSON blob to us) handed over by the embedded bridge.
// Server-held ON PURPOSE: browsers PARTITION a third-party iframe's
// localStorage, so a value stored by the embedded console never reaches the
// pop-out/standalone window — the server is the one place every fork window
// shares. Both verbs live under /api so the per-instance X-Facet-Token
// middleware gates them (the embedded page and the standalone window both
// hold that token; other local processes and web pages do not).
var pzxContext atomic.Value // string (JSON)

func (s *Server) handleGetPzxContext(w http.ResponseWriter, r *http.Request) {
	stored, _ := pzxContext.Load().(string)
	if stored == "" {
		http.Error(w, "no Prizmanyx context stored", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write([]byte(stored))
}

func (s *Server) handlePutPzxContext(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(io.LimitReader(r.Body, 8*1024))
	if err != nil || len(body) == 0 {
		http.Error(w, "empty context", http.StatusBadRequest)
		return
	}
	pzxContext.Store(string(body))
	w.WriteHeader(http.StatusNoContent)
}

// registerPrizmanyxProxy mounts /pzx/* as a reverse proxy to the Prizmanyx API
// (PRIZMANYX_API_BASE, e.g. http://127.0.0.1:8000). Unset = no route.
//
// This is what makes the native Workspace/Browser panes possible: the panel
// components fetch and iframe `/pzx/...` SAME-ORIGIN, so the fork's CSP
// (default-src 'self') needs no widening, no CORS is involved, and the
// gateway's rewritten relative `view?`/`raw?` links keep resolving under the
// proxied path. Auth is Prizmanyx's own program-bound capability token (`t=`),
// carried in each proxied URL — so this proxy adds no fork-token requirement
// (an iframe navigation cannot set X-Facet-Token anyway) and forwards no
// fork credentials: Cookie and X-Facet-Token are stripped. Only an explicit
// Prizmanyx v2 Bearer capability is forwarded for a mutation; the backend
// verifies its signature, program, expiry and purpose.
// The Host allowlist still applies (a hostile page on another host cannot use
// the fork as a springboard, and without a valid capability token Prizmanyx
// answers 401 regardless).
func (s *Server) registerPrizmanyxProxy() {
	base := strings.TrimRight(os.Getenv("PRIZMANYX_API_BASE"), "/")
	if base == "" {
		return
	}
	target, err := url.Parse(base)
	if err != nil || target.Scheme == "" || target.Host == "" {
		jlog.Error("PRIZMANYX_API_BASE is not a valid URL, /pzx proxy disabled: %q", base)
		return
	}
	proxy := &httputil.ReverseProxy{
		Rewrite: func(pr *httputil.ProxyRequest) {
			pr.SetURL(target)
			pr.Out.Host = target.Host
			pr.Out.Header.Del("Cookie")
			pr.Out.Header.Del("X-Facet-Token")
			authorization := pr.In.Header.Get("Authorization")
			pr.Out.Header.Del("Authorization")
			// Only the explicit Prizmanyx v2 capability may cross this proxy.
			// Never forward ambient provider or Facet authentication.
			if strings.HasPrefix(authorization, "Bearer v2.") && len(authorization) <= 520 {
				pr.Out.Header.Set("Authorization", authorization)
			}
		},
	}
	handler := http.StripPrefix("/pzx", proxy)
	s.router.PathPrefix("/pzx/").Handler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !hostAllowed(r) {
			http.Error(w, "Forbidden: host not allowed", http.StatusForbidden)
			return
		}
		handler.ServeHTTP(w, r)
	}))
	jlog.Info("🔗 Prizmanyx proxy: /pzx/* -> %s", base)
}
