// SPDX-FileCopyrightText: 2026 NOI Techpark
//
// SPDX-License-Identifier: AGPL-3.0-or-later

package tourism

import (
	"context"
	"log"
	"time"

	"github.com/noi-techpark/open-mmc/backend/internal/model"
	"github.com/noi-techpark/open-mmc/backend/internal/store"
)

// PollAnnouncements runs the Announcement endpoint on a fixed interval for
// the given sources (e.g. "a22", "PROVINCE_BZ"), normalizing and upserting
// each into the store under layer.
func PollAnnouncements(ctx context.Context, client *Client, sources []string, layer model.Layer, interval time.Duration, fs store.FeatureStore) {
	tick := func() {
		items, err := client.FetchActive(sources)
		if err != nil {
			log.Printf("tourism[announcement]: %v", err)
			return
		}
		n, skipped := 0, 0
		for _, a := range items {
			f, ok := Normalize(layer, a)
			if !ok {
				skipped++
				continue
			}
			fs.Upsert(f)
			n++
		}
		log.Printf("tourism[announcement]: upserted %d features, skipped %d (no position)", n, skipped)
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
