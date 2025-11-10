package adsblol

import (
	"context"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/projectqai/hydra/builtin"
	"github.com/projectqai/hydra/goclient"
	pb "github.com/projectqai/proto/go"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
)

type Controller struct {
	serverURL string
	logger    *slog.Logger
	mu        sync.Mutex
	pollers   map[string]*PollerInstance
}

type PollerInstance struct {
	entityID string
	config   *PollerConfig
	cancel   context.CancelFunc
	ctx      context.Context
}

type PollerConfig struct {
	ConfigKey       string
	Latitude        float64
	Longitude       float64
	RadiusNM        int
	Callsign        string
	ICAO            string
	IntervalSeconds int
}

func NewController(serverURL string, logger *slog.Logger) *Controller {
	return &Controller{
		serverURL: serverURL,
		logger:    logger,
		pollers:   make(map[string]*PollerInstance),
	}
}

func (c *Controller) Run(ctx context.Context) error {
	grpcConn, err := grpc.NewClient(c.serverURL, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return err
	}
	defer grpcConn.Close()

	client := pb.NewWorldServiceClient(grpcConn)

	stream, err := goclient.WatchEntitiesWithRetry(ctx, client, &pb.ListEntitiesRequest{
		Filter: &pb.EntityFilter{
			Component: []uint32{31},
			Config: &pb.ConfigurationFilter{
				Controller: stringPtr("adsblol"),
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
			c.handleConfigUpdate(ctx, entity, config)

		case pb.EntityChange_EntityChangeUnobserved, pb.EntityChange_EntityChangeExpired:
			c.handleConfigRemoval(entity.Id)
		}
	}
}

func (c *Controller) handleConfigUpdate(ctx context.Context, entity *pb.Entity, config *pb.ConfigurationComponent) {
	c.mu.Lock()
	defer c.mu.Unlock()

	if existing, exists := c.pollers[entity.Id]; exists {
		c.logger.Info("Stopping existing poller", "entityID", entity.Id)
		existing.cancel()
	}

	pollerConfig, err := parsePollerConfig(config)
	if err != nil {
		c.logger.Error("Failed to parse poller config", "entityID", entity.Id, "error", err)
		return
	}

	if pollerConfig.IntervalSeconds <= 0 {
		pollerConfig.IntervalSeconds = 5
	}

	instanceCtx, cancel := context.WithCancel(ctx)
	if entity.Lifetime != nil && entity.Lifetime.Until != nil {
		instanceCtx, cancel = context.WithDeadline(ctx, entity.Lifetime.Until.AsTime())
		c.logger.Info("Poller configured with expiry", "entityID", entity.Id, "expiresAt", entity.Lifetime.Until.AsTime())
	}

	instance := &PollerInstance{
		entityID: entity.Id,
		config:   pollerConfig,
		cancel:   cancel,
		ctx:      instanceCtx,
	}

	c.pollers[entity.Id] = instance

	go func() {
		defer cancel()
		defer func() {
			c.mu.Lock()
			delete(c.pollers, entity.Id)
			c.mu.Unlock()
			c.logger.Info("Poller stopped", "entityID", entity.Id)
		}()

		c.runPoller(instanceCtx, entity.Id, pollerConfig)
	}()
}

func (c *Controller) handleConfigRemoval(entityID string) {
	c.mu.Lock()
	defer c.mu.Unlock()

	if instance, exists := c.pollers[entityID]; exists {
		c.logger.Info("Stopping poller (config entity expired)", "entityID", entityID)
		instance.cancel()
		delete(c.pollers, entityID)
	}
}

func (c *Controller) runPoller(ctx context.Context, entityID string, config *PollerConfig) {
	c.logger.Info("Starting poller", "entityID", entityID, "configKey", config.ConfigKey, "interval", config.IntervalSeconds)

	adsbClient := NewADSBClient()

	grpcConn, err := grpc.NewClient(c.serverURL, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		c.logger.Error("Failed to create gRPC connection", "entityID", entityID, "error", err)
		return
	}
	defer grpcConn.Close()

	worldClient := pb.NewWorldServiceClient(grpcConn)

	ticker := time.NewTicker(time.Duration(config.IntervalSeconds) * time.Second)
	defer ticker.Stop()

	c.pollAndPush(ctx, entityID, config, adsbClient, worldClient)

	for {
		select {
		case <-ctx.Done():
			reason := "cancelled"
			if ctx.Err() == context.DeadlineExceeded {
				reason = "entity expired"
			}
			c.logger.Info("Poller shutting down", "entityID", entityID, "reason", reason)
			return

		case <-ticker.C:
			c.pollAndPush(ctx, entityID, config, adsbClient, worldClient)
		}
	}
}

func (c *Controller) pollAndPush(ctx context.Context, entityID string, config *PollerConfig, adsbClient *ADSBClient, worldClient pb.WorldServiceClient) {
	// Check if poller context is already done before starting work
	select {
	case <-ctx.Done():
		return
	default:
	}

	var aircraft []ADSBAircraft
	var err error

	// Create a 10 second timeout for the HTTP request
	requestCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	switch config.ConfigKey {
	case "adsblol.location.v0":
		if config.RadiusNM <= 0 {
			config.RadiusNM = 50
		}
		aircraft, err = adsbClient.FetchByLocation(requestCtx, config.Latitude, config.Longitude, config.RadiusNM)

	case "adsblol.military.v0":
		aircraft, err = adsbClient.FetchMilitary(requestCtx)

	case "adsblol.callsign.v0":
		if config.Callsign == "" {
			c.logger.Error("Callsign query requires callsign field", "entityID", entityID)
			return
		}
		aircraft, err = adsbClient.FetchByCallsign(requestCtx, config.Callsign)

	case "adsblol.icao.v0":
		if config.ICAO == "" {
			c.logger.Error("ICAO query requires icao field", "entityID", entityID)
			return
		}
		aircraft, err = adsbClient.FetchByICAO(requestCtx, config.ICAO)

	default:
		c.logger.Error("Unknown config key", "entityID", entityID, "configKey", config.ConfigKey)
		return
	}

	if err != nil {
		c.logger.Error("Failed to fetch aircraft data", "entityID", entityID, "error", err)
		return
	}

	var entities []*pb.Entity
	for _, ac := range aircraft {
		entity := ADSBAircraftToEntity(ac, entityID, time.Duration(config.IntervalSeconds))
		if entity != nil {
			entities = append(entities, entity)
		}
	}

	if len(entities) == 0 {
		return
	}

	_, err = worldClient.Push(ctx, &pb.EntityChangeRequest{
		Changes: entities,
	})
	if err != nil {
		c.logger.Error("Failed to push entities", "entityID", entityID, "error", err)
		return
	}
}

func parsePollerConfig(config *pb.ConfigurationComponent) (*PollerConfig, error) {
	if config.Value == nil || config.Value.Fields == nil {
		return nil, fmt.Errorf("empty config value")
	}

	fields := config.Value.Fields
	pollerConfig := &PollerConfig{
		ConfigKey: config.Key,
	}

	if v, ok := fields["latitude"]; ok {
		pollerConfig.Latitude = v.GetNumberValue()
	}
	if v, ok := fields["longitude"]; ok {
		pollerConfig.Longitude = v.GetNumberValue()
	}
	if v, ok := fields["radius_nm"]; ok {
		pollerConfig.RadiusNM = int(v.GetNumberValue())
	}
	if v, ok := fields["callsign"]; ok {
		pollerConfig.Callsign = v.GetStringValue()
	}
	if v, ok := fields["icao"]; ok {
		pollerConfig.ICAO = v.GetStringValue()
	}
	if v, ok := fields["interval_seconds"]; ok {
		pollerConfig.IntervalSeconds = int(v.GetNumberValue())
	}

	return pollerConfig, nil
}

func stringPtr(s string) *string {
	return &s
}

func Run(ctx context.Context, logger *slog.Logger, serverURL string) error {
	controller := NewController(serverURL, logger)
	return controller.Run(ctx)
}

func init() {
	builtin.Register("adsblol", Run)
}
