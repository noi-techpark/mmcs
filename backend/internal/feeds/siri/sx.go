package siri

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/noi-techpark/open-mmc/backend/internal/model"
	"github.com/noi-techpark/open-mmc/backend/internal/netex"
	"github.com/noi-techpark/open-mmc/backend/internal/store"
)

// LangText is SIRI-lite's "translated string" shape: an array of these per
// field, one per language.
type LangText struct {
	Lang string `json:"@xml:lang"`
	Text string `json:"#text"`
}

type AffectedStopPoint struct {
	StopPointRef string `json:"StopPointRef"`
	PlaceName    string `json:"PlaceName"`
}

// ValidityPeriod is a single {StartTime,EndTime} span, except SIRI-lite
// encodes it as a bare object when a situation has one period and as an
// array when it has several (e.g. a recurring daily closure) — the same
// value can arrive as either JSON shape, so this unmarshals both.
type ValidityPeriod struct {
	StartTime string `json:"StartTime"`
	EndTime   string `json:"EndTime"`
}

type ValidityPeriods []ValidityPeriod

func (p *ValidityPeriods) UnmarshalJSON(data []byte) error {
	var arr []ValidityPeriod
	if err := json.Unmarshal(data, &arr); err == nil {
		*p = arr
		return nil
	}
	var single ValidityPeriod
	if err := json.Unmarshal(data, &single); err != nil {
		return err
	}
	*p = []ValidityPeriod{single}
	return nil
}

type PtSituationElement struct {
	CreationTime    string          `json:"CreationTime"`
	SituationNumber string          `json:"SituationNumber"`
	Progress        string          `json:"Progress"`
	ValidityPeriod  ValidityPeriods `json:"ValidityPeriod"`
	AlertCause      string          `json:"AlertCause"`
	ReasonName      []LangText      `json:"ReasonName"`
	Priority        string          `json:"Priority"`
	ScopeType       string          `json:"ScopeType"`
	Planned         string          `json:"Planned"`
	Affects         struct {
		StopPoints struct {
			AffectedStopPoint []AffectedStopPoint `json:"AffectedStopPoint"`
		} `json:"StopPoints"`
	} `json:"Affects"`
}

type sxEnvelope struct {
	ServiceDelivery struct {
		SituationExchangeDelivery struct {
			Situations struct {
				PtSituationElement []PtSituationElement `json:"PtSituationElement"`
			} `json:"Situations"`
		} `json:"SituationExchangeDelivery"`
	} `json:"ServiceDelivery"`
}

// FetchSX fetches the whole province's active service alerts/disruptions.
func (c *LiteClient) FetchSX() ([]PtSituationElement, error) {
	u := c.baseURL + "/siri-lite/situation-exchange"
	resp, err := c.httpClient.Get(u)
	if err != nil {
		return nil, fmt.Errorf("siri-lite: fetch %s: %w", u, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("siri-lite: fetch %s: unexpected status %d", u, resp.StatusCode)
	}

	var env sxEnvelope
	if err := json.NewDecoder(resp.Body).Decode(&env); err != nil {
		return nil, fmt.Errorf("siri-lite: decode %s: %w", u, err)
	}
	return env.ServiceDelivery.SituationExchangeDelivery.Situations.PtSituationElement, nil
}

// reasonText picks one language out of a ReasonName translation list,
// preferring English, falling back to whichever comes first.
func reasonText(reasons []LangText) string {
	for _, r := range reasons {
		if r.Lang == "EN" {
			return r.Text
		}
	}
	if len(reasons) > 0 {
		return reasons[0].Text
	}
	return ""
}

// NormalizeSX converts a situation into a Feature, placed at the first of
// its affected stops that resolves to a Quay coordinate. Situations with no
// stop-level Affects (line/network-scoped only) or whose stops don't
// resolve return ok=false — there's nowhere to put them on the map yet.
func NormalizeSX(layer model.Layer, sit PtSituationElement, ns *netex.Store) (model.Feature, bool) {
	stops := sit.Affects.StopPoints.AffectedStopPoint
	var coord netex.Stop
	var resolved bool
	stopNames := make([]string, 0, len(stops))
	for _, sp := range stops {
		stopNames = append(stopNames, sp.PlaceName)
		if !resolved {
			if q, ok := ns.Quay(sp.StopPointRef); ok {
				coord, resolved = q, true
			}
		}
	}
	if !resolved {
		return model.Feature{}, false
	}

	var validFrom, validTo string
	if len(sit.ValidityPeriod) > 0 {
		validFrom = sit.ValidityPeriod[0].StartTime
		validTo = sit.ValidityPeriod[len(sit.ValidityPeriod)-1].EndTime
	}

	f := model.NewFeature(
		"siri-sx:"+sit.SituationNumber,
		layer,
		model.Point(coord.Lon, coord.Lat),
		reasonText(sit.ReasonName),
		"siri-lite:sx",
		map[string]any{
			"reason":        reasonText(sit.ReasonName),
			"alertCause":    sit.AlertCause,
			"progress":      sit.Progress,
			"createdAt":     sit.CreationTime,
			"validFrom":     validFrom,
			"validTo":       validTo,
			"planned":       sit.Planned == "true",
			"affectedStops": stopNames,
		},
	)
	f.Properties.Status = model.StatusWarning
	// RecordedAt tracks freshness as "still reported by this poll", not
	// CreationTime — a long-running disruption's CreationTime can be days
	// old, which would make the store evict it as stale (see store.MaxAge)
	// even though it's still active right now.
	f.Properties.RecordedAt = time.Now().UTC()
	return f, true
}

// PollSX runs the SIRI-SX feed on a fixed interval, resolving each
// situation's map position against ns (NeTEx Quay coordinates) and
// upserting it into the store.
func PollSX(ctx context.Context, client *LiteClient, layer model.Layer, interval time.Duration, fs store.FeatureStore, ns *netex.Store) {
	tick := func() {
		situations, err := client.FetchSX()
		if err != nil {
			log.Printf("siri-lite[sx]: %v", err)
			return
		}
		n, skipped := 0, 0
		for _, sit := range situations {
			f, ok := NormalizeSX(layer, sit, ns)
			if !ok {
				skipped++
				continue
			}
			fs.Upsert(f)
			n++
		}
		log.Printf("siri-lite[sx]: upserted %d features, skipped %d (no resolvable stop)", n, skipped)
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
