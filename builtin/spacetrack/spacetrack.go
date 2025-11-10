package spacetrack

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/akhenakh/sgp4"
	"github.com/projectqai/hydra/builtin"
	"github.com/projectqai/hydra/builtin/controller"
	pb "github.com/projectqai/proto/go"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type TrackerConfig struct {
	TLESource         string  `json:"tle"`
	EntityID          string  `json:"id"`
	Label             string  `json:"label"`
	Symbol            string  `json:"symbol"`
	IntervalSeconds   float64 `json:"interval"`
	TLERefreshSeconds int     `json:"tle_refresh_seconds"`
	Username          string  `json:"username"`
	Password          string  `json:"password"`
}

type SatellitePosition struct {
	Latitude  float64
	Longitude float64
	Altitude  float64
}

func isURL(source string) bool {
	return len(source) > 4 && (source[:4] == "http" || (len(source) > 3 && source[:3] == "ftp"))
}

func parseInlineTLE(data string) (*sgp4.TLE, error) {
	tle, err := sgp4.ParseTLE(data)
	if err != nil {
		return nil, fmt.Errorf("failed to parse inline TLE: %w", err)
	}
	return tle, nil
}

func fetchMultipleTLEs(ctx context.Context, url, username, password string) ([]*sgp4.TLE, error) {
	client := &http.Client{Timeout: 30 * time.Second}

	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	if username != "" && password != "" {
		req.SetBasicAuth(username, password)
	}

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch TLEs: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("TLE fetch returned status %d: %s", resp.StatusCode, string(body))
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read TLE response: %w", err)
	}

	allLines := strings.Split(strings.TrimSpace(string(body)), "\n")
	for i := range allLines {
		allLines[i] = strings.TrimSpace(allLines[i])
	}

	var tles []*sgp4.TLE
	for i := 0; i+2 < len(allLines); {
		if allLines[i] == "" {
			i++
			continue
		}

		if i+2 < len(allLines) && len(allLines[i+1]) > 0 && allLines[i+1][0] == '1' && len(allLines[i+2]) > 0 && allLines[i+2][0] == '2' {
			tleData := allLines[i] + "\n" + allLines[i+1] + "\n" + allLines[i+2]
			tle, err := sgp4.ParseTLE(tleData)
			if err != nil {
				i++
				continue
			}
			tles = append(tles, tle)
			i += 3
		} else {
			i++
		}
	}

	if len(tles) == 0 {
		return nil, fmt.Errorf("no valid TLEs found in response")
	}

	return tles, nil
}

func calculatePosition(tle *sgp4.TLE, t time.Time) (*SatellitePosition, error) {
	eciState, err := tle.FindPositionAtTime(t)
	if err != nil {
		return nil, fmt.Errorf("failed to propagate satellite: %w", err)
	}

	lat, lon, alt := eciState.ToGeodetic()

	return &SatellitePosition{
		Latitude:  lat,
		Longitude: lon,
		Altitude:  alt * 1000,
	}, nil
}

func Run(ctx context.Context, logger *slog.Logger, _ string) error {
	controllerName := "spacetrack"

	return controller.Run1to1(ctx, &pb.EntityFilter{
		Component: []uint32{31},
		Config: &pb.ConfigurationFilter{
			Controller: &controllerName,
		},
	}, func(ctx context.Context, entity *pb.Entity) error {
		return runTracker(ctx, logger, entity)
	})
}

func runTracker(ctx context.Context, logger *slog.Logger, entity *pb.Entity) error {
	config := entity.Config
	if config.Key != "spacetrack.orbit.v0" {
		return fmt.Errorf("unknown config key: %s", config.Key)
	}

	trackerConfig, err := parseTrackerConfig(config)
	if err != nil {
		return fmt.Errorf("parse config: %w", err)
	}

	logger.Info("Starting tracker",
		"configEntityID", entity.Id,
		"interval", trackerConfig.IntervalSeconds,
		"tleRefresh", trackerConfig.TLERefreshSeconds,
		"tle", trackerConfig.TLESource)

	grpcConn, err := builtin.BuiltinClientConn()
	if err != nil {
		return fmt.Errorf("gRPC connection: %w", err)
	}
	defer grpcConn.Close()

	worldClient := pb.NewWorldServiceClient(grpcConn)
	ticker := time.NewTicker(time.Duration(trackerConfig.IntervalSeconds * float64(time.Second)))
	defer ticker.Stop()

	isURLSource := isURL(trackerConfig.TLESource)
	var tles []*sgp4.TLE
	tleTicker := time.NewTicker(time.Duration(trackerConfig.TLERefreshSeconds) * time.Second)
	defer tleTicker.Stop()

	fetchCtx, fetchCancel := context.WithTimeout(ctx, 30*time.Second)
	if isURLSource {
		tles, err = fetchMultipleTLEs(fetchCtx, trackerConfig.TLESource, trackerConfig.Username, trackerConfig.Password)
	} else {
		var tle *sgp4.TLE
		tle, err = parseInlineTLE(trackerConfig.TLESource)
		if err == nil {
			tles = []*sgp4.TLE{tle}
		}
	}
	fetchCancel()

	if err != nil {
		return fmt.Errorf("load initial TLE: %w", err)
	}

	logger.Info("Loaded TLEs", "configEntityID", entity.Id, "count", len(tles))

	// Push initial position updates
	pushPositionUpdates(ctx, logger, worldClient, tles, entity.Id, trackerConfig)

	for {
		select {
		case <-ctx.Done():
			logger.Info("Tracker shutting down", "configEntityID", entity.Id)
			return ctx.Err()

		case <-ticker.C:
			pushPositionUpdates(ctx, logger, worldClient, tles, entity.Id, trackerConfig)

		case <-tleTicker.C:
			if isURLSource {
				fetchCtx, fetchCancel := context.WithTimeout(ctx, 30*time.Second)
				newTLEs, err := fetchMultipleTLEs(fetchCtx, trackerConfig.TLESource, trackerConfig.Username, trackerConfig.Password)
				fetchCancel()
				if err != nil {
					logger.Error("Failed to refresh TLEs", "configEntityID", entity.Id, "error", err)
				} else {
					tles = newTLEs
					logger.Info("Refreshed TLEs", "configEntityID", entity.Id, "count", len(tles))
				}
			}
		}
	}
}

