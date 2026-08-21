package netex

import (
	"context"
	"log"
	"time"
)

// netexRetryDelay is how long Poll waits before trying again after
// FetchLatest exhausts all 3 day fallbacks (today + previous 2 days)
// without finding a published file — short enough to pick up a same-day
// publish soon after it lands, without hammering the FTP server every
// checkInterval in the meantime.
const netexRetryDelay = 30 * time.Minute

// Poll checks on checkInterval whether the store's data is at least
// MaxAge old, and only then actually re-fetches — checking cheaply and
// often while the expensive part (downloading + streaming ~800MB of XML)
// happens at most once a week, matching how rarely this data changes. A
// failed fetch is retried after netexRetryDelay instead, independent of
// checkInterval/MaxAge, so a temporarily-missing export doesn't sit
// unretried until the next scheduled staleness check.
func Poll(ctx context.Context, store *Store, checkInterval time.Duration) {
	tick := func() time.Duration {
		if store.Age() < MaxAge {
			return checkInterval
		}
		now := time.Now()
		data, day, err := FetchLatest(now)
		if err != nil {
			log.Printf("netex: fetch failed: %v", err)
			return netexRetryDelay
		}
		store.Set(data, now)
		log.Printf("netex: refreshed from %s export, %d lines, %d quays", day.Format("2006-01-02"), len(data.Lines), len(data.Quays))
		return checkInterval
	}

	timer := time.NewTimer(0) // fire immediately for the first tick
	defer timer.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
			timer.Reset(tick())
		}
	}
}
