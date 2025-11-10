package spacetrack

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/akhenakh/sgp4"
	"github.com/projectqai/hydra/builtin"
	"github.com/projectqai/hydra/goclient"
	pb "github.com/projectqai/proto/go"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type TrackerInstance struct {
	configEntityID string
	config         *TrackerConfig
	cancel         context.CancelFunc
}

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

type Controller struct {
	serverURL string
	logger    *slog.Logger

	mu       sync.Mutex
	trackers map[string]*TrackerInstance
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

func NewController(serverURL string, logger *slog.Logger) *Controller {
	return &Controller{
		serverURL: serverURL,
		logger:    logger,
		trackers:  make(map[string]*TrackerInstance),
	}
}

func (c *Controller) Run(ctx context.Context) error {
	grpcConn, err := grpc.NewClient(c.serverURL, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return err
	}
	defer grpcConn.Close()

	client := pb.NewWorldServiceClient(grpcConn)

	controller := "spacetrack"
	stream, err := goclient.WatchEntitiesWithRetry(ctx, client, &pb.ListEntitiesRequest{
		Filter: &pb.EntityFilter{
			Component: []uint32{31},
			Config: &pb.ConfigurationFilter{
				Controller: &controller,
			},
		},
	})
	if err != nil {
		return err
	}

	for {
		event, err := stream.Recv()
		if err != nil {
			return err
		}

		if event.Entity == nil || event.Entity.Config == nil {
			continue
		}

		entity := event.Entity
		config := entity.Config

		c.logger.Info("Configuration event", "type", event.T, "entityID", entity.Id, "key", config.Key)

		switch event.T {
		case pb.EntityChange_EntityChangeUpdated:
			if config.Key == "spacetrack.orbit.v0" {
				c.handleConfigUpdate(ctx, entity, config)
			} else {
				c.logger.Warn("Unknown configuration key", "key", config.Key)
			}

		case pb.EntityChange_EntityChangeUnobserved, pb.EntityChange_EntityChangeExpired:
			c.handleConfigRemoval(entity.Id)
		}
	}
}

func (c *Controller) handleConfigUpdate(ctx context.Context, entity *pb.Entity, config *pb.ConfigurationComponent) {
	trackerConfig, err := parseTrackerConfig(config)
	if err != nil {
		c.logger.Error("Failed to parse tracker config", "configEntityID", entity.Id, "error", err)
		return
	}

	c.mu.Lock()
	defer c.mu.Unlock()

	// Stop all old trackers with this configEntityID
	for trackerID, tracker := range c.trackers {
		if tracker.configEntityID == entity.Id {
			c.logger.Info("Stopping existing tracker", "trackerID", trackerID)
			tracker.cancel()
			delete(c.trackers, trackerID)
		}
	}

	// Start new tracker
	instanceCtx, cancel := context.WithCancel(ctx)
	if entity.Lifetime != nil && entity.Lifetime.Until != nil {
		instanceCtx, cancel = context.WithDeadline(ctx, entity.Lifetime.Until.AsTime())
		c.logger.Info("Tracker configured with expiry", "configEntityID", entity.Id, "expiresAt", entity.Lifetime.Until.AsTime())
	}

	go func() {
		defer cancel()
		c.runTracker(instanceCtx, entity.Id, trackerConfig, cancel)
	}()
}

func (c *Controller) handleConfigRemoval(configEntityID string) {
	c.mu.Lock()
	defer c.mu.Unlock()

	for trackerID, instance := range c.trackers {
		if instance.configEntityID == configEntityID {
			c.logger.Info("Stopping tracker (config entity expired)", "trackerID", trackerID)
			instance.cancel()
			delete(c.trackers, trackerID)
		}
	}
}

func (c *Controller) pushPositionUpdates(ctx context.Context, worldClient pb.WorldServiceClient, tles []*sgp4.TLE, configEntityID string, config *TrackerConfig) {
	for _, tle := range tles {
		// Check for cancellation before processing each TLE
		select {
		case <-ctx.Done():
			return
		default:
		}

		position, err := calculatePosition(tle, time.Now())
		if err != nil {
			c.logger.Error("Failed to calculate position", "configEntityID", configEntityID, "satellite", tle.Name, "error", err)
			continue
		}

		entityID, label := generateIDAndLabel(configEntityID, config, tle, len(tles))
		entity := positionToEntity(position, entityID, label, config.Symbol, time.Duration(config.IntervalSeconds*float64(time.Second)), configEntityID)

		if entity == nil {
			c.logger.Error("Failed to convert position to entity", "configEntityID", configEntityID, "satellite", tle.Name)
			continue
		}

		pushCtx, pushCancel := context.WithTimeout(ctx, 2*time.Second)
		_, err = worldClient.Push(pushCtx, &pb.EntityChangeRequest{
			Changes: []*pb.Entity{entity},
		})
		pushCancel()

		if err != nil {
			c.logger.Error("Failed to push entity", "configEntityID", configEntityID, "satellite", tle.Name, "error", err)
		}
	}
}

func (c *Controller) runTracker(ctx context.Context, configEntityID string, config *TrackerConfig, cancel context.CancelFunc) {
	c.logger.Info("Starting tracker",
		"configEntityID", configEntityID,
		"interval", config.IntervalSeconds,
		"tleRefresh", config.TLERefreshSeconds,
		"tle", config.TLESource)

	grpcConn, err := grpc.NewClient(c.serverURL, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		c.logger.Error("Failed to create gRPC connection", "configEntityID", configEntityID, "error", err)
		return
	}
	defer grpcConn.Close()

	worldClient := pb.NewWorldServiceClient(grpcConn)
	ticker := time.NewTicker(time.Duration(config.IntervalSeconds * float64(time.Second)))
	defer ticker.Stop()

	isURLSource := isURL(config.TLESource)
	var tles []*sgp4.TLE
	tleTicker := time.NewTicker(time.Duration(config.TLERefreshSeconds) * time.Second)
	defer tleTicker.Stop()

	fetchCtx, fetchCancel := context.WithTimeout(ctx, 30*time.Second)
	if isURLSource {
		tles, err = fetchMultipleTLEs(fetchCtx, config.TLESource, config.Username, config.Password)
	} else {
		var tle *sgp4.TLE
		tle, err = parseInlineTLE(config.TLESource)
		if err == nil {
			tles = []*sgp4.TLE{tle}
		}
	}
	fetchCancel()

	if err != nil {
		c.logger.Error("Failed to load initial TLE", "configEntityID", configEntityID, "error", err)
		return
	}

	c.logger.Info("Loaded TLEs", "configEntityID", configEntityID, "count", len(tles))

	c.mu.Lock()
	for _, tle := range tles {
		entityID, label := generateIDAndLabel(configEntityID, config, tle, len(tles))
		trackerID := fmt.Sprintf("%s-%s", configEntityID, entityID)

		instance := &TrackerInstance{
			configEntityID: configEntityID,
			config:         config,
			cancel:         cancel,
		}
		c.trackers[trackerID] = instance
		c.logger.Info("Registered tracker", "trackerID", trackerID, "entityID", entityID, "label", label)
	}
	c.mu.Unlock()

	// Push initial position updates
	c.pushPositionUpdates(ctx, worldClient, tles, configEntityID, config)

	for {
		select {
		case <-ctx.Done():
			c.logger.Info("Tracker shutting down", "configEntityID", configEntityID)
			return

		case <-ticker.C:
			c.pushPositionUpdates(ctx, worldClient, tles, configEntityID, config)

		case <-tleTicker.C:
			if isURLSource {
				fetchCtx, fetchCancel := context.WithTimeout(ctx, 30*time.Second)
				newTLEs, err := fetchMultipleTLEs(fetchCtx, config.TLESource, config.Username, config.Password)
				fetchCancel()
				if err != nil {
					c.logger.Error("Failed to refresh TLEs", "configEntityID", configEntityID, "error", err)
				} else {
					tles = newTLEs
					c.logger.Info("Refreshed TLEs", "configEntityID", configEntityID, "count", len(tles))
				}
			}
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

func Run(ctx context.Context, logger *slog.Logger, serverURL string) error {
	controller := NewController(serverURL, logger)
	return controller.Run(ctx)
}

func init() {
	builtin.Register("spacetrack", Run)
}
