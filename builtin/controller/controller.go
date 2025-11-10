// Package controller provides a framework for managing config-driven connectors.
package controller

import (
	"context"
	"log/slog"
	"sync"
	"time"

	"github.com/projectqai/hydra/builtin"
	"github.com/projectqai/hydra/goclient"
	pb "github.com/projectqai/proto/go"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// RunFunc is called when a matching entity is observed.
// It should block until done or error.
// The context expires when the entity is deleted or its lifetime.until is reached.
// It will always be restarted until the context is cancelled.
type RunFunc func(ctx context.Context, entity *pb.Entity) error

type controller struct {
	run        RunFunc
	mu         sync.Mutex
	connectors map[string]context.CancelFunc
}

// Run1to1 watches for entities matching the filter and runs exactly one connector for each entity
// It blocks until the context is cancelled or an error occurs.
func Run1to1(ctx context.Context, forEntity *pb.EntityFilter, run RunFunc) error {
	c := &controller{
		run:        run,
		connectors: make(map[string]context.CancelFunc),
	}

	grpcConn, err := builtin.BuiltinClientConn()
	if err != nil {
		return err
	}
	defer grpcConn.Close()

	client := pb.NewWorldServiceClient(grpcConn)

	stream, err := goclient.WatchEntitiesWithRetry(ctx, client, &pb.ListEntitiesRequest{
		Filter: forEntity,
	})
	if err != nil {
		return err
	}

	for {
		event, err := stream.Recv()
		if err != nil {
			return err
		}

		if event.Entity == nil {
			continue
		}

		entity := event.Entity

		switch event.T {
		case pb.EntityChange_EntityChangeUpdated:
			c.handleUpdate(ctx, entity)
		case pb.EntityChange_EntityChangeUnobserved, pb.EntityChange_EntityChangeExpired:
			if entity.Lifetime != nil {
				entity.Lifetime = &pb.Lifetime{}
			}
			entity.Lifetime.Until = timestamppb.Now()
			c.handleUpdate(ctx, entity)
		}
	}
}

func (c *controller) handleUpdate(ctx context.Context, entity *pb.Entity) {
	c.mu.Lock()
	if cancel, exists := c.connectors[entity.Id]; exists {
		cancel()
		delete(c.connectors, entity.Id)
	}
	c.mu.Unlock()

	if entity.Lifetime != nil && entity.Lifetime.Until != nil {
		if !entity.Lifetime.Until.AsTime().After(time.Now()) {
			return
		}
	}

	connCtx, cancel := context.WithCancel(ctx)
	if entity.Lifetime != nil && entity.Lifetime.Until != nil {
		connCtx, cancel = context.WithDeadline(ctx, entity.Lifetime.Until.AsTime())
	}

	c.mu.Lock()
	c.connectors[entity.Id] = cancel
	c.mu.Unlock()

	go c.runConnector(connCtx, entity)
}

func (c *controller) runConnector(ctx context.Context, entity *pb.Entity) {
	defer func() {
		c.mu.Lock()
		delete(c.connectors, entity.Id)
		c.mu.Unlock()
	}()

	for {
		if ctx.Err() != nil {
			return
		}

		err := c.run(ctx, entity)
		if ctx.Err() != nil {
			return
		}

		if err != nil {
			slog.Error("connector error, restarting", "entityID", entity.Id, "error", err)
		}

		select {
		case <-ctx.Done():
			return
		case <-time.After(5 * time.Second):
		}
	}
}
