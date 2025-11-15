package engine

import (
	"context"
	"fmt"
	"log/slog"
	"maps"
	"net/http"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/projectqai/hydra/builtin/view"
	pb "github.com/projectqai/hydra/proto"
	"github.com/projectqai/hydra/proto/protoconnect"

	"connectrpc.com/connect"
	"github.com/paulmach/orb"
	"github.com/rs/cors"
	"github.com/spf13/cobra"
	"golang.org/x/net/http2"
	"golang.org/x/net/http2/h2c"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type worldServer struct {
	l sync.RWMutex

	bus *Bus

	// currently live, ordered by id
	head  map[string]*pb.Entity
	store *Store

	frozen   atomic.Bool
	frozenAt time.Time

	observed map[*pb.Geometry]orb.Geometry
}

func (s *worldServer) ListEntities(ctx context.Context, req *connect.Request[pb.ListEntitiesRequest]) (*connect.Response[pb.ListEntitiesResponse], error) {
	s.l.RLock()
	defer s.l.RUnlock()

	el := slices.Collect(maps.Values(s.head))
	slices.SortFunc(el, func(a, b *pb.Entity) int { return strings.Compare(a.Id, b.Id) })

	response := &pb.ListEntitiesResponse{
		Entities: el,
	}
	return connect.NewResponse(response), nil
}

func (s *worldServer) GetEntity(ctx context.Context, req *connect.Request[pb.GetEntityRequest]) (*connect.Response[pb.GetEntityResponse], error) {
	s.l.RLock()
	defer s.l.RUnlock()

	entity, exists := s.head[req.Msg.Id]
	if !exists {
		return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("entity with id %s not found", req.Msg.Id))
	}

	response := &pb.GetEntityResponse{
		Entity: entity,
	}
	return connect.NewResponse(response), nil
}

func (s *worldServer) Push(ctx context.Context, req *connect.Request[pb.EntityChangeRequest]) (*connect.Response[pb.EntityChangeResponse], error) {
	s.l.Lock()
	defer s.l.Unlock()
	for _, e := range req.Msg.Changes {

		if e.Lifetime == nil {
			e.Lifetime = &pb.Lifetime{}
		}

		if !e.Lifetime.From.IsValid() {
			e.Lifetime.From = timestamppb.Now()
		}

		s.store.Push(ctx, Event{Entity: e})
		if !s.frozen.Load() {
			s.head[e.Id] = e
			s.bus.publish(busevent{entity: &pb.EntityChangeEvent{Entity: e, T: pb.EntityChange_Updated}, trace: "grpc push"})
		}
	}

	response := &pb.EntityChangeResponse{
		Accepted: true,
	}

	return connect.NewResponse(response), nil
}

func RunEngine(cmd *cobra.Command, args []string) error {
	engine := &worldServer{}
	engine.bus = NewBus()

	// sample data
	engine.head = make(map[string]*pb.Entity)
	engine.observed = make(map[*pb.Geometry]orb.Geometry)
	engine.store = NewStore()

	go func() {
		ticker := time.NewTicker(time.Second)
		for range ticker.C {
			engine.gc()
		}
	}()

	// Create HTTP handlers
	mux := http.NewServeMux()

	worldPath, worldHandler := protoconnect.NewWorldServiceHandler(engine)
	mux.Handle(worldPath, worldHandler)

	timelinePath, timelineHandler := protoconnect.NewTimelineServiceHandler(engine)
	mux.Handle(timelinePath, timelineHandler)

	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain")
		w.Write([]byte("OK"))
	})

	webServer, err := view.NewWebServer()
	if err != nil {
		return fmt.Errorf("failed to create web server: %w", err)
	}
	mux.Handle("/", webServer)

	corsHandler := cors.New(cors.Options{
		AllowedOrigins: []string{"*"},
		AllowedMethods: []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders: []string{"*"},
	})

	httpServer := &http.Server{
		Addr:    ":50051",
		Handler: h2c.NewHandler(corsHandler.Handler(mux), &http2.Server{}),
	}

	slog.Info("world server on http://:50051")
	if err := httpServer.ListenAndServe(); err != nil {
		return fmt.Errorf("failed to serve: %v", err)
	}

	return nil
}
