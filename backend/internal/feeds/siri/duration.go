package siri

import (
	"regexp"
	"strconv"
)

var isoDurationRe = regexp.MustCompile(`^(-)?PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$`)

// ParseISODurationSeconds parses a subset of ISO8601 durations (as used by
// SIRI's Delay field, e.g. "-PT1M", "PT0S", "PT1H2M3S") into seconds.
func ParseISODurationSeconds(s string) (int, bool) {
	m := isoDurationRe.FindStringSubmatch(s)
	if m == nil {
		return 0, false
	}
	hours, _ := strconv.Atoi(m[2])
	minutes, _ := strconv.Atoi(m[3])
	seconds, _ := strconv.Atoi(m[4])
	total := hours*3600 + minutes*60 + seconds
	if m[1] == "-" {
		total = -total
	}
	return total, true
}
