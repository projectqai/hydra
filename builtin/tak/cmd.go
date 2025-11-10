package view

import (
	"bufio"
	"context"
	"log/slog"
	"net"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/projectqai/hydra/builtin"
	"github.com/projectqai/hydra/goclient"
	pb "github.com/projectqai/proto/go"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
)

var (
	verbose     bool
	clientCount atomic.Int32
)

// Controller manages TAK server and multicast instances based on configuration entities
type Controller struct {
	serverURL string
	verbose   bool
	logger    *slog.Logger

	mu         sync.Mutex
	servers    map[string]*ServerInstance
	multicasts map[string]*MulticastInstance
}

// ServerInstance represents a running TCP server
type ServerInstance struct {
	entityID   string
	listenAddr string
	listener   net.Listener
	cancel     context.CancelFunc
	ctx        context.Context
}

// MulticastInstance represents a running UDP multicast broadcaster
type MulticastInstance struct {
	entityID      string
	multicastAddr string
	cancel        context.CancelFunc
	ctx           context.Context
}

func handleClient(conn net.Conn, serverURL string, logger *slog.Logger) {
	clientID := clientCount.Add(1)
	logger.Info("Client connected", "clientID", clientID, "remoteAddr", conn.RemoteAddr())

	defer conn.Close()
	defer func() {
		clientCount.Add(-1)
		logger.Info("Client disconnected", "clientID", clientID)
	}()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	grpcConn, err := grpc.NewClient(serverURL, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		logger.Error("gRPC connection failed", "clientID", clientID, "error", err)
		return
	}
	defer grpcConn.Close()

	client := pb.NewWorldServiceClient(grpcConn)

	// Start goroutine to read incoming data from TAK client
	go func() {
		defer cancel() // Signal main goroutine to exit when reader fails
		reader := bufio.NewReader(conn)
		buffer := make([]byte, 8192)
		for {
			select {
			case <-ctx.Done():
				return
			default:
			}

			n, err := reader.Read(buffer)
			if err != nil {
				logger.Error("Read error (client disconnected)", "clientID", clientID, "error", err)
				return
			}
			if n > 0 {
				logger.Info("Received bytes from TAK client", "clientID", clientID, "bytes", n)
				if verbose {
					logger.Debug("RAW STRING", "clientID", clientID, "data", string(buffer[:n]))
				}

				data := string(buffer[:n])

				// Respond to pings (type="t-x-c-t")
				if strings.Contains(data, `type="t-x-c-t"`) {
					logger.Debug("Detected ping, sending pong response", "clientID", clientID)
					// Echo the ping back as a pong
					if _, err := conn.Write(buffer[:n]); err != nil {
						logger.Error("Pong write error", "clientID", clientID, "error", err)
						return
					}
				}

				// Parse and push position reports (type="a-f-G-U-C" and similar)
				if strings.Contains(data, `type="a-`) && !strings.Contains(data, `type="t-`) {
					logger.Debug("Detected position report, parsing and pushing to Hydra", "clientID", clientID)
					entity, err := CoTToEntity(buffer[:n])
					if err != nil {
						logger.Error("Error parsing CoT", "clientID", clientID, "error", err)
					} else {
						logger.Debug("Parsed entity", "clientID", clientID, "id", entity.Id,
							"callsign", *entity.Label, "lat", entity.Geo.Latitude, "lon", entity.Geo.Longitude)

						// Push entity to Hydra
						_, err := client.Push(ctx, &pb.EntityChangeRequest{Changes: []*pb.Entity{entity}})
						if err != nil {
							logger.Error("Error pushing to Hydra", "clientID", clientID, "error", err)
						} else {
							logger.Info("Successfully pushed entity to Hydra", "clientID", clientID, "entityID", entity.Id)
						}
					}
				}
			}
		}
	}()
	stream, err := goclient.WatchEntitiesWithRetry(ctx, client, &pb.ListEntitiesRequest{})
	if err != nil {
		logger.Error("WatchEntities failed", "clientID", clientID, "error", err)
		return
	}

	writer := bufio.NewWriter(conn)
	sentCount := 0

	for {
		event, err := stream.Recv()
		if err != nil {
			logger.Error("Stream error", "clientID", clientID, "error", err)
			return
		}

		if event.Entity == nil {
			continue
		}

		cotXML, err := EntityToCoT(event.Entity)
		if err != nil {
			logger.Error("Error converting entity", "clientID", clientID, "entityID", event.Entity.Id, "error", err)
			continue
		}

		if cotXML == nil {
			continue
		}

		if verbose {
			logger.Debug("CoT XML", "clientID", clientID, "entityID", event.Entity.Id, "xml", string(cotXML))
		}

		logger.Info("Sending bytes to TAK client", "clientID", clientID, "bytes", len(cotXML))
		if _, err := writer.Write(cotXML); err != nil {
			logger.Error("Write error", "clientID", clientID, "error", err)
			return
		}

		if err := writer.Flush(); err != nil {
			logger.Error("Flush error", "clientID", clientID, "error", err)
			return
		}

		sentCount++
		if !verbose {
			logger.Info("Sent entity", "clientID", clientID, "entityID", event.Entity.Id, "total", sentCount)
		}
	}
}

