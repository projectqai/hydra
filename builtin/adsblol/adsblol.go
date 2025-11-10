package adsblol

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	pb "github.com/projectqai/proto/go"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type ADSBAircraft struct {
	Hex          string       `json:"hex"`
	Callsign     string       `json:"flight"`
	Registration string       `json:"r"`
	Type         string       `json:"t"`
	Lat          *float64     `json:"lat"`
	Lon          *float64     `json:"lon"`
	AltBaro      *FlexibleInt `json:"alt_baro"`
	AltGeom      *FlexibleInt `json:"alt_geom"`
	Track        *float64     `json:"track"`
	GroundSpeed  *float64     `json:"gs"`
	Category     string       `json:"category"`
	Emergency    string       `json:"emergency"`
	Squawk       string       `json:"squawk"`
	Seen         *float64     `json:"seen"`
	SeenPos      *float64     `json:"seen_pos"`
}

type FlexibleInt struct {
	Value int
	Valid bool
}

func (f *FlexibleInt) UnmarshalJSON(data []byte) error {
	var i int
	if err := json.Unmarshal(data, &i); err == nil {
		f.Value = i
		f.Valid = true
		return nil
	}

	var s string
	if err := json.Unmarshal(data, &s); err == nil {
		f.Valid = false
		return nil
	}

	return fmt.Errorf("altitude must be int or string")
}

type ADSBResponse struct {
	AC      []ADSBAircraft `json:"ac"`
	Now     float64        `json:"now"`
	Total   int            `json:"total"`
	Message string         `json:"msg"`
}

type ADSBClient struct {
	httpClient *http.Client
}

func NewADSBClient() *ADSBClient {
	return &ADSBClient{
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

func (c *ADSBClient) FetchByLocation(ctx context.Context, lat, lon float64, radiusNM int) ([]ADSBAircraft, error) {
	url := fmt.Sprintf("https://api.adsb.lol/v2/lat/%.6f/lon/%.6f/dist/%d", lat, lon, radiusNM)
	return c.fetchAircraft(ctx, url)
}

func (c *ADSBClient) FetchByCallsign(ctx context.Context, callsign string) ([]ADSBAircraft, error) {
	url := fmt.Sprintf("https://api.adsb.lol/v2/callsign/%s", callsign)
	return c.fetchAircraft(ctx, url)
}

func (c *ADSBClient) FetchByICAO(ctx context.Context, icao string) ([]ADSBAircraft, error) {
	url := fmt.Sprintf("https://api.adsb.lol/v2/icao/%s", icao)
	return c.fetchAircraft(ctx, url)
}

func (c *ADSBClient) FetchMilitary(ctx context.Context) ([]ADSBAircraft, error) {
	url := "https://api.adsb.lol/v2/mil"
	return c.fetchAircraft(ctx, url)
}

func (c *ADSBClient) fetchAircraft(ctx context.Context, url string) ([]ADSBAircraft, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch data: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("API returned status %d: %s", resp.StatusCode, string(body))
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response: %w", err)
	}

	var adsbResp ADSBResponse
	if err := json.Unmarshal(body, &adsbResp); err != nil {
		return nil, fmt.Errorf("failed to parse response: %w", err)
	}

	return adsbResp.AC, nil
}

func ADSBAircraftToEntity(aircraft ADSBAircraft, controllerID string, expires time.Duration) *pb.Entity {
	if aircraft.Lat == nil || aircraft.Lon == nil {
		return nil
	}

	entityID := fmt.Sprintf("adsblol-%s", aircraft.Hex)

	label := strings.TrimSpace(aircraft.Callsign)
	if label == "" {
		label = strings.TrimSpace(aircraft.Registration)
	}
	if label == "" {
		label = aircraft.Hex
	}

	altitude := 0.0
	if aircraft.AltBaro != nil && aircraft.AltBaro.Valid {
		altitude = float64(aircraft.AltBaro.Value) * 0.3048
	} else if aircraft.AltGeom != nil && aircraft.AltGeom.Valid {
		altitude = float64(aircraft.AltGeom.Value) * 0.3048
	}

	sidc := aircraftToSIDC(aircraft)

	entity := &pb.Entity{
		Id:    entityID,
		Label: &label,
		Lifetime: &pb.Lifetime{
			From:  timestamppb.Now(),
			Until: timestamppb.New(time.Now().Add(expires * 2 * time.Second)),
		},
		Geo: &pb.GeoSpatialComponent{
			Latitude:  *aircraft.Lat,
			Longitude: *aircraft.Lon,
			Altitude:  &altitude,
		},
		Symbol: &pb.SymbolComponent{
			MilStd2525C: sidc,
		},
		Controller: &pb.ControllerRef{
			Id:   controllerID,
			Name: "adsblol",
		},
		Track: &pb.TrackComponent{},
	}

	if aircraft.Track != nil {
		entity.Bearing = &pb.BearingComponent{
			Azimuth: aircraft.Track,
		}
	}

	return entity
}

func aircraftToSIDC(aircraft ADSBAircraft) string {
	affiliation := "F"

	if aircraft.Squawk != "" {
		switch aircraft.Squawk {
		case "7500", "7700":
			affiliation = "H"
		case "7600":
			affiliation = "N"
		}
	}

	dimension := "A"
	status := "P"
	functionID := "MF"

	if aircraft.Type != "" {
		t := aircraft.Type
		if len(t) > 0 && (t[0] == 'H' || containsAny(t, "60", "47", "53")) {
			functionID = "MH"
		} else if containsAny(t, "737", "320", "380", "777", "787") {
			functionID = "CF"
		} else if containsAny(t, "C130", "C17", "KC", "B1", "B2", "B52", "F15", "F16", "F18", "F22", "F35") {
			affiliation = "F"
			functionID = "MF"
		}
	}

	sidc := fmt.Sprintf("S%s%s%s%s--------*", affiliation, dimension, status, functionID)

	if len(sidc) > 15 {
		sidc = sidc[:15]
	}

	return sidc
}

func containsAny(s string, substrs ...string) bool {
	for _, substr := range substrs {
		if contains(s, substr) {
			return true
		}
	}
	return false
}

func contains(s, substr string) bool {
	return len(s) >= len(substr) && indexOf(s, substr) >= 0
}

func indexOf(s, substr string) int {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return i
		}
	}
	return -1
}
