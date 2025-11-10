package engine

import (
	"time"

	"github.com/projectqai/hydra/metrics"
)

func (s *WorldServer) EntityCount() int {
	s.l.RLock()
	defer s.l.RUnlock()
	return len(s.head)
}

func StartMetricsUpdater(server *WorldServer) {
	go func() {
		ticker := time.NewTicker(time.Second)
		defer ticker.Stop()
		for range ticker.C {
			count := server.EntityCount()
			metrics.SetEntityCount(count)
		}
	}()
}
