package netex

import (
	"sync"
	"time"
)

// MaxAge is the freshness policy for the NeTEx reference data — this is a
// static schedule export, so refresh it at most this often (see Poll)
// rather than on every check.
const MaxAge = 7 * 24 * time.Hour

// Store holds the most recently fetched Lines, replaced wholesale on each
// refresh (never partially updated) since NeTEx is fetched as one export,
// not a stream of incremental changes.
type Store struct {
	mu        sync.RWMutex
	lines     map[string]Line
	updatedAt time.Time
}

func NewStore() *Store {
	return &Store{lines: make(map[string]Line)}
}

func (s *Store) Line(id string) (Line, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	l, ok := s.lines[id]
	return l, ok
}

func (s *Store) Set(lines map[string]Line, fetchedAt time.Time) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.lines = lines
	s.updatedAt = fetchedAt
}

// Age is how long ago the held data was fetched. A zero-value Store (never
// fetched) reports an effectively-infinite age so Poll always fetches once.
func (s *Store) Age() time.Duration {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.updatedAt.IsZero() {
		return time.Duration(1<<63 - 1)
	}
	return time.Since(s.updatedAt)
}
