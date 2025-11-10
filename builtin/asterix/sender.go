package asterix

import (
	"context"
	"fmt"
	"log/slog"
	"net"

	"github.com/aep/gasterix"
	"github.com/aep/gasterix/cat62"
	"github.com/projectqai/hydra/builtin"
	"github.com/projectqai/hydra/goclient"
	pb "github.com/projectqai/proto/go"
)

func runSender(ctx context.Context, logger *slog.Logger, entity *pb.Entity) error {
	config := entity.Config
	destAddr := "127.0.0.1:8600"
	category := 62
	var sac, sic uint8 = 0, 1

	if config.Value != nil && config.Value.Fields != nil {
		if v, ok := config.Value.Fields["address"]; ok {
			destAddr = v.GetStringValue()
		}
		if v, ok := config.Value.Fields["category"]; ok {
			category = int(v.GetNumberValue())
		}
		if v, ok := config.Value.Fields["sac"]; ok {
			sac = uint8(v.GetNumberValue())
		}
		if v, ok := config.Value.Fields["sic"]; ok {
			sic = uint8(v.GetNumberValue())
		}
	}

	logger.Info("Starting ASTERIX sender", "destAddr", destAddr, "category", category)

	udpAddr, err := net.ResolveUDPAddr("udp", destAddr)
	if err != nil {
		return fmt.Errorf("resolve UDP addr: %w", err)
	}

	localAddr, err := net.ResolveUDPAddr("udp", "0.0.0.0:0")
	if err != nil {
		return fmt.Errorf("resolve local addr: %w", err)
	}

	conn, err := net.DialUDP("udp", localAddr, udpAddr)
	if err != nil {
		return fmt.Errorf("dial UDP: %w", err)
	}
	defer conn.Close()

	logger.Info("ASTERIX UDP sender connected", "local", conn.LocalAddr(), "dest", destAddr, "category", category)

	grpcConn, err := builtin.BuiltinClientConn()
	if err != nil {
		return fmt.Errorf("gRPC connection: %w", err)
	}
	defer grpcConn.Close()

	client := pb.NewWorldServiceClient(grpcConn)
	stream, err := goclient.WatchEntitiesWithRetry(ctx, client, &pb.ListEntitiesRequest{})
	if err != nil {
		return fmt.Errorf("watch entities: %w", err)
	}

	sentCount := 0
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		event, err := stream.Recv()
		if err != nil {
			return err
		}

		if event.Entity == nil || event.Entity.Geo == nil || event.Entity.Track == nil {
			continue
		}

		var data []byte
		switch category {
		case cat62.Category:
			track, err := EntityToTrack(event.Entity, sac, sic)
			if err != nil {
				logger.Error("Error converting entity to track", "entityID", event.Entity.Id, "error", err)
				continue
			}
			if track == nil {
				continue
			}

			block := &gasterix.Block{
				Category: cat62.Category,
				Records:  []any{track},
			}
			var encErr error
			data, encErr = gasterix.Encode(block)
			if encErr != nil {
				logger.Error("Error encoding ASTERIX block", "entityID", event.Entity.Id, "error", encErr)
				continue
			}
		default:
			logger.Warn("Unsupported category for encoding", "category", category)
			continue
		}

		if len(data) == 0 {
			continue
		}

		if _, err := conn.Write(data); err != nil {
			logger.Error("UDP write error", "error", err)
			continue
		}

		sentCount++
		logger.Debug("Sent ASTERIX", "entityID", event.Entity.Id, "bytes", len(data), "total", sentCount)
	}
}
