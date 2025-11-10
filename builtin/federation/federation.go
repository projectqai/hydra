package federation

import (
	"context"
	"fmt"
	"log/slog"
	"net/netip"

	"github.com/projectqai/hydra/builtin"
	"github.com/projectqai/hydra/builtin/controller"
	"github.com/projectqai/hydra/goclient"
	pb "github.com/projectqai/proto/go"
	"google.golang.org/protobuf/types/known/structpb"
)

type Instance struct {
	entityID  string
	serverURL string
	remote    string
	mode      string // "push" or "pull"
	filter    *pb.EntityFilter
	limiter   *pb.WatchLimiter
	logger    *slog.Logger
	wgConfig  *goclient.WireGuardConfig
}

var (
	globalLogger    *slog.Logger
	globalServerURL string
)

func Run(ctx context.Context, logger *slog.Logger, serverURL string) error {
	globalLogger = logger
	globalServerURL = serverURL
	controllerName := "federation"

	return controller.Run1to1(ctx, &pb.EntityFilter{
		Component: []uint32{31},
		Config: &pb.ConfigurationFilter{
			Controller: &controllerName,
		},
	}, func(ctx context.Context, entity *pb.Entity) error {
		return runInstance(ctx, globalLogger, globalServerURL, entity)
	})
}

func runInstance(ctx context.Context, logger *slog.Logger, serverURL string, entity *pb.Entity) error {
	config := entity.Config

	var mode string
	switch config.Key {
	case "federation.push.v0":
		mode = "push"
	case "federation.pull.v0":
		mode = "pull"
	default:
		return fmt.Errorf("unknown federation config key: %s", config.Key)
	}

	remote := ""
	var filter *pb.EntityFilter
	var limiter *pb.WatchLimiter
	var wgConfig *goclient.WireGuardConfig

	if config.Value != nil && config.Value.Fields != nil {

		if v, ok := config.Value.Fields["target"]; ok {
			remote = v.GetStringValue()
		}
		if v, ok := config.Value.Fields["source"]; ok {
			remote = v.GetStringValue()
		}

		if v, ok := config.Value.Fields["filter"]; ok {
			filter = parseEntityFilter(v)
		}

		if v, ok := config.Value.Fields["limiter"]; ok {
			limiter = parseWatchLimiter(v)
		}

		if v, ok := config.Value.Fields["wireguard"]; ok {
			wgConfig = parseWireGuardConfig(v)
		}
	}

	if remote == "" {
		return fmt.Errorf("federation config missing target/source")
	}

	instance := &Instance{
		entityID:  entity.Id,
		serverURL: serverURL,
		remote:    remote,
		mode:      mode,
		filter:    filter,
		limiter:   limiter,
		logger:    logger,
		wgConfig:  wgConfig,
	}

	if wgConfig != nil {
		logger.Info("starting federation with WireGuard", "entityID", entity.Id, "mode", mode, "remote", remote)
	} else {
		logger.Info("starting federation", "entityID", entity.Id, "mode", mode, "remote", remote)
	}

	if mode == "push" {
		return instance.runPush(ctx)
	}
	return instance.runPull(ctx)
}

func (i *Instance) connectToRemote() (*goclient.Connection, error) {
	if i.wgConfig != nil {
		conn, tunnel, err := goclient.ConnectViaWireGuard(i.remote, i.wgConfig)
		if err != nil {
			return nil, err
		}
		return &goclient.Connection{ClientConn: conn, Tunnel: tunnel}, nil
	}
	return goclient.Connect(i.remote)
}

func (i *Instance) runPull(ctx context.Context) error {
	localConn, err := goclient.Connect(i.serverURL)
	if err != nil {
		return err
	}
	defer localConn.Close()

	remoteConn, err := i.connectToRemote()
	if err != nil {
		return err
	}
	defer remoteConn.Close()

	localClient := pb.NewWorldServiceClient(localConn)
	remoteClient := pb.NewWorldServiceClient(remoteConn)

	stream, err := goclient.WatchEntitiesWithRetry(ctx, remoteClient, &pb.ListEntitiesRequest{
		Filter:       i.filter,
		WatchLimiter: i.limiter,
	})
	if err != nil {
		return err
	}

	i.logger.Info("pull started", "entityID", i.entityID)

	for {
		if ctx.Err() != nil {
			return ctx.Err()
		}

		event, err := stream.Recv()
		if err != nil {
			return err
		}

		if event.Entity == nil {
			continue
		}

		if event.Entity.Config != nil {
			continue
		}

		event.Entity.Controller = &pb.ControllerRef{
			Id:   i.entityID,
			Name: "federation",
		}

		_, err = localClient.Push(ctx, &pb.EntityChangeRequest{
			Changes: []*pb.Entity{event.Entity},
		})
		if err != nil {
			i.logger.Error("failed to push to local", "entityID", i.entityID, "targetEntity", event.Entity.Id, "error", err)
			continue
		}

		i.logger.Debug("pulled", "entityID", i.entityID, "targetEntity", event.Entity.Id)
	}
}

