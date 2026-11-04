// Copyright (c) 2026 Julian Storer
// AGPL-3.0-or-later - see LICENSE

package worker

import (
	"testing"

	ycrdt "github.com/skyterra/y-crdt"
)

// TestThreadDistinctDeleteCaptureWindow keeps transport scheduling out of the
// capture-window contract: two separate authored transactions are applied
// directly to the worker, with its existing LastChange clock anchor controlled
// before the second arrives. No capture timeout or production clock is changed.
func TestThreadDistinctDeleteCaptureWindow(t *testing.T) {
	for _, tc := range []struct {
		name          string
		previousAgeMS int64
		groups        int
		restored      int
	}{
		{name: "within-window", previousAgeMS: 0, groups: 1, restored: 2},
		{name: "expired-window", previousAgeMS: 1000, groups: 2, restored: 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			doc := NewConversationDocument("capture-test", "user:test")
			defer doc.Destroy()
			tracker := NewOperationTracker(doc)
			nested := doc.InsertThread(0, "Capture window")
			threadID := doc.GetItems()[0].ItemID
			doc.InsertMessageIntoArray(nested, 0,
				ConversationItem{Type: "user", ItemID: "first", Content: "First"},
				ConversationItem{Type: "assistant", ItemID: "second", Content: "Second"})
			tracker.EnsureInitialized()
			tracker.ClearHistory()

			func() {
				ycrdtMu.Lock()
				defer ycrdtMu.Unlock()
				ycrdt.Transact(doc.doc, func(_ *ycrdt.Transaction) {
					nested.Delete(1, 1)
				}, doc.authorID, true)
			}()
			if items := doc.GetItemsFromArray(nested); len(items) != 1 || items[0].ItemID != "first" {
				t.Fatalf("first delete should retain exactly the first item, got %+v", items)
			}

			// Keep the clock anchor and arrival adjacent under the worker's
			// existing document lock, without sleeps or browser round trips.
			groups := func() int {
				ycrdtMu.Lock()
				defer ycrdtMu.Unlock()
				tracker.undoManager.LastChange = ycrdt.Number(ycrdt.GetUnixTime() - tc.previousAgeMS)
				ycrdt.Transact(doc.doc, func(_ *ycrdt.Transaction) {
					nested.Delete(0, 1)
				}, doc.authorID, true)
				return len(tracker.undoManager.UndoStack)
			}()
			if groups != tc.groups {
				t.Fatalf("expected %d undo groups for distinct transactions, got %d", tc.groups, groups)
			}
			if got := len(doc.GetItemsFromArray(nested)); got != 0 {
				t.Fatalf("second delete should empty the thread, got %d items", got)
			}

			tracker.Undo()
			restored := doc.GetItemsFromArray(doc.GetThreadItemsArray(threadID))
			if len(restored) != tc.restored {
				t.Fatalf("undo: expected %d restored items, got %d", tc.restored, len(restored))
			}
			if restored[0].ItemID != "first" || (tc.restored == 2 && restored[1].ItemID != "second") {
				t.Fatalf("undo changed item identity or order: %+v", restored)
			}
			tracker.Redo()
			if got := len(doc.GetItemsFromArray(doc.GetThreadItemsArray(threadID))); got != 0 {
				t.Fatalf("redo should empty the thread again, got %d items", got)
			}
		})
	}
}
