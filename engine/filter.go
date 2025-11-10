package engine

import (
	pb "github.com/projectqai/proto/go"

	"github.com/paulmach/orb"
)

func entityHasComponent(entity *pb.Entity, field uint32) bool {
	switch field {
	case 2:
		return entity.Label != nil
	case 3:
		return entity.Controller != nil
	case 4:
		return entity.Lifetime != nil
	case 5:
		return entity.Priority != nil
	case 11:
		return entity.Geo != nil
	case 12:
		return entity.Symbol != nil
	case 15:
		return entity.Camera != nil
	case 16:
		return entity.Detection != nil
	case 17:
		return entity.Bearing != nil
	case 20:
		return entity.LocationUncertainty != nil
	case 21:
		return entity.Track != nil
	case 22:
		return entity.Locator != nil
	case 23:
		return entity.Taskable != nil
	case 31:
		return entity.Config != nil
	}
	return false
}

func matchesComponentList(entity *pb.Entity, components []uint32) bool {
	if len(components) == 0 {
		return true
	}

	// Entity must have ALL specified components
	for _, field := range components {
		if !entityHasComponent(entity, field) {
			return false
		}
	}

	return true
}

func taskableContainsContext(taskable *pb.TaskableComponent, ctx *pb.TaskableContext) bool {
	if taskable == nil || ctx == nil || ctx.EntityId == nil {
		return false
	}
	for _, c := range taskable.Context {
		if c.EntityId != nil && *c.EntityId == *ctx.EntityId {
			return true
		}
	}
	return false
}

func taskableContainsAssignee(taskable *pb.TaskableComponent, assignee *pb.TaskableAssignee) bool {
	if taskable == nil || assignee == nil || assignee.EntityId == nil {
		return false
	}
	for _, a := range taskable.Assignee {
		if a.EntityId != nil && *a.EntityId == *assignee.EntityId {
			return true
		}
	}
	return false
}

func planarToOrb(planar *pb.PlanarGeometry) orb.Geometry {
	if planar == nil {
		return nil
	}

	switch p := planar.Plane.(type) {
	case *pb.PlanarGeometry_Point:
		if p.Point != nil {
			return orb.Point{p.Point.Longitude, p.Point.Latitude}
		}
	case *pb.PlanarGeometry_Line:
		if p.Line != nil && len(p.Line.Points) > 0 {
			line := make(orb.LineString, len(p.Line.Points))
			for i, pt := range p.Line.Points {
				line[i] = orb.Point{pt.Longitude, pt.Latitude}
			}
			return line
		}
	case *pb.PlanarGeometry_Polygon:
		if p.Polygon != nil && p.Polygon.Outer != nil && len(p.Polygon.Outer.Points) > 0 {
			outer := make(orb.Ring, len(p.Polygon.Outer.Points))
			for i, pt := range p.Polygon.Outer.Points {
				outer[i] = orb.Point{pt.Longitude, pt.Latitude}
			}
			poly := orb.Polygon{outer}

			// Add holes if present
			for _, hole := range p.Polygon.Holes {
				if len(hole.Points) > 0 {
					holeRing := make(orb.Ring, len(hole.Points))
					for i, pt := range hole.Points {
						holeRing[i] = orb.Point{pt.Longitude, pt.Latitude}
					}
					poly = append(poly, holeRing)
				}
			}
			return poly
		}
	}

	return nil
}

func entityIntersectsGeoFilter(entity *pb.Entity, geoFilter *pb.GeoFilter) bool {
	if geoFilter == nil {
		return true // no geo filter = match all
	}

	if entity.Geo == nil {
		return false
	}

	entityPoint := orb.Point{entity.Geo.Longitude, entity.Geo.Latitude}

	// Handle geometry-based filtering
	if geoFilter.Geo != nil {
		switch g := geoFilter.Geo.(type) {
		case *pb.GeoFilter_Geometry:
			if g.Geometry == nil || g.Geometry.Planar == nil {
				return true
			}

			filterGeom := planarToOrb(g.Geometry.Planar)
			if filterGeom == nil {
				return true
			}

			// Check if entity point intersects with filter geometry bounds
			entityBound := entityPoint.Bound()
			filterBound := filterGeom.Bound()
			return entityBound.Intersects(filterBound)

		case *pb.GeoFilter_GeoEntityId:
			// TODO: implement entity-based geo filtering
			// Would need to look up the referenced entity's geo bounds
			return true
		}
	}

	return true
}

func (s *WorldServer) matchesEntityFilter(entity *pb.Entity, filter *pb.EntityFilter) bool {
	if filter == nil {
		return true
	}

	// Handle OR filters
	if len(filter.Or) > 0 {
		for _, orFilter := range filter.Or {
			if s.matchesEntityFilter(entity, orFilter) {
				return true
			}
		}
		return false
	}

	// Handle NOT filter
	if filter.Not != nil {
		return !s.matchesEntityFilter(entity, filter.Not)
	}

	// ID filter (exact match)
	if filter.Id != nil && entity.Id != *filter.Id {
		return false
	}

	// Label filter (exact match)
	if filter.Label != nil {
		if entity.Label == nil || *entity.Label != *filter.Label {
			return false
		}
	}

	// Component filter (must have ALL specified components)
	if !matchesComponentList(entity, filter.Component) {
		return false
	}

	// Geo filter
	if !entityIntersectsGeoFilter(entity, filter.Geo) {
		return false
	}

	// Configuration filter
	if filter.Config != nil {
		if entity.Config == nil {
			return false
		}
		if filter.Config.Controller != nil && entity.Config.Controller != *filter.Config.Controller {
			return false
		}
		if filter.Config.Key != nil && entity.Config.Key != *filter.Config.Key {
			return false
		}
	}

	// Taskable filter
	if filter.Taskable != nil {
		if filter.Taskable.Context != nil {
			if !taskableContainsContext(entity.Taskable, filter.Taskable.Context) {
				return false
			}
		}
		if filter.Taskable.Assignee != nil {
			if !taskableContainsAssignee(entity.Taskable, filter.Taskable.Assignee) {
				return false
			}
		}
	}

	return true
}

func (s *WorldServer) matchesListEntitiesRequest(entity *pb.Entity, req *pb.ListEntitiesRequest) bool {
	return s.matchesEntityFilter(entity, req.Filter)
}
