package engine

import (
	"github.com/paulmach/orb/encoding/wkb"
	proto "github.com/projectqai/proto/go"
)

func (s *WorldServer) addObservedGeom(g *proto.Geometry) {
	gg, err := wkb.Unmarshal(g.Wkb)
	if err != nil {
		return
	}

	s.l.Lock()
	defer s.l.Unlock()
	s.observed[g] = gg
}

func (s *WorldServer) removeObservedGeom(g *proto.Geometry) {
	s.l.Lock()
	defer s.l.Unlock()
	delete(s.observed, g)
}
