// SPDX-FileCopyrightText: 2026 NOI Techpark
//
// SPDX-License-Identifier: AGPL-3.0-or-later

package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/noi-techpark/open-mmc/backend/internal/api"
	"github.com/noi-techpark/open-mmc/backend/internal/feeds/gtfs"
	"github.com/noi-techpark/open-mmc/backend/internal/feeds/odh"
	"github.com/noi-techpark/open-mmc/backend/internal/feeds/siri"
	"github.com/noi-techpark/open-mmc/backend/internal/feeds/tourism"
	"github.com/noi-techpark/open-mmc/backend/internal/model"
	"github.com/noi-techpark/open-mmc/backend/internal/netex"
	"github.com/noi-techpark/open-mmc/backend/internal/odhauth"
	"github.com/noi-techpark/open-mmc/backend/internal/store"
	"github.com/noi-techpark/open-mmc/backend/internal/ws"
)

const siriBaseURL = "https://siri.api.opendatahub.com"
const siriLiteBaseURL = "https://efa.sta.bz.it"
const skyalpsGTFSURL = "https://gtfs.api.opendatahub.com/v1/dataset/skyalps-flight-data/raw"

// onDemandVMURL is STA's demand-responsive-transport SIRI-VM feed (dial-a-
// ride vehicles) — a single fixed endpoint, not the baseURL+datasetId
// convention the Anshar siriClient uses for trains (see siri.PollAt).
const onDemandVMURL = "https://ssl.autoroute.it/apps/stadrttest/ws/siri/vm"

