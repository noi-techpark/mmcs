package gtfs

import (
	"context"
	"log"
	"time"

	"github.com/noi-techpark/open-mmc/backend/internal/store"
)

// Poll fetches and rebuilds the airport's flight-list Feature on a fixed
// interval. GTFS is a static schedule (no per-record streaming), so unlike
// the other feeds this recomputes one aggregate Feature each cycle rather
// than upserting many.
func Poll(ctx context.Context, client *Client, url, airportCode, airportName string, lon, lat float64, days int, interval time.Duration, fs store.FeatureStore) {
	tick := func() {
		feature, err := FetchAirportFeature(client, url, airportCode, airportName, lon, lat, days)
		if err != nil {
			log.Printf("gtfs[%s]: %v", airportCode, err)
			return
		}
		fs.Upsert(feature)
		flights, _ := feature.Properties.Data["flights"].([]map[string]any)
		log.Printf("gtfs[%s]: %d flights over next %d days", airportCode, len(flights), days)
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
