package engine

import (
	"context"

	"github.com/projectqai/hydra/policy"
	pb "github.com/projectqai/proto/go"

	"connectrpc.com/connect"
)

func (s *WorldServer) WatchEntities(ctx context.Context, req *connect.Request[pb.ListEntitiesRequest], stream *connect.ServerStream[pb.EntityChangeEvent]) error {
	ability := policy.For(s.policy, req.Peer().Addr)
	consumer := NewConsumer(s, ability, req.Msg.WatchLimiter, req.Msg.Filter)
	s.bus.Register(consumer)
	defer s.bus.Unregister(consumer)

	// UI workaround - send an initial invalid event to signal stream is ready
	if err := stream.Send(&pb.EntityChangeEvent{
		T: pb.EntityChange_EntityChangeInvalid,
	}); err != nil {
		return err
	}

	// Mark all current entities as dirty, since we don't know what the consumer missed
	s.l.RLock()
	for id, e := range s.head {
		priority := pb.Priority_PriorityRoutine
		if e.Priority != nil {
			priority = *e.Priority
		}
		consumer.markDirty(id, priority, pb.EntityChange_EntityChangeUpdated)
	}
	s.l.RUnlock()

	return consumer.SenderLoop(ctx, stream.Send)
}