func pushPositionUpdates(ctx context.Context, logger *slog.Logger, worldClient pb.WorldServiceClient, tles []*sgp4.TLE, configEntityID string, config *TrackerConfig) {
	for _, tle := range tles {
		// Check for cancellation before processing each TLE
		select {
		case <-ctx.Done():
			return
		default:
		}

		position, err := calculatePosition(tle, time.Now())
		if err != nil {
			logger.Error("Failed to calculate position", "configEntityID", configEntityID, "satellite", tle.Name, "error", err)
			continue
		}

		entityID, label := generateIDAndLabel(configEntityID, config, tle, len(tles))
		entity := positionToEntity(position, entityID, label, config.Symbol, time.Duration(config.IntervalSeconds*float64(time.Second)), configEntityID)

		if entity == nil {
			logger.Error("Failed to convert position to entity", "configEntityID", configEntityID, "satellite", tle.Name)
			continue
		}

		pushCtx, pushCancel := context.WithTimeout(ctx, 2*time.Second)
		_, err = worldClient.Push(pushCtx, &pb.EntityChangeRequest{
			Changes: []*pb.Entity{entity},
		})
		pushCancel()

		if err != nil {
			logger.Error("Failed to push entity", "configEntityID", configEntityID, "satellite", tle.Name, "error", err)
		}
	}
}

func generateIDAndLabel(configEntityID string, config *TrackerConfig, tle *sgp4.TLE, tleCount int) (string, string) {
	var entityID, label string

	if tleCount == 1 && config.EntityID != "" {
		entityID = config.EntityID
	} else {
		trackName := tle.Name
		if trackName == "" {
			trackName = "track"
		}
		baseID := config.EntityID
		if baseID == "" {
			baseID = configEntityID
		}
		entityID = fmt.Sprintf("%s-%s", baseID, trackName)
	}

	switch {
	case tleCount == 1 && config.Label != "":
		label = config.Label
	case tleCount > 1 && config.Label != "":
		if tle.Name != "" {
			label = fmt.Sprintf("%s - %s", config.Label, tle.Name)
		} else {
			label = fmt.Sprintf("%s - track", config.Label)
		}
	case tle.Name != "":
		label = tle.Name
	default:
		baseID := config.EntityID
		if baseID == "" {
			baseID = configEntityID
		}
		label = fmt.Sprintf("%s track", baseID)
	}

	return entityID, label
}

func positionToEntity(position *SatellitePosition, entityID, label, symbol string, expires time.Duration, controllerID string) *pb.Entity {
	entity := &pb.Entity{
		Id:    entityID,
		Label: &label,
		Lifetime: &pb.Lifetime{
			From:  timestamppb.Now(),
			Until: timestamppb.New(time.Now().Add(expires * 2)),
		},
		Geo: &pb.GeoSpatialComponent{
			Latitude:  position.Latitude,
			Longitude: position.Longitude,
			Altitude:  &position.Altitude,
		},
		Symbol: &pb.SymbolComponent{
			MilStd2525C: symbol,
		},
		Controller: &pb.ControllerRef{
			Id:   controllerID,
			Name: "spacetrack",
		},
		Track: &pb.TrackComponent{},
	}

	return entity
}

func parseTrackerConfig(config *pb.ConfigurationComponent) (*TrackerConfig, error) {
	trackerConfig := &TrackerConfig{
		TLESource:         "",
		EntityID:          "",
		Label:             "",
		Symbol:            "SNPPS-----*****",
		IntervalSeconds:   1.0,
		TLERefreshSeconds: 3600,
	}

	if config.Value == nil || config.Value.Fields == nil {
		return nil, fmt.Errorf("tle field is required")
	}

	fields := config.Value.Fields
	if v, ok := fields["tle"]; ok {
		trackerConfig.TLESource = v.GetStringValue()
	}
	if trackerConfig.TLESource == "" {
		return nil, fmt.Errorf("tle field is required")
	}

	if v, ok := fields["id"]; ok {
		trackerConfig.EntityID = v.GetStringValue()
	}
	if v, ok := fields["label"]; ok {
		trackerConfig.Label = v.GetStringValue()
	}
	if v, ok := fields["symbol"]; ok {
		if symbol := v.GetStringValue(); symbol != "" {
			trackerConfig.Symbol = symbol
		}
	}
	if v, ok := fields["interval"]; ok {
		if interval := v.GetNumberValue(); interval > 0 {
			trackerConfig.IntervalSeconds = interval
		}
	}
	if v, ok := fields["tle_refresh_seconds"]; ok {
		if refresh := int(v.GetNumberValue()); refresh > 0 {
			trackerConfig.TLERefreshSeconds = refresh
		}
	}
	if v, ok := fields["username"]; ok {
		trackerConfig.Username = v.GetStringValue()
	}
	if v, ok := fields["password"]; ok {
		trackerConfig.Password = v.GetStringValue()
	}

	return trackerConfig, nil
}

func init() {
	builtin.Register("spacetrack", Run)
}
