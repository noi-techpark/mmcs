// Package store defines the storage abstractions used by the rest of the
// backend. FeatureStore holds realtime, volatile layer state. Kept behind
// an interface so an in-memory implementation (used now) can later be
// swapped for something durable without touching pollers, middleware, the
// WS hub, or the frontend. See design.md.
package store

import (
	"sync"
	"time"

	"github.com/noi-techpark/open-mmc/backend/internal/model"
)

// MaxFeatureAge is the default freshness policy for realtime data: a
// feature older than this — by the age of the data itself
// (model.Properties.RecordedAt), not by when we last touched it — is
// rejected on arrival and swept out if it stops being refreshed. A feed
// whose own update cadence doesn't fit this (e.g. e-charging, which is
// only pushed on state change) overrides it via SetMaxAge at startup —
// see main.go — not through any user-facing setting.
const MaxFeatureAge = 30 * time.Minute

type FeatureStore interface {
	Upsert(f model.Feature)
	Delete(layer model.Layer, id string)
	Snapshot(layer model.Layer) []model.Feature
	// Subscribe registers a channel that receives every future diff.
	// The returned func unsubscribes.
	Subscribe(ch chan<- model.Diff) (unsubscribe func())
	// Sweep evicts features whose RecordedAt is older than their layer's
	// freshness threshold, broadcasting a delete diff for each. Returns
	// the count removed.
	Sweep() int
	// SetMaxAge overrides the freshness threshold for a specific layer
	// (default MaxFeatureAge otherwise). Intended to be called once at
	// startup when wiring a feed, not exposed via any API/UI.
	SetMaxAge(layer model.Layer, maxAge time.Duration)
}

type memoryStore struct {
	mu            sync.RWMutex
	features      map[model.Layer]map[string]model.Feature
	maxAgeByLayer map[model.Layer]time.Duration
	subsMu        sync.Mutex
	subs          map[chan<- model.Diff]struct{}
}

func NewMemoryStore() FeatureStore {
	return &memoryStore{
		features:      make(map[model.Layer]map[string]model.Feature),
		maxAgeByLayer: make(map[model.Layer]time.Duration),
		subs:          make(map[chan<- model.Diff]struct{}),
	}
}

func (s *memoryStore) SetMaxAge(layer model.Layer, maxAge time.Duration) {
	s.mu.Lock()
	s.maxAgeByLayer[layer] = maxAge
	s.mu.Unlock()
}

// maxAgeForLocked returns the freshness threshold for layer. Caller must
// already hold s.mu (read or write).
func (s *memoryStore) maxAgeForLocked(layer model.Layer) time.Duration {
	if d, ok := s.maxAgeByLayer[layer]; ok {
		return d
	}
	return MaxFeatureAge
}

func (s *memoryStore) Upsert(f model.Feature) {
	s.mu.RLock()
	maxAge := s.maxAgeForLocked(f.Properties.Layer)
	s.mu.RUnlock()

	if !f.Properties.RecordedAt.IsZero() && time.Since(f.Properties.RecordedAt) > maxAge {
		return // stale on arrival
	}

	s.mu.Lock()
	layerMap, ok := s.features[f.Properties.Layer]
	if !ok {
		layerMap = make(map[string]model.Feature)
		s.features[f.Properties.Layer] = layerMap
	}
	layerMap[f.ID] = f
	s.mu.Unlock()

	s.broadcast(model.Diff{Layer: f.Properties.Layer, Action: model.DiffUpsert, Feature: f})
}

func (s *memoryStore) Delete(layer model.Layer, id string) {
	s.mu.Lock()
	var f model.Feature
	if layerMap, ok := s.features[layer]; ok {
		f = layerMap[id]
		delete(layerMap, id)
	}
	s.mu.Unlock()

	s.broadcast(model.Diff{Layer: layer, Action: model.DiffDelete, Feature: f})
}

func (s *memoryStore) Snapshot(layer model.Layer) []model.Feature {
	s.mu.RLock()
	defer s.mu.RUnlock()
	layerMap := s.features[layer]
	out := make([]model.Feature, 0, len(layerMap))
	for _, f := range layerMap {
		out = append(out, f)
	}
	return out
}

func (s *memoryStore) Subscribe(ch chan<- model.Diff) (unsubscribe func()) {
	s.subsMu.Lock()
	s.subs[ch] = struct{}{}
	s.subsMu.Unlock()

	return func() {
		s.subsMu.Lock()
		delete(s.subs, ch)
		s.subsMu.Unlock()
	}
}

func (s *memoryStore) Sweep() int {
	s.mu.Lock()
	var stale []model.Diff
	for layer, layerMap := range s.features {
		cutoff := time.Now().Add(-s.maxAgeForLocked(layer))
		for id, f := range layerMap {
			if f.Properties.RecordedAt.IsZero() || f.Properties.RecordedAt.After(cutoff) {
				continue
			}
			delete(layerMap, id)
			stale = append(stale, model.Diff{Layer: layer, Action: model.DiffDelete, Feature: f})
		}
	}
	s.mu.Unlock()

	for _, d := range stale {
		s.broadcast(d)
	}
	return len(stale)
}

func (s *memoryStore) broadcast(d model.Diff) {
	s.subsMu.Lock()
	defer s.subsMu.Unlock()
	for ch := range s.subs {
		select {
		case ch <- d:
		default:
			// slow subscriber, drop the diff rather than block pollers
		}
	}
}
