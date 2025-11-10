package hydra

import (
	"context"
	"fmt"
	"net/http"
	"sync"
	"time"

	_goconnect "github.com/projectqai/proto/go/_goconnect"

	"github.com/projectqai/hydra/engine"
	"github.com/projectqai/hydra/view"
	"github.com/rs/cors"
	"golang.org/x/net/http2"
	"golang.org/x/net/http2/h2c"
)

type EngineService struct {
	server     *http.Server
	engine     *engine.WorldServer
	ctx        context.Context
	cancelFunc context.CancelFunc
	mu         sync.Mutex
}

var globalService *EngineService

func StartEngine() string {
	if globalService != nil {
		return "Error: engine already running"
	}

	ctx, cancel := context.WithCancel(context.Background())
	service := &EngineService{
		ctx:        ctx,
		cancelFunc: cancel,
	}

	service.engine = engine.NewWorldServer()

	mux := http.NewServeMux()

	worldPath, worldHandler := _goconnect.NewWorldServiceHandler(service.engine)
	mux.Handle(worldPath, worldHandler)

	timelinePath, timelineHandler := _goconnect.NewTimelineServiceHandler(service.engine)
	mux.Handle(timelinePath, timelineHandler)

	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain")
		w.Write([]byte("OK"))
	})

	webServer, err := view.NewWebServer()
	if err == nil {
		mux.Handle("/", webServer)
	}

	corsHandler := cors.New(cors.Options{
		AllowedOrigins: []string{"*"},
		AllowedMethods: []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders: []string{"*"},
	})

	service.server = &http.Server{
		Addr:    ":50051",
		Handler: h2c.NewHandler(corsHandler.Handler(mux), &http2.Server{}),
	}

	go func() {
		if err := service.server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			fmt.Printf("Engine server error: %v\n", err)
		}
	}()

	time.Sleep(100 * time.Millisecond)
	globalService = service
	return "Engine started on :50051"
}

func StopEngine() string {
	if globalService == nil {
		return "Error: engine not running"
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := globalService.server.Shutdown(ctx); err != nil {
		return fmt.Sprintf("Error stopping engine: %v", err)
	}

	globalService.cancelFunc()
	globalService = nil

	return "Engine stopped"
}

func IsEngineRunning() bool {
	return globalService != nil
}

func GetEngineStatus() string {
	if globalService == nil {
		return "stopped"
	}
	return "running on :50051"
}
