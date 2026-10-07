// SPDX-FileCopyrightText: 2026 NOI Techpark
//
// SPDX-License-Identifier: AGPL-3.0-or-later

package tourism

import (
	"fmt"
	"strings"
	"time"

	"github.com/noi-techpark/open-mmc/backend/internal/model"
)

// langPriority mirrors siri.pickLang's EN-first preference, extended with
// IT/DE since Announcement wording is usually only available in those two
// (see backend/internal/feeds/siri/sx.go pickLang).
var langPriority = []string{"en", "it", "de"}

const mountainPassTag = "traffic-event:mountain-pass"

// mountainPassAllClearText is every boilerplate "no restriction" wording
// observed on mountain-pass road-condition updates, normalized (lowercased,
// trailing "."/whitespace trimmed). These stations get re-published year-
// round with the current condition even when there's nothing to report, so
// without this filter the layer would be dominated by a constant stream of
// "nothing happening here" pins — sampled live from
// tourism.api.opendatahub.com/v1/Announcement (source=PROVINCE_BZ,
// tagfilter=traffic-event:mountain-pass): "Nessuna limitazione." (IT) was
// the single most common BaseText value across all 80 mountain-pass items
// at the time, "Keine Beschränkungen." (DE) is its exact pair.
var mountainPassAllClearText = map[string]bool{
	"nessuna limitazione":  true,
	"keine beschränkungen": true,
}

func normalizeForBlacklist(s string) string {
	return strings.ToLower(strings.TrimRight(strings.TrimSpace(s), ". "))
}

// isMountainPassAllClear reports whether a is a mountain-pass update whose
// text is just the "nothing to report" boilerplate (see
// mountainPassAllClearText) — checked against every language variant, not
// just the one Normalize ends up picking, since which language is present
// varies per item but the boilerplate pairs (IT/DE) are always published
// together.
func isMountainPassAllClear(a Announcement) bool {
	hasTag := false
	for _, t := range a.TagIds {
		if t == mountainPassTag {
			hasTag = true
			break
		}
	}
	if !hasTag {
		return false
	}
	for _, d := range a.Detail {
		if !mountainPassAllClearText[normalizeForBlacklist(d.BaseText)] {
			return false
		}
	}
	return len(a.Detail) > 0
}

func pickDetail(detail map[string]LangDetail) LangDetail {
	for _, lang := range langPriority {
		if d, ok := detail[lang]; ok {
			return d
		}
	}
	for _, d := range detail {
		return d
	}
	return LangDetail{}
}

// Normalize converts an Announcement into a Feature, placed at its
// Geo.position coordinate. Announcements with no position (track-only
// geometry, e.g. a trail closure polyline with no point fallback) return
// ok=false — there's nowhere to put them on the map yet.
func Normalize(layer model.Layer, a Announcement) (model.Feature, bool) {
	if a.Geo.Position == nil {
		return model.Feature{}, false
	}
	if isMountainPassAllClear(a) {
		return model.Feature{}, false
	}

	detail := pickDetail(a.Detail)
	name := detail.Title
	if name == "" {
		name = a.Shortname
	}

	endTime := ""
	if a.EndTime != nil {
		endTime = *a.EndTime
	}

	f := model.NewFeature(
		fmt.Sprintf("tourism:announcement:%s", a.Id),
		layer,
		model.Point(a.Geo.Position.Longitude, a.Geo.Position.Latitude),
		name,
		"tourism:"+a.Source,
		map[string]any{
			"description": detail.BaseText,
			"source":      a.Source,
			"tags":        a.TagIds,
			"startTime":   a.StartTime,
			"endTime":     endTime,
		},
	)
	f.Properties.Status = model.StatusWarning
	// RecordedAt tracks freshness as "still reported by this poll", not the
	// announcement's own LastChange — a long-running closure's LastChange
	// can be months old while it's still active right now (FetchActive
	// already filters to begin<=now<=end), which would otherwise make the
	// store evict it as stale on arrival (mirrors siri.NormalizeSX).
	f.Properties.RecordedAt = time.Now().UTC()
	return f, true
}