// NewController creates a new TAK controller
func NewController(serverURL string, verbose bool, logger *slog.Logger) *Controller {
	return &Controller{
		serverURL:  serverURL,
		verbose:    verbose,
		logger:     logger,
		servers:    make(map[string]*ServerInstance),
		multicasts: make(map[string]*MulticastInstance),
	}
}

// Run starts the controller and watches for configuration entities
func (c *Controller) Run(ctx context.Context) error {
	grpcConn, err := grpc.NewClient(c.serverURL, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return err
	}
	defer grpcConn.Close()

	client := pb.NewWorldServiceClient(grpcConn)

	// Watch for configuration entities with controller="tak" and component 31 (ConfigurationComponent)
	stream, err := goclient.WatchEntitiesWithRetry(ctx, client, &pb.ListEntitiesRequest{
		Filter: &pb.EntityFilter{
			Component: []uint32{31}, // ConfigurationComponent field number
			Config: &pb.ConfigurationFilter{
				Controller: stringPtr("tak"),
			},
		},
	})
	if err != nil {
		return err
	}

	c.logger.Info("Watching for configuration entities")

	for {
		event, err := stream.Recv()
		if err != nil {
			return err
		}

		if event.Entity == nil || event.Entity.Config == nil {
			continue
		}

		entity := event.Entity
		config := entity.Config

		c.logger.Info("Configuration event", "type", event.T, "entityID", entity.Id, "key", config.Key)

		switch event.T {
		case pb.EntityChange_EntityChangeUpdated:
			c.handleConfigUpdate(ctx, entity, config)

		case pb.EntityChange_EntityChangeUnobserved:
		case pb.EntityChange_EntityChangeExpired:
		}
	}
}

// handleConfigUpdate creates or updates server/multicast instances based on config
func (c *Controller) handleConfigUpdate(ctx context.Context, entity *pb.Entity, config *pb.ConfigurationComponent) {
	switch config.Key {
	case "cot.server.v0":
		c.startServer(ctx, entity, config)
	case "cot.multicast.v0":
		c.startMulticast(ctx, entity, config)
	default:
		c.logger.Warn("Unknown configuration key", "key", config.Key)
	}
}

// handleConfigRemoval stops and removes instances when config entities expire
func (c *Controller) handleConfigRemoval(entityID string, key string) {
	c.mu.Lock()
	defer c.mu.Unlock()

	switch key {
	case "cot.server.v0":
		if instance, exists := c.servers[entityID]; exists {
			c.logger.Info("Stopping server (config entity expired)", "entityID", entityID)
			instance.cancel()
			if instance.listener != nil {
				instance.listener.Close()
			}
			delete(c.servers, entityID)
		}
	case "cot.multicast.v0":
		if instance, exists := c.multicasts[entityID]; exists {
			c.logger.Info("Stopping multicast (config entity expired)", "entityID", entityID)
			instance.cancel()
			delete(c.multicasts, entityID)
		}
	}
}

