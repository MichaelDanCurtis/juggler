// Copyright (c) 2026 Julian Storer
// AGPL-3.0-or-later - see LICENSE

//go:build !production

package testing

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// A module import error must reach the Go runner even when the browser entry
// module never starts, rather than looking like an empty inventory timeout.
func TestRegistrationReportsModuleErrors(t *testing.T) {
	api := &TestRunAPI{namesCh: make(chan testNames, 1)}
	post := httptest.NewRecorder()
	api.HandlePostNames(post, httptest.NewRequest(http.MethodPost, "/api/test/names",
		strings.NewReader(`{"names":[],"errors":["Module name juggler/a2ui does not resolve"]}`)))
	if post.Code != http.StatusNoContent {
		t.Fatalf("post status %d", post.Code)
	}
	get := httptest.NewRecorder()
	api.HandleGetNames(get, httptest.NewRequest(http.MethodGet, "/api/test/names", nil))
	var payload testNames
	if err := json.Unmarshal(get.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if len(payload.Errors) != 1 || payload.Errors[0] != "Module name juggler/a2ui does not resolve" {
		t.Fatalf("registration error lost: %#v", payload)
	}
}
