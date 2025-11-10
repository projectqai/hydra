package asterix

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/projectqai/hydra/builtin"
	"github.com/projectqai/hydra/builtin/controller"
	pb "github.com/projectqai/proto/go"
)

func Run(ctx context.Context, logger *slog.Logger, _ string) error {
	controllerName := "asterix"

	return controller.Run1to1(ctx, &pb.EntityFilter{
		Component: []uint32{31},
		Config: &pb.ConfigurationFilter{
			Controller: &controllerName,
		},
	}, func(ctx context.Context, entity *pb.Entity) error {
		switch entity.Config.Key {
		case "asterix.receiver.v0":
			return runReceiver(ctx, logger, entity)
		case "asterix.sender.v0":
			return runSender(ctx, logger, entity)
		default:
			return fmt.Errorf("unknown config key: %s", entity.Config.Key)
		}
	})
}

func init() {
	builtin.Register("asterix", Run)
}
