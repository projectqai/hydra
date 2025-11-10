package engine

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"os"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/fatih/color"
	"github.com/projectqai/hydra/builtin"
	"github.com/projectqai/hydra/metrics"
	"github.com/projectqai/hydra/policy"
	"github.com/projectqai/hydra/version"
	"github.com/projectqai/hydra/view"
	pb "github.com/projectqai/proto/go"
	"github.com/projectqai/proto/go/_goconnect"

	"connectrpc.com/connect"
	"github.com/rs/cors"
	"golang.org/x/net/http2"
	"golang.org/x/net/http2/h2c"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type WorldServer struct {
	l sync.RWMutex

	bus *Bus

	// currently live, ordered by id
	head  map[string]*pb.Entity
	store *Store

	frozen   atomic.Bool
	frozenAt time.Time

	// worldFile is the path to persist world state (if set)
	worldFile string

	// policy is optional OPA policy engine for authorization
	policy *policy.Engine
}

func NewWorldServer() *WorldServer {
	server := &WorldServer{
		bus:   NewBus(),
		head:  make(map[string]*pb.Entity),
		store: NewStore(),
	}

	// Start garbage collection ticker
	go func() {
		ticker := time.NewTicker(time.Second)
		defer ticker.Stop()
		for range ticker.C {
			server.gc()
		}
	}()

	return server
}

func (s *WorldServer) GetHead(id string) *pb.Entity {
	s.l.RLock()
	defer s.l.RUnlock()
	return s.head[id]
}

func (s *WorldServer) ListEntities(ctx context.Context, req *connect.Request[pb.ListEntitiesRequest]) (*connect.Response[pb.ListEntitiesResponse], error) {
	ability := policy.For(s.policy, req.Peer().Addr)

	s.l.RLock()
	defer s.l.RUnlock()

	el := make([]*pb.Entity, 0, len(s.head))
	for _, v := range s.head {
		if !s.matchesListEntitiesRequest(v, req.Msg) {
			continue
		}
		if !ability.CanRead(ctx, v) {
			continue
		}
		el = append(el, v)
	}
	slices.SortFunc(el, func(a, b *pb.Entity) int { return strings.Compare(a.Id, b.Id) })

	response := &pb.ListEntitiesResponse{
		Entities: el,
	}
	return connect.NewResponse(response), nil
}

func (s *WorldServer) GetEntity(ctx context.Context, req *connect.Request[pb.GetEntityRequest]) (*connect.Response[pb.GetEntityResponse], error) {
	s.l.RLock()
	defer s.l.RUnlock()

	entity, exists := s.head[req.Msg.Id]
	if !exists {
		return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("entity with id %s not found", req.Msg.Id))
	}

	if !policy.For(s.policy, req.Peer().Addr).CanRead(ctx, entity) {
		return nil, connect.NewError(connect.CodePermissionDenied, fmt.Errorf("policy denied read"))
	}

	response := &pb.GetEntityResponse{
		Entity: entity,
	}
	return connect.NewResponse(response), nil
}

func (s *WorldServer) Push(ctx context.Context, req *connect.Request[pb.EntityChangeRequest]) (*connect.Response[pb.EntityChangeResponse], error) {
	ability := policy.For(s.policy, req.Peer().Addr)
	for _, e := range req.Msg.Changes {
		if err := ability.AuthorizeWrite(ctx, e); err != nil {
			return nil, err
		}
	}

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
			s.bus.Dirty(e.Id, e, pb.EntityChange_EntityChangeUpdated)
		}
	}

	response := &pb.EntityChangeResponse{
		Accepted: true,
	}

	return connect.NewResponse(response), nil
}

// EngineConfig holds configuration for starting the engine
type EngineConfig struct {
	WorldFile  string
	PolicyFile string
}

