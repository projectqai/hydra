package asterix

import (
	"fmt"
	"strings"
	"time"

	"github.com/aep/gasterix/cat62"
	pb "github.com/projectqai/proto/go"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const feetToMeters = 0.3048

// TrackToEntity converts an ASTERIX CAT62 track to a Hydra entity.
func TrackToEntity(track *cat62.Track, sourcePrefix string, controllerID string) (*pb.Entity, error) {
	// Track must have at least track number and position
	if track.TrackNumber == nil {
		return nil, fmt.Errorf("track missing track number")
	}

	// Build entity ID from source + track number
	entityID := fmt.Sprintf("%s-%d", sourcePrefix, track.TrackNumber.Number)

	// Get position - prefer WGS84, fall back to Cartesian
	var lat, lon float64
	var hasPosition bool

	if track.CalculatedPositionWGS84 != nil {
		lat = track.CalculatedPositionWGS84.LatitudeDegrees()
		lon = track.CalculatedPositionWGS84.LongitudeDegrees()
		hasPosition = true
	}

	if !hasPosition {
		return nil, fmt.Errorf("track %d missing position", track.TrackNumber.Number)
	}

	// Get altitude - prefer geometric, then barometric, then measured flight level
	var altitude *float64
	if track.CalculatedTrackGeometricAltitude != nil {
		alt := track.CalculatedTrackGeometricAltitude.AltitudeFeet() * feetToMeters
		altitude = &alt
	} else if track.CalculatedTrackBarometricAltitude != nil {
		alt := track.CalculatedTrackBarometricAltitude.AltitudeFeet() * feetToMeters
		altitude = &alt
	} else if track.MeasuredFlightLevel != nil {
		alt := track.MeasuredFlightLevel.AltitudeFeet() * feetToMeters
		altitude = &alt
	}

	// Get callsign/label from target identification
	var label *string
	if track.TargetIdentification != nil {
		callsign := strings.TrimSpace(track.TargetIdentification.Callsign)
		if callsign != "" {
			label = &callsign
		}
	}

	// Build entity
	entity := &pb.Entity{
		Id: entityID,
		Geo: &pb.GeoSpatialComponent{
			Latitude:  lat,
			Longitude: lon,
			Altitude:  altitude,
		},
		Symbol: &pb.SymbolComponent{
			MilStd2525C: "SUAPM---------*", // Unknown, Air, Platform, Manned
		},
		Controller: &pb.ControllerRef{
			Id:   controllerID,
			Name: "asterix",
		},
		Track: &pb.TrackComponent{},
	}

	if label != nil {
		entity.Label = label
	}

	// Convert velocity from Cartesian (X/Y) to ENU (East/North/Up)
	// ASTERIX uses local Cartesian where X is typically East and Y is North
	if track.CalculatedVelocityCartesian != nil {
		vx := track.CalculatedVelocityCartesian.VxMetersPerSecond()
		vy := track.CalculatedVelocityCartesian.VyMetersPerSecond()

		entity.Kinematics = &pb.KinematicsComponent{
			VelocityEnu: &pb.KinematicsEnu{
				East:  &vx,
				North: &vy,
			},
		}

		// Add acceleration if present
		if track.CalculatedAccelerationCartesian != nil {
			ax := track.CalculatedAccelerationCartesian.AxMetersPerSecondSquared()
			ay := track.CalculatedAccelerationCartesian.AyMetersPerSecondSquared()
			entity.Kinematics.AccelerationEnu = &pb.KinematicsEnu{
				East:  &ax,
				North: &ay,
			}
		}
	}

	// Set lifetime based on track time
	if track.TimeOfTrackInformation != nil {
		// Time is seconds since midnight UTC
		now := time.Now().UTC()
		midnight := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
		trackTime := midnight.Add(track.TimeOfTrackInformation.Duration())

		// If track time is in the future (past midnight wrap), use yesterday's midnight
		if trackTime.After(now.Add(time.Hour)) {
			midnight = midnight.Add(-24 * time.Hour)
			trackTime = midnight.Add(track.TimeOfTrackInformation.Duration())
		}

		entity.Lifetime = &pb.Lifetime{
			From:  timestamppb.New(trackTime),
			Until: timestamppb.New(trackTime.Add(30 * time.Second)), // Default 30s expiry
		}
	}

	return entity, nil
}

// EntityToTrack converts a Hydra entity to an ASTERIX CAT62 track.
func EntityToTrack(entity *pb.Entity, sac, sic uint8) (*cat62.Track, error) {
	if entity.Geo == nil {
		return nil, nil // Skip entities without position
	}

	track := &cat62.Track{
		DataSourceIdentifier: &cat62.DataSourceIdentifier{
			SAC: sac,
			SIC: sic,
		},
	}

	// Set position in WGS84
	track.CalculatedPositionWGS84 = &cat62.CalculatedPositionWGS84{}
	track.CalculatedPositionWGS84.SetFromDegrees(entity.Geo.Latitude, entity.Geo.Longitude)

	// Set altitude
	if entity.Geo.Altitude != nil {
		alt := *entity.Geo.Altitude / feetToMeters // Convert meters to feet
		track.CalculatedTrackGeometricAltitude = &cat62.CalculatedTrackGeometricAltitude{}
		track.CalculatedTrackGeometricAltitude.SetFromFeet(alt)
	}

	// Set callsign
	if entity.Label != nil && *entity.Label != "" {
		track.TargetIdentification = &cat62.TargetIdentification{
			STI:      cat62.STICallsignNotDownlinked,
			Callsign: *entity.Label,
		}
	}

	// Set velocity (ENU to Cartesian)
	if entity.Kinematics != nil && entity.Kinematics.VelocityEnu != nil {
		vEnu := entity.Kinematics.VelocityEnu
		track.CalculatedVelocityCartesian = &cat62.CalculatedVelocityCartesian{}
		vx := 0.0
		vy := 0.0
		if vEnu.East != nil {
			vx = *vEnu.East
		}
		if vEnu.North != nil {
			vy = *vEnu.North
		}
		track.CalculatedVelocityCartesian.SetFromMetersPerSecond(vx, vy)

		// Set acceleration if present
		if entity.Kinematics.AccelerationEnu != nil {
			aEnu := entity.Kinematics.AccelerationEnu
			track.CalculatedAccelerationCartesian = &cat62.CalculatedAccelerationCartesian{}
			ax := 0.0
			ay := 0.0
			if aEnu.East != nil {
				ax = *aEnu.East
			}
			if aEnu.North != nil {
				ay = *aEnu.North
			}
			track.CalculatedAccelerationCartesian.SetFromMetersPerSecondSquared(ax, ay)
		}
	}

	// Set time of track information
	now := time.Now().UTC()
	midnight := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	secondsSinceMidnight := now.Sub(midnight).Seconds()
	track.TimeOfTrackInformation = &cat62.TimeOfTrackInformation{}
	track.TimeOfTrackInformation.SetFromSeconds(secondsSinceMidnight)

	// Extract track number from entity ID if possible
	// Expected format: "prefix-tracknum"
	trackNum := uint16(0)
	if parts := strings.Split(entity.Id, "-"); len(parts) >= 1 {
		var num int
		if _, err := fmt.Sscanf(parts[len(parts)-1], "%d", &num); err == nil && num > 0 && num < 65536 {
			trackNum = uint16(num)
		}
	}
	track.TrackNumber = &cat62.TrackNumber{Number: trackNum}

	// Set track status (required field)
	track.TrackStatus = &cat62.TrackStatus{}

	return track, nil
}
