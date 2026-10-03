// Copyright (c) 2026 Julian Storer
// AGPL-3.0-or-later - see LICENSE

package server

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gorilla/mux"
)

func TestPrizmanyxProxyOnlyForwardsExplicitV2Capabilities(t *testing.T) {
	var received http.Header
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		received = r.Header.Clone()
		w.WriteHeader(http.StatusNoContent)
	}))
	defer backend.Close()
	t.Setenv("PRIZMANYX_API_BASE", backend.URL)
	s := &Server{router: mux.NewRouter()}
	s.registerPrizmanyxProxy()
	for _, test := range []struct {
		name, authorization, want string
	}{
		{"scoped", "Bearer v2.7.1234567890.1.workspace_write.nonce.signature", "Bearer v2.7.1234567890.1.workspace_write.nonce.signature"},
		{"provider", "Bearer provider-secret", ""},
		{"legacy", "Bearer 7.1234567890.signature", ""},
		{"basic", "Basic credential", ""},
		{"oversize", "Bearer v2." + strings.Repeat("x", 520), ""},
	} {
		t.Run(test.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, "/pzx/api/v1/programs/7/agents/spawn", nil)
			req.Host = "localhost"
			req.Header.Set("Authorization", test.authorization)
			req.Header.Set("Cookie", "facet_session=private")
			req.Header.Set("X-Facet-Token", "instance-secret")
			recorder := httptest.NewRecorder()
			s.router.ServeHTTP(recorder, req)
			if recorder.Code != http.StatusNoContent {
				t.Fatalf("proxy returned %d", recorder.Code)
			}
			if received.Get("Authorization") != test.want {
				t.Fatal("proxy forwarded an unexpected credential")
			}
			if received.Get("Cookie") != "" || received.Get("X-Facet-Token") != "" {
				t.Fatal("ambient Facet authentication crossed the proxy")
			}
		})
	}
}
