package siri

import (
	"context"
	"log"
	"time"

	"github.com/noi-techpark/open-mmc/backend/internal/model"
	"github.com/noi-techpark/open-mmc/backend/internal/store"
)

// Poll runs a single SIRI-VM datasetId on a fixed interval, normalizing each
// VehicleActivity and upserting it into the store. Blocks until ctx is cancelled.
func Poll(ctx context.Context, client *Client, datasetID string, layer model.Layer, interval time.Duration, fs store.FeatureStore) {
	tick := func() {
		activities, err := client.FetchVM(datasetID)
		if err != nil {
			log.Printf("siri[%s]: %v", datasetID, err)
			return
		}
		n := 0
		for _, va := range activities {
			f, ok := Normalize(datasetID, layer, va)
			if !ok {
				continue
			}
			fs.Upsert(f)
			n++
		}
		log.Printf("siri[%s]: upserted %d features", datasetID, n)
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
