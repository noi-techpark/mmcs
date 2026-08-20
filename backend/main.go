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
	"github.com/noi-techpark/open-mmc/backend/internal/model"
	"github.com/noi-techpark/open-mmc/backend/internal/netex"
	"github.com/noi-techpark/open-mmc/backend/internal/store"
	"github.com/noi-techpark/open-mmc/backend/internal/ws"
)

const siriBaseURL = "https://siri.api.opendatahub.com"
const siriLiteBaseURL = "https://efa.sta.bz.it"
const skyalpsGTFSURL = "https://gtfs.api.opendatahub.com/v1/dataset/skyalps-flight-data/raw"

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

	odhClient := odh.NewClient()
	go odh.Poll(ctx, odhClient, "parking", odh.ParkingURL, 60*time.Second, odh.NormalizeParking, fs)
	go odh.Poll(ctx, odhClient, "echarging", odh.EChargingURL, 60*time.Second, odh.NormalizeECharging, fs)

	siriClient := siri.NewClient(siriBaseURL)
	go siri.Poll(ctx, siriClient, "SAD-trains", model.LayerTrainVeh, 15*time.Second, fs)

	siriLiteClient := siri.NewLiteClient(siriLiteBaseURL)
	go siri.PollLite(ctx, siriLiteClient, "sta-bus", model.LayerBusVeh, 15*time.Second, fs)

	etStore := siri.NewETStore()
	go siri.PollET(ctx, siriLiteClient, 60*time.Second, etStore)

	gtfsClient := gtfs.NewClient()
	go gtfs.Poll(ctx, gtfsClient, skyalpsGTFSURL, "BZO", "Bolzano Airport", bolzanoAirportLon, bolzanoAirportLat, 7, time.Hour, fs)

	netexStore := netex.NewStore()
	go netex.Poll(ctx, netexStore, time.Hour)

	go siri.PollSX(ctx, siriLiteClient, model.LayerBusAlert, 60*time.Second, fs, netexStore)

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
