package asterix

import (
	"context"
	"fmt"
	"log/slog"
	"net"
	"time"

	"github.com/aep/gasterix"
	"github.com/aep/gasterix/cat62"
	"github.com/projectqai/hydra/builtin"
	pb "github.com/projectqai/proto/go"
)

func runReceiver(ctx context.Context, logger *slog.Logger, entity *pb.Entity) error {
	config := entity.Config
	listenAddr := ":8600"
	category := 62
	sourcePrefix := entity.Id

	if config.Value != nil && config.Value.Fields != nil {
		if v, ok := config.Value.Fields["listen"]; ok {
			listenAddr = v.GetStringValue()
		}
		if v, ok := config.Value.Fields["category"]; ok {
			category = int(v.GetNumberValue())
		}
		if v, ok := config.Value.Fields["source_prefix"]; ok {
			sourcePrefix = v.GetStringValue()
		}
	}

	logger.Info("Starting ASTERIX receiver", "listenAddr", listenAddr, "category", category)

	addr, err := net.ResolveUDPAddr("udp", listenAddr)
	if err != nil {
		return fmt.Errorf("resolve UDP addr: %w", err)
	}

	conn, err := net.ListenUDP("udp", addr)
	if err != nil {
		return fmt.Errorf("listen UDP: %w", err)
	}
	defer conn.Close()

	logger.Info("ASTERIX UDP receiver listening", "addr", listenAddr, "category", category)

	grpcConn, err := builtin.BuiltinClientConn()
	if err != nil {
		return fmt.Errorf("gRPC connection: %w", err)
	}
	defer grpcConn.Close()

	client := pb.NewWorldServiceClient(grpcConn)

	go func() {
		<-ctx.Done()
		conn.Close()
	}()

	buffer := make([]byte, 65536)
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		conn.SetReadDeadline(time.Now().Add(1 * time.Second))
		n, remoteAddr, err := conn.ReadFromUDP(buffer)
		if err != nil {
			if netErr, ok := err.(net.Error); ok && netErr.Timeout() {
				continue
			}
			if ctx.Err() != nil {
				return ctx.Err()
			}
			logger.Error("UDP read error", "error", err)
			continue
		}

		logger.Debug("Received ASTERIX data", "bytes", n, "from", remoteAddr)

		blocks, err := gasterix.DecodeAll(buffer[:n])
		if err != nil {
			logger.Error("ASTERIX decode error", "error", err)
			continue
		}

		var entities []*pb.Entity
		for _, block := range blocks {
			if block.Category != uint8(category) {
				logger.Debug("Skipping block with different category", "got", block.Category, "expected", category)
				continue
			}

			switch category {
			case cat62.Category:
				tracks := block.Cat62Tracks()
				for _, track := range tracks {
					e, err := TrackToEntity(track, sourcePrefix, entity.Id)
					if err != nil {
						logger.Debug("Skip track", "error", err)
						continue
					}
					entities = append(entities, e)
				}
			default:
				logger.Warn("Unsupported category for decoding", "category", category)
			}
		}

		if len(entities) > 0 {
			_, err := client.Push(ctx, &pb.EntityChangeRequest{Changes: entities})
			if err != nil {
				logger.Error("Push to Hydra failed", "error", err, "count", len(entities))
			} else {
				logger.Info("Pushed entities to Hydra", "count", len(entities))
			}
		}
	}
}
