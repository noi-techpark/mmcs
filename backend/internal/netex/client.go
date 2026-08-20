package netex

import (
	"archive/zip"
	"bytes"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/jlaffaye/ftp"
)

const ftpHost = "ftp.sta.bz.it:21"

// urlPath builds the dated FTP path for a given day, e.g.
// "/netex/2026/plan/EU_profil/NX-PI_01_it_apb_LINE_apb__20260819.xml.zip".
func urlPath(day time.Time) string {
	return fmt.Sprintf("/netex/%d/plan/EU_profil/NX-PI_01_it_apb_LINE_apb__%s.xml.zip", day.Year(), day.Format("20060102"))
}

// netexPublishLag is how far behind "today" this export is normally
// published — the source doesn't produce a file every single day, so
// starting the search at today (or even yesterday) routinely 404s before
// falling back. Starting 2 days back avoids that near-guaranteed miss.
const netexPublishLag = 2

// FetchLatest downloads the most recent available day's export, starting
// netexPublishLag days back and falling back further if that day's file
// isn't published either, and returns the parsed lines keyed by (colon-
// trimmed) line id.
func FetchLatest(now time.Time) (Data, time.Time, error) {
	conn, err := ftp.Dial(ftpHost, ftp.DialWithTimeout(30*time.Second))
	if err != nil {
		return Data{}, time.Time{}, fmt.Errorf("netex: dial: %w", err)
	}
	defer conn.Quit()

	if err := conn.Login("anonymous", "anonymous@"); err != nil {
		return Data{}, time.Time{}, fmt.Errorf("netex: login: %w", err)
	}

	var lastErr error
	for i := netexPublishLag; i < netexPublishLag+3; i++ {
		day := now.AddDate(0, 0, -i)
		path := urlPath(day)
		resp, err := conn.Retr(path)
		if err != nil {
			lastErr = fmt.Errorf("netex: retr %s: %w", path, err)
			continue
		}
		data, err := io.ReadAll(resp)
		resp.Close()
		if err != nil {
			lastErr = fmt.Errorf("netex: read %s: %w", path, err)
			continue
		}

		d, err := parseZipBytes(data, now)
		if err != nil {
			lastErr = fmt.Errorf("netex: parse %s: %w", path, err)
			continue
		}
		return d, day, nil
	}
	return Data{}, time.Time{}, lastErr
}

func parseZipBytes(data []byte, now time.Time) (Data, error) {
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return Data{}, fmt.Errorf("unzip: %w", err)
	}
	var xmlFile *zip.File
	for _, f := range zr.File {
		if strings.HasSuffix(strings.ToLower(f.Name), ".xml") {
			xmlFile = f
			break
		}
	}
	if xmlFile == nil {
		return Data{}, fmt.Errorf("no .xml entry in zip")
	}
	rc, err := xmlFile.Open()
	if err != nil {
		return Data{}, fmt.Errorf("open xml entry: %w", err)
	}
	defer rc.Close()

	// Streams directly from the (still-compressed-on-disk-sized) zip
	// entry's decompressing reader — the ~800MB uncompressed XML is never
	// buffered whole, only the handful of element types Parse retains.
	return Parse(rc, now)
}
