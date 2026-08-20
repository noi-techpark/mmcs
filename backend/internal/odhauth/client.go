// Package odhauth provides an OAuth2 client-credentials HTTP client for
// authenticated Open Data Hub (NOI Techpark) APIs — distinct from
// backend/internal/feeds/odh, which only talks to ODH's public,
// unauthenticated "flat" endpoints. Not consumed by any feed yet; this is
// prep work for future integrations that need it.
package odhauth

import (
	"context"
	"fmt"
	"net/http"
	"os"

	"golang.org/x/oauth2/clientcredentials"
)

// NewClient builds an *http.Client that automatically attaches (and
// refreshes) a Bearer token via the OAuth2 client-credentials grant, from
// ODH_CLIENT_ID, ODH_CLIENT_SECRET, and ODH_TOKEN_URL. Returns an error if
// any of the three env vars are unset — the caller decides whether that's
// fatal (see main.go, which treats it as "authenticated ODH features are
// unavailable" rather than refusing to start).
func NewClient(ctx context.Context) (*http.Client, error) {
	clientID := os.Getenv("ODH_CLIENT_ID")
	clientSecret := os.Getenv("ODH_CLIENT_SECRET")
	tokenURL := os.Getenv("ODH_TOKEN_URL")
	if clientID == "" || clientSecret == "" || tokenURL == "" {
		return nil, fmt.Errorf("odhauth: ODH_CLIENT_ID, ODH_CLIENT_SECRET, and ODH_TOKEN_URL must all be set")
	}

	cfg := clientcredentials.Config{
		ClientID:     clientID,
		ClientSecret: clientSecret,
		TokenURL:     tokenURL,
	}
	return cfg.Client(ctx), nil
}