func (c *Controller) startServer(ctx context.Context, entity *pb.Entity, config *pb.ConfigurationComponent) {
	c.mu.Lock()
	defer c.mu.Unlock()

	if existing, exists := c.servers[entity.Id]; exists {
		c.logger.Info("Stopping existing server", "entityID", entity.Id)
		existing.cancel()
		if existing.listener != nil {
			existing.listener.Close()
		}
	}

	listenAddr := ":8088"
	if config.Value != nil && config.Value.Fields != nil {
		if addr, ok := config.Value.Fields["listen"]; ok {
			listenAddr = addr.GetStringValue()
		}
	}

	instanceCtx, cancel := context.WithCancel(ctx)
	if entity.Lifetime != nil && entity.Lifetime.Until != nil {
		instanceCtx, cancel = context.WithDeadline(ctx, entity.Lifetime.Until.AsTime())
		c.logger.Info("Server configured with expiry", "entityID", entity.Id, "expiresAt", entity.Lifetime.Until.AsTime())
	}

	instance := &ServerInstance{
		entityID:   entity.Id,
		listenAddr: listenAddr,
		cancel:     cancel,
		ctx:        instanceCtx,
	}

	c.servers[entity.Id] = instance

	go func() {
		defer cancel()
		defer func() {
			c.mu.Lock()
			delete(c.servers, entity.Id)
			c.mu.Unlock()
			c.logger.Info("TAK server stopped", "entityID", entity.Id)
		}()

		for {
			select {
			case <-instanceCtx.Done():
				reason := "cancelled"
				if instanceCtx.Err() == context.DeadlineExceeded {
					reason = "entity expired"
				}
				c.logger.Info("TAK server shutting down", "entityID", entity.Id, "reason", reason)
				return
			default:
			}

			c.logger.Info("Starting TAK server", "entityID", entity.Id, "listenAddr", listenAddr)

			listener, err := net.Listen("tcp", listenAddr)
			if err != nil {
				c.logger.Error("Failed to start server, retrying in 5s", "entityID", entity.Id, "listenAddr", listenAddr, "error", err)
				select {
				case <-instanceCtx.Done():
					return
				case <-time.After(5 * time.Second):
					continue
				}
			}

			c.mu.Lock()
			instance.listener = listener
			c.mu.Unlock()

			c.logger.Info("TAK server listening", "entityID", entity.Id, "listenAddr", listenAddr)

			// Spawn watcher to close listener when context is cancelled
			// This ensures Accept() is unblocked immediately on cancellation
			done := make(chan struct{})
			go func() {
				select {
				case <-instanceCtx.Done():
					listener.Close()
				case <-done:
				}
			}()

			acceptErr := false
			for {
				conn, err := listener.Accept()
				if err != nil {
					if instanceCtx.Err() != nil {
						// Context cancelled, clean shutdown
						close(done)
						listener.Close()
						return
					}
					c.logger.Error("Accept error, restarting server in 5s", "serverID", entity.Id, "error", err)
					acceptErr = true
					break
				}
				go handleClient(conn, c.serverURL, c.logger)
			}

			close(done)
			listener.Close()

			c.mu.Lock()
			instance.listener = nil
			c.mu.Unlock()

			if !acceptErr {
				return
			}

			select {
			case <-instanceCtx.Done():
				return
			case <-time.After(5 * time.Second):
				continue
			}
		}
	}()
}

