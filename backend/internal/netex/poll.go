package netex

import (
	"context"
	"log"
	"time"
)

// Poll checks on checkInterval whether the store's data is at least
// MaxAge old, and only then actually re-fetches — checking cheaply and
// often while the expensive part (downloading + streaming ~800MB of XML)
// happens at most once a week, matching how rarely this data changes.
func Poll(ctx context.Context, store *Store, checkInterval time.Duration) {
	tick := func() {
		if store.Age() < MaxAge {
			return
		}
		now := time.Now()
		data, day, err := FetchLatest(now)
		if err != nil {
			log.Printf("netex: fetch failed: %v", err)
			return
		}
		store.Set(data, now)
		log.Printf("netex: refreshed from %s export, %d lines, %d quays", day.Format("2006-01-02"), len(data.Lines), len(data.Quays))
	}

	tick()
	ticker := time.NewTicker(checkInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			tick()
		}
	}
}