func (i *Instance) runPush(ctx context.Context) error {
	localConn, err := goclient.Connect(i.serverURL)
	if err != nil {
		return err
	}
	defer localConn.Close()

	remoteConn, err := i.connectToRemote()
	if err != nil {
		return err
	}
	defer remoteConn.Close()

	localClient := pb.NewWorldServiceClient(localConn)
	remoteClient := pb.NewWorldServiceClient(remoteConn)

	stream, err := goclient.WatchEntitiesWithRetry(ctx, localClient, &pb.ListEntitiesRequest{
		Filter:       i.filter,
		WatchLimiter: i.limiter,
	})
	if err != nil {
		return err
	}

	i.logger.Info("push started", "entityID", i.entityID)

	for {
		if ctx.Err() != nil {
			return ctx.Err()
		}

		event, err := stream.Recv()
		if err != nil {
			return err
		}

		if event.Entity == nil {
			continue
		}

		if event.Entity.Config != nil {
			continue
		}

		event.Entity.Controller = &pb.ControllerRef{
			Id:   i.entityID,
			Name: "federation",
		}

		_, err = remoteClient.Push(ctx, &pb.EntityChangeRequest{
			Changes: []*pb.Entity{event.Entity},
		})
		if err != nil {
			i.logger.Error("failed to push", "entityID", i.entityID, "targetEntity", event.Entity.Id, "error", err)
			continue
		}

		i.logger.Debug("pushed", "entityID", i.entityID, "targetEntity", event.Entity.Id)
	}
}

func parseWireGuardConfig(v *structpb.Value) *goclient.WireGuardConfig {
	if v == nil {
		return nil
	}

	s := v.GetStructValue()
	if s == nil {
		return nil
	}

	cfg := &goclient.WireGuardConfig{}

	if pk, ok := s.Fields["private_key"]; ok {
		cfg.PrivateKey = pk.GetStringValue()
	}
	if pk, ok := s.Fields["peer_public_key"]; ok {
		cfg.PeerPublicKey = pk.GetStringValue()
	}
	if ep, ok := s.Fields["endpoint"]; ok {
		cfg.Endpoint = ep.GetStringValue()
	}
	if addr, ok := s.Fields["address"]; ok {
		addrStr := addr.GetStringValue()
		if parsed, err := netip.ParseAddr(addrStr); err == nil {
			cfg.Address = parsed
		}
	}

	if cfg.PrivateKey == "" || cfg.PeerPublicKey == "" || cfg.Endpoint == "" || !cfg.Address.IsValid() {
		return nil
	}

	return cfg
}

func parseEntityFilter(v *structpb.Value) *pb.EntityFilter {
	if v == nil {
		return nil
	}

	s := v.GetStructValue()
	if s == nil {
		return nil
	}

	filter := &pb.EntityFilter{}

	if id, ok := s.Fields["id"]; ok {
		idStr := id.GetStringValue()
		filter.Id = &idStr
	}

	if label, ok := s.Fields["label"]; ok {
		labelStr := label.GetStringValue()
		filter.Label = &labelStr
	}

	if components, ok := s.Fields["component"]; ok {
		if list := components.GetListValue(); list != nil {
			for _, c := range list.Values {
				filter.Component = append(filter.Component, uint32(c.GetNumberValue()))
			}
		}
	}

	if configFilter, ok := s.Fields["config"]; ok {
		if cs := configFilter.GetStructValue(); cs != nil {
			filter.Config = &pb.ConfigurationFilter{}
			if ctrl, ok := cs.Fields["controller"]; ok {
				ctrlStr := ctrl.GetStringValue()
				filter.Config.Controller = &ctrlStr
			}
			if key, ok := cs.Fields["key"]; ok {
				keyStr := key.GetStringValue()
				filter.Config.Key = &keyStr
			}
		}
	}

	return filter
}

func parseWatchLimiter(v *structpb.Value) *pb.WatchLimiter {
	if v == nil {
		return nil
	}

	s := v.GetStructValue()
	if s == nil {
		return nil
	}

	limiter := &pb.WatchLimiter{}

	if mps, ok := s.Fields["max_messages_per_second"]; ok {
		val := uint64(mps.GetNumberValue())
		limiter.MaxMessagesPerSecond = &val
	}

	if minPri, ok := s.Fields["min_priority"]; ok {
		val := pb.Priority(int32(minPri.GetNumberValue()))
		limiter.MinPriority = &val
	}

	return limiter
}

func init() {
	builtin.Register("federation", Run)
}
