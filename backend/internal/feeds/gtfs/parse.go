// Package gtfs fetches a GTFS static feed (a zip of CSV files) and, for a
// single airport stop, aggregates the next N days of scheduled flights
// into one Feature. GTFS is a static schedule, not a stream of per-record
// updates like the other feeds, so this package doesn't follow the
// poller+normalizer shape of internal/feeds/odh or siri — it fetches and
// computes a single aggregate result each poll.
package gtfs

import (
	"archive/zip"
	"bytes"
	"encoding/csv"
	"fmt"
	"io"
	"net/http"
	"time"
)

type Client struct {
	httpClient *http.Client
}

func NewClient() *Client {
	return &Client{httpClient: &http.Client{Timeout: 30 * time.Second}}
}

// feed holds the parsed tables we need. GTFS has many more files/columns;
// we only read what flight aggregation actually uses.
type feed struct {
	stopNames map[string]string          // stop_id -> stop_name
	trips     map[string]trip            // trip_id -> trip
	stopTimes map[string][]stopTime      // trip_id -> stop_times (unsorted)
	calendar  map[string]calendarService // service_id -> calendar
}

type trip struct {
	routeID   string
	serviceID string
}

type stopTime struct {
	stopID             string
	sequence           int
	arrival, departure string // "HH:MM:SS"
}

type calendarService struct {
	weekday    [7]bool // Mon..Sun
	start, end time.Time
}

func (c *Client) fetch(url string) (*feed, error) {
	resp, err := c.httpClient.Get(url)
	if err != nil {
		return nil, fmt.Errorf("gtfs: fetch %s: %w", url, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("gtfs: fetch %s: unexpected status %d", url, resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("gtfs: read %s: %w", url, err)
	}

	zr, err := zip.NewReader(bytes.NewReader(body), int64(len(body)))
	if err != nil {
		return nil, fmt.Errorf("gtfs: unzip %s: %w", url, err)
	}

	f := &feed{
		stopNames: make(map[string]string),
		trips:     make(map[string]trip),
		stopTimes: make(map[string][]stopTime),
		calendar:  make(map[string]calendarService),
	}

	for _, name := range []string{"stops.txt", "trips.txt", "stop_times.txt", "calendar.txt"} {
		zf, err := zr.Open(name)
		if err != nil {
			return nil, fmt.Errorf("gtfs: %s missing from feed: %w", name, err)
		}
		err = readCSV(zf, func(row map[string]string) error {
			switch name {
			case "stops.txt":
				f.stopNames[row["stop_id"]] = row["stop_name"]
			case "trips.txt":
				f.trips[row["trip_id"]] = trip{routeID: row["route_id"], serviceID: row["service_id"]}
			case "stop_times.txt":
				seq := atoiSafe(row["stop_sequence"])
				tripID := row["trip_id"]
				f.stopTimes[tripID] = append(f.stopTimes[tripID], stopTime{
					stopID:    row["stop_id"],
					sequence:  seq,
					arrival:   row["arrival_time"],
					departure: row["departure_time"],
				})
			case "calendar.txt":
				start, errS := time.Parse("20060102", row["start_date"])
				end, errE := time.Parse("20060102", row["end_date"])
				if errS != nil || errE != nil {
					return nil // skip malformed row rather than aborting the whole feed
				}
				f.calendar[row["service_id"]] = calendarService{
					weekday: [7]bool{
						row["monday"] == "1",
						row["tuesday"] == "1",
						row["wednesday"] == "1",
						row["thursday"] == "1",
						row["friday"] == "1",
						row["saturday"] == "1",
						row["sunday"] == "1",
					},
					start: start,
					end:   end,
				}
			}
			return nil
		})
		zf.Close()
		if err != nil {
			return nil, fmt.Errorf("gtfs: parse %s: %w", name, err)
		}
	}

	return f, nil
}

func readCSV(r io.Reader, onRow func(row map[string]string) error) error {
	cr := csv.NewReader(r)
	header, err := cr.Read()
	if err != nil {
		return err
	}
	cols := header

	for {
		record, err := cr.Read()
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return err
		}
		row := make(map[string]string, len(cols))
		for i, col := range cols {
			if i < len(record) {
				row[col] = record[i]
			}
		}
		if err := onRow(row); err != nil {
			return err
		}
	}
}

func atoiSafe(s string) int {
	n := 0
	for _, c := range s {
		if c < '0' || c > '9' {
			return n
		}
		n = n*10 + int(c-'0')
	}
	return n
}
