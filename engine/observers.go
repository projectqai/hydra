package engine

import (
	"context"
	"encoding/binary"
	"log/slog"
	"maps"
	"slices"
	"strings"

	pb "github.com/projectqai/proto/go"

	"connectrpc.com/connect"
	"github.com/paulmach/orb"
	"github.com/paulmach/orb/encoding/wkb"
)

type observer struct {
	trace string
	C     chan busevent
}

func (s *WorldServer) WatchEntities(ctx context.Context, req *connect.Request[pb.ListEntitiesRequest], stream *connect.ServerStream[pb.EntityChangeEvent]) error {
	this := &observer{trace: "watchentities " + req.Peer().Addr}
	s.bus.observe(this)
	if req.Msg.Filter != nil && req.Msg.Filter.Geo != nil && req.Msg.Filter.Geo.Geo != nil {
		if geoMsg, ok := req.Msg.Filter.Geo.Geo.(*pb.GeoFilter_Geometry); ok && geoMsg.Geometry != nil {
			s.addObservedGeom(geoMsg.Geometry)
			s.bus.publish(busevent{trace: "watch added", observer: true})
		}
	}

	defer func() {
		s.bus.unobserve(this)
		if req.Msg.Filter != nil && req.Msg.Filter.Geo != nil && req.Msg.Filter.Geo.Geo != nil {
			if geoMsg, ok := req.Msg.Filter.Geo.Geo.(*pb.GeoFilter_Geometry); ok && geoMsg.Geometry != nil {
				s.removeObservedGeom(geoMsg.Geometry)
				s.bus.publish(busevent{trace: "watch removed", observer: true})
			}
		}
	}()

	// ui workaround
	stream.Send(&pb.EntityChangeEvent{
		T: pb.EntityChange_EntityChangeInvalid,
	})

	f := func() error {
		s.l.RLock()
		el := slices.Collect(maps.Values(s.head))
		s.l.RUnlock()
		slices.SortFunc(el, func(a, b *pb.Entity) int { return strings.Compare(a.Id, b.Id) })
		for _, e := range el {
			if !s.matchesListEntitiesRequest(e, req.Msg) {
				continue
			}
			if err := stream.Send(&pb.EntityChangeEvent{
				T:      pb.EntityChange_EntityChangeUpdated,
				Entity: e,
			}); err != nil {
				return err
			}
		}

		return nil
	}

	err := f()
	if err != nil {
		return err
	}

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case ev, ok := <-this.C:
			if !ok {
				return nil
			}
			if ev.entity == nil {
				continue
			}
			if !s.matchesListEntitiesRequest(ev.entity.Entity, req.Msg) {
				continue
			}
			if err := stream.Send(ev.entity); err != nil {
				return err
			}
		}
	}
}

func (s *WorldServer) Observe(
	ctx context.Context,
	req *connect.Request[pb.ObserverRequest],
	stream *connect.ServerStream[pb.ObserverState],
) error {
	this := &observer{trace: "observe"}
	s.bus.observe(this)

	defer func() {
		s.bus.unobserve(this)
	}()

	f := func() error {
		col := orb.Collection{}

		s.l.RLock()
		for _, v := range s.observed {
			col = append(col, v)
		}
		s.l.RUnlock()

		wkb, err := wkb.Marshal(col, binary.LittleEndian)
		if err != nil {
			slog.Warn("wkb encoding failed in observe", "err", err)
			return nil
		}

		stream.Send(&pb.ObserverState{
			Geo: &pb.Geometry{Wkb: wkb},
		})

		return nil
	}

	err := f()
	if err != nil {
		return err
	}

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case ev, ok := <-this.C:
			if !ok {
				return nil
			}
			if ev.observer {
				f()
			}
		}
	}
}