// StartEngine starts the Hydra engine and returns the server address.
// If worldFile is provided, it loads entities from that file on startup
// and periodically flushes the current state back to the file.
func StartEngine(ctx context.Context, cfg EngineConfig) (string, error) {
	engine := NewWorldServer()

	// Set up world file persistence if specified
	if cfg.WorldFile != "" {
		engine.worldFile = cfg.WorldFile

		// Load existing state from file
		if err := engine.LoadFromFile(cfg.WorldFile); err != nil {
			return "", fmt.Errorf("failed to load world file: %w", err)
		}

		// Start periodic flushing (every 10 seconds)
		engine.StartPeriodicFlush(10 * time.Second)
	}

	// Set up OPA policy engine if specified
	if cfg.PolicyFile != "" {
		policyEngine, err := policy.NewEngine(cfg.PolicyFile)
		if err != nil {
			return "", fmt.Errorf("failed to load policy: %w", err)
		}
		engine.policy = policyEngine
	}

	// Initialize Prometheus exporter and OpenTelemetry metrics
	promHandler, err := metrics.InitPrometheus()
	if err != nil {
		return "", fmt.Errorf("failed to initialize prometheus: %w", err)
	}

	if err := metrics.Init(); err != nil {
		return "", fmt.Errorf("failed to initialize metrics: %w", err)
	}

	// Start metrics updater
	StartMetricsUpdater(engine)

	// Get port from environment or use default
	port := os.Getenv("PORT")
	if port == "" {
		port = "50051"
	}

	// Create HTTP handlers
	mux := http.NewServeMux()

	worldPath, worldHandler := _goconnect.NewWorldServiceHandler(engine)
	mux.Handle(worldPath, worldHandler)

	timelinePath, timelineHandler := _goconnect.NewTimelineServiceHandler(engine)
	mux.Handle(timelinePath, timelineHandler)

	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain")
		w.Write([]byte("OK"))
	})

	// Prometheus metrics endpoint
	mux.Handle("/metrics", promHandler)

	webServer, err := view.NewWebServer()
	if err != nil {
		return "", fmt.Errorf("failed to create web server: %w", err)
	}
	mux.Handle("/", webServer)

	corsHandler := cors.New(cors.Options{
		AllowedOrigins: []string{"*"},
		AllowedMethods: []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders: []string{"*"},
	})

	httpServer := &http.Server{
		Addr:    ":" + port,
		Handler: h2c.NewHandler(corsHandler.Handler(mux), &http2.Server{}),
	}

	// Create listener first to fail fast if port is in use
	listener, err := net.Listen("tcp", ":"+port)
	if err != nil {
		return "", fmt.Errorf("failed to listen on port %s: %v", port, err)
	}

	localIPs := getAllLocalIPs()
	green := color.New(color.FgGreen)
	cyan := color.New(color.FgCyan)
	bold := color.New(color.Bold)

	fmt.Println()
	green.Print("  ➜ ")
	bold.Print("Hydra World Server ")
	fmt.Printf("(%s)", version.Version)
	fmt.Println(" running at:")
	green.Print("  ➜ ")
	fmt.Print("Local:   ")
	cyan.Printf("http://localhost:%s\n", port)

	for _, ip := range localIPs {
		green.Print("  ➜ ")
		fmt.Print("Network: ")
		cyan.Printf("http://%s:%s\n", ip, port)
	}
	fmt.Println()

	go func() {
		if err := httpServer.Serve(listener); err != nil && err != http.ErrServerClosed {
			fmt.Printf("Server error: %v\n", err)
			os.Exit(1)
		}
	}()

	// Start in-process server for builtin services
	builtinServer := &http.Server{
		Handler: h2c.NewHandler(mux, &http2.Server{}),
	}
	go func() {
		if err := builtinServer.Serve(builtin.GetBuiltinListener()); err != nil && err != http.ErrServerClosed {
			fmt.Printf("Builtin server error: %v\n", err)
			os.Exit(1)
		}
	}()

	go func() {
		<-ctx.Done()
		httpServer.Shutdown(context.Background())
		builtinServer.Shutdown(context.Background())
	}()

	return "localhost:" + port, nil
}
