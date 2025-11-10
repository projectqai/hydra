package ais

import (
	"bufio"
	"context"
	"fmt"
	"log/slog"
	"net"
	"strings"
	"sync"
	"time"

	"github.com/BertoldVdb/go-ais"
	"github.com/adrianmo/go-nmea"
	"github.com/paulmach/orb"
	"github.com/paulmach/orb/geo"
	"github.com/projectqai/hydra/builtin"
	"github.com/projectqai/hydra/goclient"
	pb "github.com/projectqai/proto/go"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type Controller struct {
	serverURL string
	logger    *slog.Logger
	mu        sync.Mutex
	streams   map[string]*StreamInstance
}

type MessageFragment struct {
	fragments map[int64][]byte
	numParts  int64
	timestamp time.Time
}

type StreamInstance struct {
	entityID string
	config   *StreamConfig
	cancel   context.CancelFunc
	ctx      context.Context
}

type StreamConfig struct {
	Host                string   `json:"host"`
	Port                int      `json:"port"`
	EntityExpirySeconds int      `json:"entity_expiry_seconds"`
	Latitude            *float64 `json:"latitude"`
	Longitude           *float64 `json:"longitude"`
	RadiusKM            *float64 `json:"radius_km"`
}

type AISVessel struct {
	MMSI      uint32
	Latitude  float64
	Longitude float64
	Speed     float64
	Course    float64
	Heading   int
	Name      string
	Callsign  string
	Type      uint8
	LastSeen  time.Time
}

func NewController(serverURL string, logger *slog.Logger) *Controller {
	return &Controller{
		serverURL: serverURL,
		logger:    logger,
		streams:   make(map[string]*StreamInstance),
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
				Controller: stringPtr("ais"),
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

		switch event.T {
		case pb.EntityChange_EntityChangeUpdated:
			c.handleConfigUpdate(ctx, entity, config)

		case pb.EntityChange_EntityChangeUnobserved, pb.EntityChange_EntityChangeExpired:
			c.handleConfigRemoval(entity.Id)
		}
	}
}

func (c *Controller) handleConfigUpdate(ctx context.Context, entity *pb.Entity, config *pb.ConfigurationComponent) {
	if config.Key != "ais.stream.v0" {
		c.logger.Warn("Unknown configuration key", "key", config.Key)
		return
	}

	c.mu.Lock()
	defer c.mu.Unlock()

	if existing, exists := c.streams[entity.Id]; exists {
		existing.cancel()
	}

	streamConfig, err := parseStreamConfig(config)
	if err != nil {
		c.logger.Error("Failed to parse stream config", "entityID", entity.Id, "error", err)
		return
	}

	if streamConfig.Host == "" || streamConfig.Port == 0 {
		c.logger.Error("Host and port are required", "entityID", entity.Id)
		return
	}

	if streamConfig.EntityExpirySeconds <= 0 {
		streamConfig.EntityExpirySeconds = 300
	}

	instanceCtx, cancel := context.WithCancel(ctx)
	if entity.Lifetime != nil && entity.Lifetime.Until != nil {
		instanceCtx, cancel = context.WithDeadline(ctx, entity.Lifetime.Until.AsTime())
	}

	instance := &StreamInstance{
		entityID: entity.Id,
		config:   streamConfig,
		cancel:   cancel,
		ctx:      instanceCtx,
	}

	c.streams[entity.Id] = instance

	go func() {
		defer cancel()
		defer func() {
			c.mu.Lock()
			delete(c.streams, entity.Id)
			c.mu.Unlock()
		}()
		c.runStream(instanceCtx, entity.Id, streamConfig)
	}()
}

func (c *Controller) handleConfigRemoval(entityID string) {
	c.mu.Lock()
	defer c.mu.Unlock()

	if instance, exists := c.streams[entityID]; exists {
		instance.cancel()
		delete(c.streams, entityID)
	}
}

func (c *Controller) runStream(ctx context.Context, entityID string, config *StreamConfig) {
	addr := fmt.Sprintf("%s:%d", config.Host, config.Port)
	c.logger.Info("Starting AIS stream", "entityID", entityID, "address", addr)

	grpcConn, err := grpc.NewClient(c.serverURL, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		c.logger.Error("Failed to create gRPC connection", "error", err)
		return
	}
	defer grpcConn.Close()

	worldClient := pb.NewWorldServiceClient(grpcConn)
	aisDecoder := ais.CodecNew(false, false)
	aisDecoder.DropSpace = true

	for {
		select {
		case <-ctx.Done():
			return
		default:
		}

		conn, err := net.DialTimeout("tcp", addr, 10*time.Second)
		if err != nil {
			c.logger.Error("Failed to connect", "error", err)
			time.Sleep(5 * time.Second)
			continue
		}

		conn.SetReadDeadline(time.Now().Add(30 * time.Second))
		scanner := bufio.NewScanner(conn)
		fragmentStore := make(map[int64]*MessageFragment)
		fragmentMu := sync.Mutex{}

		for scanner.Scan() {
			conn.SetReadDeadline(time.Now().Add(30 * time.Second))
			select {
			case <-ctx.Done():
				conn.Close()
				return
			default:
			}
			c.processAISLine(ctx, scanner.Text(), aisDecoder, worldClient, entityID, config, fragmentStore, &fragmentMu)
		}

		if err := scanner.Err(); err != nil {
			c.logger.Error("Stream read error", "error", err)
		}

		conn.Close()
		c.logger.Warn("Connection closed, reconnecting...", "entityID", entityID)
		time.Sleep(2 * time.Second)
	}
}

func (c *Controller) processAISLine(ctx context.Context, line string, aisDecoder *ais.Codec, worldClient pb.WorldServiceClient, controllerID string, config *StreamConfig, fragmentStore map[int64]*MessageFragment, fragmentMu *sync.Mutex) bool {
	if idx := strings.Index(line, "!"); idx >= 0 {
		line = line[idx:]
	} else if idx := strings.Index(line, "$"); idx >= 0 {
		line = line[idx:]
	} else {
		return false
	}

	s, err := nmea.Parse(line)
	if err != nil {
		return false
	}

	vdm, ok := s.(nmea.VDMVDO)
	if !ok {
		return false
	}

	if vdm.NumFragments > 1 {
		fragmentMu.Lock()
		defer fragmentMu.Unlock()

		msgFrag, exists := fragmentStore[vdm.MessageID]
		if !exists {
			msgFrag = &MessageFragment{
				fragments: make(map[int64][]byte),
				numParts:  vdm.NumFragments,
				timestamp: time.Now(),
			}
			fragmentStore[vdm.MessageID] = msgFrag
		}

		msgFrag.fragments[vdm.FragmentNumber] = vdm.Payload

		if int64(len(msgFrag.fragments)) < vdm.NumFragments {
			return false
		}

		var completePayload []byte
		for i := int64(1); i <= vdm.NumFragments; i++ {
			fragment, ok := msgFrag.fragments[i]
			if !ok {
				return false
			}
			completePayload = append(completePayload, fragment...)
		}

		delete(fragmentStore, vdm.MessageID)

		packet := aisDecoder.DecodePacket(completePayload)
		if packet == nil {
			return false
		}

		return c.processAISPacket(ctx, packet, worldClient, controllerID, config)
	}

	packet := aisDecoder.DecodePacket(vdm.Payload)
	if packet == nil {
		return false
	}

	return c.processAISPacket(ctx, packet, worldClient, controllerID, config)
}

func (c *Controller) processAISPacket(ctx context.Context, packet ais.Packet, worldClient pb.WorldServiceClient, controllerID string, config *StreamConfig) bool {
	switch msg := packet.(type) {
	case ais.PositionReport:
		mmsi := msg.UserID
		if mmsi == 0 {
			return false
		}

		vessel := &AISVessel{
			MMSI:      mmsi,
			Latitude:  float64(msg.Latitude),
			Longitude: float64(msg.Longitude),
			Speed:     float64(msg.Sog),
			Course:    float64(msg.Cog),
			Heading:   int(msg.TrueHeading),
			LastSeen:  time.Now(),
		}

		if !c.checkGeoFilter(vessel, config) {
			return false
		}

		entity := VesselToEntity(vessel, controllerID, time.Duration(config.EntityExpirySeconds))
		if entity == nil {
			return false
		}

		_, err := worldClient.Push(ctx, &pb.EntityChangeRequest{
			Changes: []*pb.Entity{entity},
		})
		if err != nil {
			c.logger.Error("Failed to push vessel", "error", err)
			return false
		}

		return true

	case ais.StandardClassBPositionReport:
		mmsi := msg.UserID
		if mmsi == 0 {
			return false
		}

		vessel := &AISVessel{
			MMSI:      mmsi,
			Latitude:  float64(msg.Latitude),
			Longitude: float64(msg.Longitude),
			Speed:     float64(msg.Sog),
			Course:    float64(msg.Cog),
			Heading:   int(msg.TrueHeading),
			LastSeen:  time.Now(),
		}

		if !c.checkGeoFilter(vessel, config) {
			return false
		}

		entity := VesselToEntity(vessel, controllerID, time.Duration(config.EntityExpirySeconds))
		if entity == nil {
			return false
		}

		_, err := worldClient.Push(ctx, &pb.EntityChangeRequest{
			Changes: []*pb.Entity{entity},
		})
		if err != nil {
			c.logger.Error("Failed to push vessel", "error", err)
			return false
		}

		return true

	case ais.ExtendedClassBPositionReport:
		mmsi := msg.UserID
		if mmsi == 0 {
			return false
		}

		vessel := &AISVessel{
			MMSI:      mmsi,
			Latitude:  float64(msg.Latitude),
			Longitude: float64(msg.Longitude),
			Speed:     float64(msg.Sog),
			Course:    float64(msg.Cog),
			Heading:   int(msg.TrueHeading),
			Name:      msg.Name,
			Type:      msg.Type,
			LastSeen:  time.Now(),
		}

		if !c.checkGeoFilter(vessel, config) {
			return false
		}

		entity := VesselToEntity(vessel, controllerID, time.Duration(config.EntityExpirySeconds))
		if entity == nil {
			return false
		}

		_, err := worldClient.Push(ctx, &pb.EntityChangeRequest{
			Changes: []*pb.Entity{entity},
		})
		if err != nil {
			c.logger.Error("Failed to push vessel", "error", err)
			return false
		}

		return true
	}
	return false
}

func (c *Controller) checkGeoFilter(vessel *AISVessel, config *StreamConfig) bool {
	if config.Latitude == nil || config.Longitude == nil || config.RadiusKM == nil {
		return true
	}

	center := orb.Point{*config.Longitude, *config.Latitude}
	vesselPoint := orb.Point{vessel.Longitude, vessel.Latitude}
	distanceKM := geo.Distance(center, vesselPoint) / 1000.0
	return distanceKM <= *config.RadiusKM
}

func VesselToEntity(vessel *AISVessel, controllerID string, expires time.Duration) *pb.Entity {
	entityID := fmt.Sprintf("ais-%d", vessel.MMSI)
	label := vessel.Name
	if label == "" {
		label = vessel.Callsign
	}
	if label == "" {
		label = fmt.Sprintf("MMSI %d", vessel.MMSI)
	}

	altitude := 0.0
	sidc := vesselTypeToSIDC(vessel.Type)

	entity := &pb.Entity{
		Id:    entityID,
		Label: &label,
		Lifetime: &pb.Lifetime{
			From:  timestamppb.Now(),
			Until: timestamppb.New(time.Now().Add(expires * time.Second)),
		},
		Geo: &pb.GeoSpatialComponent{
			Latitude:  vessel.Latitude,
			Longitude: vessel.Longitude,
			Altitude:  &altitude,
		},
		Symbol: &pb.SymbolComponent{
			MilStd2525C: sidc,
		},
		Controller: &pb.ControllerRef{
			Id:   controllerID,
			Name: "ais",
		},
		Track: &pb.TrackComponent{},
	}

	if vessel.Course > 0 {
		course := vessel.Course
		entity.Bearing = &pb.BearingComponent{
			Azimuth: &course,
		}
	}

	return entity
}

func vesselTypeToSIDC(shipType uint8) string {
	return "SFSPXM----*****"
}

func parseStreamConfig(config *pb.ConfigurationComponent) (*StreamConfig, error) {
	if config.Value == nil || config.Value.Fields == nil {
		return nil, fmt.Errorf("empty config value")
	}

	fields := config.Value.Fields
	streamConfig := &StreamConfig{}

	if v, ok := fields["host"]; ok {
		streamConfig.Host = v.GetStringValue()
	}
	if v, ok := fields["port"]; ok {
		streamConfig.Port = int(v.GetNumberValue())
	}
	if v, ok := fields["entity_expiry_seconds"]; ok {
		streamConfig.EntityExpirySeconds = int(v.GetNumberValue())
	}
	if v, ok := fields["latitude"]; ok {
		lat := v.GetNumberValue()
		streamConfig.Latitude = &lat
	}
	if v, ok := fields["longitude"]; ok {
		lon := v.GetNumberValue()
		streamConfig.Longitude = &lon
	}
	if v, ok := fields["radius_km"]; ok {
		radius := v.GetNumberValue()
		streamConfig.RadiusKM = &radius
	}

	return streamConfig, nil
}

func stringPtr(s string) *string {
	return &s
}

func Run(ctx context.Context, logger *slog.Logger, serverURL string) error {
	controller := NewController(serverURL, logger)
	return controller.Run(ctx)
}

func init() {
	builtin.Register("ais", Run)
}