func (c *Controller) startMulticast(ctx context.Context, entity *pb.Entity, config *pb.ConfigurationComponent) {
	c.mu.Lock()
	defer c.mu.Unlock()

	if existing, exists := c.multicasts[entity.Id]; exists {
		c.logger.Info("Stopping existing multicast", "entityID", entity.Id)
		existing.cancel()
	}

	multicastAddr := "239.2.3.1:6969" // default
	if config.Value != nil && config.Value.Fields != nil {
		if addr, ok := config.Value.Fields["address"]; ok {
			multicastAddr = addr.GetStringValue()
		}
	}

	instanceCtx, cancel := context.WithCancel(ctx)
	if entity.Lifetime != nil && entity.Lifetime.Until != nil {
		instanceCtx, cancel = context.WithDeadline(ctx, entity.Lifetime.Until.AsTime())
		c.logger.Info("Multicast configured with expiry", "entityID", entity.Id, "expiresAt", entity.Lifetime.Until.AsTime())
	}

	instance := &MulticastInstance{
		entityID:      entity.Id,
		multicastAddr: multicastAddr,
		cancel:        cancel,
		ctx:           instanceCtx,
	}

	c.multicasts[entity.Id] = instance

	go func() {
		defer cancel()
		defer func() {
			c.mu.Lock()
			delete(c.multicasts, entity.Id)
			c.mu.Unlock()
			c.logger.Info("UDP multicast stopped", "entityID", entity.Id)
		}()

		for {
			select {
			case <-instanceCtx.Done():
				reason := "cancelled"
				if instanceCtx.Err() == context.DeadlineExceeded {
					reason = "entity expired"
				}
				c.logger.Info("UDP multicast shutting down", "entityID", entity.Id, "reason", reason)
				return
			default:
			}

			c.logger.Info("Starting UDP multicast", "entityID", entity.Id, "multicastAddr", multicastAddr)

			err := c.runMulticastBroadcaster(instanceCtx, multicastAddr)
			if instanceCtx.Err() != nil {
				reason := "cancelled"
				if instanceCtx.Err() == context.DeadlineExceeded {
					reason = "entity expired"
				}
				c.logger.Info("UDP multicast stopped", "entityID", entity.Id, "reason", reason)
				return
			}

			c.logger.Error("Multicast error, retrying in 5s", "entityID", entity.Id, "error", err)
			select {
			case <-instanceCtx.Done():
				reason := "cancelled"
				if instanceCtx.Err() == context.DeadlineExceeded {
					reason = "entity expired"
				}
				c.logger.Info("UDP multicast stopped during retry", "entityID", entity.Id, "reason", reason)
				return
			case <-time.After(5 * time.Second):
				continue
			}
		}
	}()
}

func (c *Controller) runMulticastBroadcaster(ctx context.Context, multicastAddress string) error {
	multicastAddr, err := net.ResolveUDPAddr("udp", multicastAddress)
	if err != nil {
		return err
	}

	localAddr, err := net.ResolveUDPAddr("udp", "0.0.0.0:0")
	if err != nil {
		return err
	}

	udpConn, err := net.DialUDP("udp", localAddr, multicastAddr)
	if err != nil {
		return err
	}
	defer udpConn.Close()

	c.logger.Info("UDP multicast connection", "local", udpConn.LocalAddr(), "multicast", multicastAddress)

	grpcConn, err := grpc.NewClient(c.serverURL, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return err
	}
	defer grpcConn.Close()

	client := pb.NewWorldServiceClient(grpcConn)
	stream, err := goclient.WatchEntitiesWithRetry(ctx, client, &pb.ListEntitiesRequest{})
	if err != nil {
		return err
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

		if event.Entity == nil {
			continue
		}

		cotXML, err := EntityToCoT(event.Entity)
		if err != nil {
			c.logger.Error("Error converting entity", "entityID", event.Entity.Id, "error", err)
			continue
		}

		if cotXML == nil {
			continue
		}

		if c.verbose {
			c.logger.Debug("CoT XML", "entityID", event.Entity.Id, "xml", string(cotXML))
		}

		if _, err := udpConn.Write(cotXML); err != nil {
			c.logger.Error("UDP write error", "error", err)
			continue
		}

		sentCount++
		if !c.verbose {
			c.logger.Info("Broadcast entity", "entityID", event.Entity.Id, "total", sentCount)
		}
	}
}

func stringPtr(s string) *string {
	return &s
}

func Run(ctx context.Context, logger *slog.Logger, serverURL string) error {
	controller := NewController(serverURL, verbose, logger)
	return controller.Run(ctx)
}

func init() {
	builtin.Register("tak", Run)
}
