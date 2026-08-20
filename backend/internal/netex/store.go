package netex

import (
	"sort"
	"sync"
	"time"
)

// MaxAge is the freshness policy for the NeTEx reference data — this is a
// static schedule export, so refresh it at most this often (see Poll)
// rather than on every check.
const MaxAge = 7 * 24 * time.Hour

// Store holds the most recently fetched Lines/Quays, replaced wholesale on
// each refresh (never partially updated) since NeTEx is fetched as one
// export, not a stream of incremental changes.
type Store struct {
	mu    sync.RWMutex
	lines map[string]Line
	quays map[string]Stop
	// Secondary index onto lines, by PublicCode (falling back to
	// ShortName): rail's SIRI feed already emits NeTEx-shaped LineRefs, so
	// direct id lookup is enough for it, but STA's bus SIRI-lite feed emits
	// bare operator line codes (e.g. "317") which only match here.
	linesByCode map[string]string
	updatedAt   time.Time
}

func NewStore() *Store {
	return &Store{lines: make(map[string]Line), quays: make(map[string]Stop)}
}

func (s *Store) Line(id string) (Line, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if l, ok := s.lines[id]; ok {
		return l, true
	}
	if lineID, ok := s.linesByCode[id]; ok {
		return s.lines[lineID], true
	}
	return Line{}, false
}

// Quay resolves a NeTEx Quay id (the scheme SIRI-SX's StopPointRef also
// uses, e.g. "it:22021:2189:0:5133") to its coordinates.
func (s *Store) Quay(id string) (Stop, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	q, ok := s.quays[id]
	return q, ok
}

func (s *Store) Set(data Data, fetchedAt time.Time) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.lines = data.Lines
	s.quays = data.Quays
	// PublicCode (and ShortName) are only unique per-operator, not
	// province-wide — e.g. "1" and "REG" are each reused by several
	// unrelated lines from different operators — so collisions here are
	// expected, not a bug, and not resolvable from the code alone (see
	// FindJourney's doc comment for the operator-disambiguation gap this
	// leaves). First-by-id wins; ids are visited in sorted order so the
	// choice is at least deterministic and reproducible across restarts,
	// rather than depending on Go's randomized map iteration order.
	ids := make([]string, 0, len(data.Lines))
	for id := range data.Lines {
		ids = append(ids, id)
	}
	sort.Strings(ids)

	linesByCode := make(map[string]string, len(data.Lines))
	for _, id := range ids {
		l := data.Lines[id]
		if l.PublicCode != "" {
			if _, exists := linesByCode[l.PublicCode]; !exists {
				linesByCode[l.PublicCode] = id
			}
		}
		if l.ShortName != "" {
			if _, exists := linesByCode[l.ShortName]; !exists {
				linesByCode[l.ShortName] = id
			}
		}
	}
	s.linesByCode = linesByCode
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
