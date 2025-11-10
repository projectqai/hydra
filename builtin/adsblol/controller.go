package adsblol

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/projectqai/hydra/builtin"
	"github.com/projectqai/hydra/builtin/controller"
	pb "github.com/projectqai/proto/go"
)

type PollerConfig struct {
	ConfigKey       string
	Latitude        float64
	Longitude       float64
	RadiusNM        int
	Callsign        string
	ICAO            string
	IntervalSeconds int
}

func Run(ctx context.Context, logger *slog.Logger, _ string) error {
	controllerName := "adsblol"

	return controller.Run1to1(ctx, &pb.EntityFilter{
		Component: []uint32{31},
		Config: &pb.ConfigurationFilter{
			Controller: &controllerName,
		},
	}, func(ctx context.Context, entity *pb.Entity) error {
		return runPoller(ctx, logger, entity)
	})
}

func runPoller(ctx context.Context, logger *slog.Logger, entity *pb.Entity) error {
	config := entity.Config
	pollerConfig, err := parsePollerConfig(config)
	if err != nil {
		return fmt.Errorf("parse config: %w", err)
	}

	if pollerConfig.IntervalSeconds <= 0 {
		pollerConfig.IntervalSeconds = 5
	}

	logger.Info("Starting poller", "entityID", entity.Id, "configKey", pollerConfig.ConfigKey, "interval", pollerConfig.IntervalSeconds)

	adsbClient := NewADSBClient()

	grpcConn, err := builtin.BuiltinClientConn()
	if err != nil {
		return fmt.Errorf("gRPC connection: %w", err)
	}
	defer grpcConn.Close()

	worldClient := pb.NewWorldServiceClient(grpcConn)

	ticker := time.NewTicker(time.Duration(pollerConfig.IntervalSeconds) * time.Second)
	defer ticker.Stop()

	// Initial poll
	pollAndPush(ctx, logger, entity.Id, pollerConfig, adsbClient, worldClient)

	for {
		select {
		case <-ctx.Done():
			logger.Info("Poller shutting down", "entityID", entity.Id)
			return ctx.Err()
		case <-ticker.C:
			pollAndPush(ctx, logger, entity.Id, pollerConfig, adsbClient, worldClient)
		}
	}
}

func pollAndPush(ctx context.Context, logger *slog.Logger, entityID string, config *PollerConfig, adsbClient *ADSBClient, worldClient pb.WorldServiceClient) {
	select {
	case <-ctx.Done():
		return
	default:
	}

	var aircraft []ADSBAircraft
	var err error

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
			logger.Error("Callsign query requires callsign field", "entityID", entityID)
			return
		}
		aircraft, err = adsbClient.FetchByCallsign(requestCtx, config.Callsign)

	case "adsblol.icao.v0":
		if config.ICAO == "" {
			logger.Error("ICAO query requires icao field", "entityID", entityID)
			return
		}
		aircraft, err = adsbClient.FetchByICAO(requestCtx, config.ICAO)

	default:
		logger.Error("Unknown config key", "entityID", entityID, "configKey", config.ConfigKey)
		return
	}

	if err != nil {
		logger.Error("Failed to fetch aircraft data", "entityID", entityID, "error", err)
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
		logger.Error("Failed to push entities", "entityID", entityID, "error", err)
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

func init() {
	builtin.Register("adsblol", Run)
}
