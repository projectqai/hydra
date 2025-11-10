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
	"github.com/projectqai/hydra/builtin/controller"
	pb "github.com/projectqai/proto/go"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type MessageFragment struct {
	fragments map[int64][]byte
	numParts  int64
	timestamp time.Time
}

type StreamConfig struct {
	Host                string   `json:"host"`
	Port                int      `json:"port"`
	EntityExpirySeconds int      `json:"entity_expiry_seconds"`
	Latitude            *float64 `json:"latitude"`
	Longitude           *float64 `json:"longitude"`
	RadiusKM            *float64 `json:"radius_km"`

	// Self position (receiver position from GPS RMC sentences)
	SelfEntityID     string `json:"self_entity_id"`
	SelfLabel        string `json:"self_label"`
	SelfSIDC         string `json:"self_sidc"`
	SelfAllowInvalid bool   `json:"self_allow_invalid"`
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

func Run(ctx context.Context, logger *slog.Logger, _ string) error {
	controllerName := "ais"

	return controller.Run1to1(ctx, &pb.EntityFilter{
		Component: []uint32{31},
		Config: &pb.ConfigurationFilter{
			Controller: &controllerName,
		},
	}, func(ctx context.Context, entity *pb.Entity) error {
		return runStream(ctx, logger, entity)
	})
}

func runStream(ctx context.Context, logger *slog.Logger, entity *pb.Entity) error {
	config := entity.Config
	if config.Key != "ais.stream.v0" {
		return fmt.Errorf("unknown config key: %s", config.Key)
	}

	streamConfig, err := parseStreamConfig(config)
	if err != nil {
		return fmt.Errorf("parse config: %w", err)
	}

	if streamConfig.Host == "" || streamConfig.Port == 0 {
		return fmt.Errorf("host and port are required")
	}

	if streamConfig.EntityExpirySeconds <= 0 {
		streamConfig.EntityExpirySeconds = 300
	}

	addr := fmt.Sprintf("%s:%d", streamConfig.Host, streamConfig.Port)
	logger.Info("Starting AIS stream", "entityID", entity.Id, "address", addr)

	grpcConn, err := builtin.BuiltinClientConn()
	if err != nil {
		return fmt.Errorf("gRPC connection: %w", err)
	}
	defer grpcConn.Close()

	worldClient := pb.NewWorldServiceClient(grpcConn)
	aisDecoder := ais.CodecNew(false, false)
	aisDecoder.DropSpace = true

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		conn, err := net.DialTimeout("tcp", addr, 10*time.Second)
		if err != nil {
			logger.Error("Failed to connect", "error", err)
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
				return ctx.Err()
			default:
			}
			processAISLine(ctx, logger, scanner.Text(), aisDecoder, worldClient, entity.Id, streamConfig, fragmentStore, &fragmentMu)
		}

		if err := scanner.Err(); err != nil {
			logger.Error("Stream read error", "error", err)
		}

		conn.Close()
		logger.Warn("Connection closed, reconnecting...", "entityID", entity.Id)
		time.Sleep(2 * time.Second)
	}
}

func processAISLine(ctx context.Context, logger *slog.Logger, line string, aisDecoder *ais.Codec, worldClient pb.WorldServiceClient, controllerID string, config *StreamConfig, fragmentStore map[int64]*MessageFragment, fragmentMu *sync.Mutex) bool {
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

	// Handle GPS RMC sentences (GPRMC)
	if rmc, ok := s.(nmea.RMC); ok {
		return processRMC(ctx, logger, rmc, worldClient, controllerID, config)
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

		return processAISPacket(ctx, logger, packet, worldClient, controllerID, config)
	}

	packet := aisDecoder.DecodePacket(vdm.Payload)
	if packet == nil {
		return false
	}

	return processAISPacket(ctx, logger, packet, worldClient, controllerID, config)
}

func processRMC(ctx context.Context, logger *slog.Logger, rmc nmea.RMC, worldClient pb.WorldServiceClient, controllerID string, config *StreamConfig) bool {
	// Skip invalid GPS fixes (V = void) unless configured to allow
	if rmc.Validity != "A" && !config.SelfAllowInvalid {
		return false
	}

	vessel := &AISVessel{
		MMSI:      0,
		Latitude:  rmc.Latitude,
		Longitude: rmc.Longitude,
		Speed:     rmc.Speed,
		Course:    rmc.Course,
		LastSeen:  time.Now(),
	}

	if !checkGeoFilter(vessel, config) {
		return false
	}

	entity := SelfToEntity(rmc, controllerID, config)
	if entity == nil {
		return false
	}

	_, err := worldClient.Push(ctx, &pb.EntityChangeRequest{
		Changes: []*pb.Entity{entity},
	})
	if err != nil {
		logger.Error("Failed to push GPS position", "error", err)
		return false
	}

	return true
}

func processAISPacket(ctx context.Context, logger *slog.Logger, packet ais.Packet, worldClient pb.WorldServiceClient, controllerID string, config *StreamConfig) bool {
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

		if !checkGeoFilter(vessel, config) {
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
			logger.Error("Failed to push vessel", "error", err)
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

		if !checkGeoFilter(vessel, config) {
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
			logger.Error("Failed to push vessel", "error", err)
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

		if !checkGeoFilter(vessel, config) {
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
			logger.Error("Failed to push vessel", "error", err)
			return false
		}

		return true
	}
	return false
}

func checkGeoFilter(vessel *AISVessel, config *StreamConfig) bool {
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

func SelfToEntity(rmc nmea.RMC, controllerID string, config *StreamConfig) *pb.Entity {
	entityID := config.SelfEntityID
	if entityID == "" {
		entityID = fmt.Sprintf("self-%s", controllerID)
	}

	label := config.SelfLabel
	if label == "" {
		label = "Self"
	}

	sidc := config.SelfSIDC
	if sidc == "" {
		sidc = "SFSPXM----*****"
	}

	altitude := 0.0

	entity := &pb.Entity{
		Id:    entityID,
		Label: &label,
		Lifetime: &pb.Lifetime{
			From:  timestamppb.Now(),
			Until: timestamppb.New(time.Now().Add(time.Duration(config.EntityExpirySeconds) * time.Second)),
		},
		Geo: &pb.GeoSpatialComponent{
			Latitude:  rmc.Latitude,
			Longitude: rmc.Longitude,
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

	if rmc.Course > 0 {
		course := rmc.Course
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
	if v, ok := fields["self_entity_id"]; ok {
		streamConfig.SelfEntityID = v.GetStringValue()
	}
	if v, ok := fields["self_label"]; ok {
		streamConfig.SelfLabel = v.GetStringValue()
	}
	if v, ok := fields["self_sidc"]; ok {
		streamConfig.SelfSIDC = v.GetStringValue()
	}
	if v, ok := fields["self_allow_invalid"]; ok {
		streamConfig.SelfAllowInvalid = v.GetBoolValue()
	}

	return streamConfig, nil
}

func init() {
	builtin.Register("ais", Run)
}
