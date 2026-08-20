// Package ws fans out FeatureStore diffs to connected WebSocket clients.
package ws

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"time"

	"github.com/coder/websocket"

	"github.com/noi-techpark/open-mmc/backend/internal/model"
	"github.com/noi-techpark/open-mmc/backend/internal/store"
)

var activeLayers = []model.Layer{
	model.LayerParking,
	model.LayerECharging,
	model.LayerTrainVeh,
	model.LayerBusVeh,
	model.LayerBusAlert,
	model.LayerFlight,
}

type snapshotMessage struct {
	Type  string                  `json:"type"` // "snapshot"
	Data  model.FeatureCollection `json:"data"`
	Layer model.Layer             `json:"layer"`
}

type diffMessage struct {
	Type string     `json:"type"` // "diff"
	Data model.Diff `json:"data"`
}

func Handler(fs store.FeatureStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
			InsecureSkipVerify: true, // dev only: allow any origin
		})
		if err != nil {
			log.Printf("ws: accept: %v", err)
			return
		}
		defer conn.CloseNow()

		ctx := conn.CloseRead(context.Background())

		for _, layer := range activeLayers {
			snap := snapshotMessage{Type: "snapshot", Layer: layer, Data: model.NewFeatureCollection(fs.Snapshot(layer))}
			if err := writeJSON(ctx, conn, snap); err != nil {
				return
			}
		}

		diffCh := make(chan model.Diff, 256)
		unsubscribe := fs.Subscribe(diffCh)
		defer unsubscribe()

		for {
			select {
			case <-ctx.Done():
				return
			case d := <-diffCh:
				if err := writeJSON(ctx, conn, diffMessage{Type: "diff", Data: d}); err != nil {
					return
				}
			}
		}
	}
}

func writeJSON(ctx context.Context, conn *websocket.Conn, v any) error {
	b, err := json.Marshal(v)
	if err != nil {
		return err
	}
	writeCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	return conn.Write(writeCtx, websocket.MessageText, b)
}
