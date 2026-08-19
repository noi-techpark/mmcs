package odh

import (
	"context"
	"log"
	"time"

	"github.com/noi-techpark/open-mmc/backend/internal/model"
	"github.com/noi-techpark/open-mmc/backend/internal/store"
)

// NormalizeFunc converts one raw ODH record into a Feature. Returns ok=false
// to skip records that don't belong in the layer (e.g. inactive stations).
type NormalizeFunc func(Record) (model.Feature, bool)

// Poll runs a single ODH flat endpoint on a fixed interval, normalizing each
// record and upserting it into the store. Blocks until ctx is cancelled.
func Poll(ctx context.Context, client *Client, name, url string, interval time.Duration, normalize NormalizeFunc, fs store.FeatureStore) {
	tick := func() {
		records, err := client.FetchFlat(url)
		if err != nil {
			log.Printf("odh[%s]: %v", name, err)
			return
		}
		n := 0
		for _, r := range records {
			f, ok := normalize(r)
			if !ok {
				continue
			}
			fs.Upsert(f)
			n++
		}
		log.Printf("odh[%s]: upserted %d features", name, n)
	}

	tick()
	ticker := time.NewTicker(interval)
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