const bolzanoAirportLon = 11.3264
const bolzanoAirportLat = 46.4602

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	fs := store.NewMemoryStore()

	// E-charging stations are only re-pushed by the source when their
	// state actually changes, not on a fixed cadence — the default
	// 30-minute freshness window would otherwise evict stations that are
	// simply quiet, not stale.
	fs.SetMaxAge(model.LayerECharging, 48*time.Hour)
	// The flight list is a static weekly schedule rebuilt once an hour;
	// give it enough headroom that it never expires between polls.
	fs.SetMaxAge(model.LayerFlight, 3*time.Hour)
	// SIAG weather readings have observed real-world publish lag of ~2h+
	// between mvalidtime and appearing as "latest" — the default 30-minute
	// window would leave this layer empty under normal conditions, not
	// just during an outage.
	fs.SetMaxAge(model.LayerWeather, 3*time.Hour)
	// A22 traffic sensors were observed with ~1h of real-world publish lag
	// between mvalidtime and appearing as "latest" (readings are on a
	// ~10-minute sampling period, but ingestion into ODH lags well past
	// that) — the default 30-minute window rejected every reading as
	// stale on arrival.
	fs.SetMaxAge(model.LayerTraffic, 2*time.Hour)
	// LinkStation travel-time segments come from the same A22 pipeline and
	// observe the same publish lag as the point sensors above.
	fs.SetMaxAge(model.LayerTrafficSegment, 2*time.Hour)
	// EAQI ratings are hourly averages (mperiod=3600), so a reading is
	// legitimately up to an hour old before the next one arrives — the
	// default 30-minute window would drop most stations between updates.
	fs.SetMaxAge(model.LayerAirQuality, 3*time.Hour)
	// Ecocounter bike-counter readings (see odh.PollBikeCounter) were
	// observed with ~13h of real-world publish lag between mvalidtime and
	// appearing as "latest" despite an hourly (mperiod=3600) sampling
	// period — the default 30-minute window rejected every reading as
	// stale on arrival. Also covers BikeParking, sharing this layer; that
	// feed is near-real-time, so the wider window doesn't cost it anything.
	fs.SetMaxAge(model.LayerBicycle, 24*time.Hour)

	odhClient := odh.NewClient()
	go odh.Poll(ctx, odhClient, "parking", odh.ParkingURL, 60*time.Second, odh.NormalizeParking, fs)
	go odh.Poll(ctx, odhClient, "echarging", odh.EChargingURL, 60*time.Second, odh.NormalizeECharging, fs)
	go odh.PollWeather(ctx, odhClient, 5*time.Minute, fs)
	go odh.Poll(ctx, odhClient, "bike-parking", odh.BikeParkingURL, 60*time.Second, odh.NormalizeBikeParking, fs)
	go odh.PollBikeCounter(ctx, odhClient, 5*time.Minute, fs)
	go odh.PollOnDemand(ctx, odhClient, 60*time.Second, fs)
	go odh.Poll(ctx, odhClient, "air-quality", odh.AirQualityURL, 5*time.Minute, odh.NormalizeAirQuality, fs)
	go odh.Poll(ctx, odhClient, "carsharing", odh.CarsharingURL, 60*time.Second, odh.NormalizeCarsharing, fs)
	go odh.PollLinkTraffic(ctx, odhClient, 60*time.Second, fs)

	siriClient := siri.NewClient(siriBaseURL)
	go siri.Poll(ctx, siriClient, "SAD-trains", model.LayerTrainVeh, 15*time.Second, fs)
	go siri.PollAt(ctx, siriClient, onDemandVMURL, "sta-drt", model.LayerOnDemandVM, 15*time.Second, fs)

	siriLiteClient := siri.NewLiteClient(siriLiteBaseURL)
	go siri.PollLite(ctx, siriLiteClient, "sta-bus", model.LayerBusVeh, 15*time.Second, fs)

	etStore := siri.NewETStore()
	go siri.PollET(ctx, siriLiteClient, 60*time.Second, etStore)

	gtfsClient := gtfs.NewClient()
	go gtfs.Poll(ctx, gtfsClient, skyalpsGTFSURL, "BZO", "Bolzano Airport", bolzanoAirportLon, bolzanoAirportLat, 7, time.Hour, fs)

	netexStore := netex.NewStore()
	go netex.Poll(ctx, netexStore, time.Hour)

	odhAuthClient, err := odhauth.NewClient(ctx)
	if err != nil {
		log.Printf("odhauth: %v — authenticated ODH features unavailable", err)
	} else {
		go odh.PollTraffic(ctx, odh.NewAuthenticatedClient(odhAuthClient), 60*time.Second, fs)
	}

	go siri.PollSX(ctx, siriLiteClient, model.LayerBusAlert, 60*time.Second, fs, netexStore)

	tourismClient := tourism.NewClient()
	go tourism.PollAnnouncements(ctx, tourismClient, []string{"a22", "PROVINCE_BZ"}, model.LayerBusAlert, 5*time.Minute, fs)

	go runStaleSweeper(ctx, fs)

	mux := http.NewServeMux()
	mux.HandleFunc("/api/layers/", api.SnapshotHandler(fs))
	mux.HandleFunc("/api/lines/", api.LineHandler(netexStore))
	mux.HandleFunc("/api/journey", api.JourneyHandler(netexStore))
	mux.HandleFunc("/api/estimated-timetable", api.EstimatedTimetableHandler(etStore))
	mux.HandleFunc("/ws", ws.Handler(fs))

	frontendDir := "./static"
	if _, err := os.Stat(frontendDir); err == nil {
		mux.Handle("/", http.FileServer(http.Dir(frontendDir)))
	}

	addr := ":8080"
	if v := os.Getenv("ADDR"); v != "" {
		addr = v
	}

	srv := &http.Server{Addr: addr, Handler: mux}
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		srv.Shutdown(shutdownCtx)
	}()

	log.Printf("listening on %s", addr)
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}

// runStaleSweeper periodically evicts features whose underlying data has
// aged past store.MaxFeatureAge without being refreshed (e.g. a vehicle
// that stopped reporting). Upsert already rejects stale data on arrival;
// this catches data that was fresh once but was never updated again.
func runStaleSweeper(ctx context.Context, fs store.FeatureStore) {
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if n := fs.Sweep(); n > 0 {
				log.Printf("sweeper: evicted %d stale features", n)
			}
		}
	}
}
