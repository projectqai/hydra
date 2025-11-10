# Hydra Message Router Architecture

## Overview

Hydra is a soft-real-time message router and entity state manager that accepts gRPC messages and forwards them to interested parties using a publish-subscribe pattern. The system manages entity lifecycles, maintains relationships between entities, and provides real-time streaming of entity changes (sensor tracks, detections, alerts) with automatic fan-out to all connected clients.

**Key Characteristics:**
- **Entity State Management:** Maintains live state of all entities with automatic lifecycle management
- **Lifetime Enforcement:** Automatic expiration of entities based on temporal bounds
- **Entity Relations:** Tracks relationships between entities (detections-to-detectors, hierarchical positioning)
- **Entity Ownership:** Tracks which controller system has contributed which data to the picture
- **Sensor Fusion:** Supports track correlation from multiple sensor sources
- **OAuth 2.0 Authentication:** JWT-based authentication with OIDC provider integration
- **RBAC Authorization:** Role-based access control with geographic and entity-type restrictions
- **Audit Logging:** Comprehensive security event logging for compliance
- **Message Router:** In-memory pub/sub architecture with buffered channels
- **Non-blocking Delivery:** Timeout protection ensures slow subscribers don't block others
- **Real-time Streaming:** Server-streaming gRPC for live updates
- **Geographic Awareness:** Region-based filtering and observation tracking
- **Temporal Playback:** Timeline navigation with historical state reconstruction

## Message Flow

```
┌─────────────────────────────────────────────────────────────┐
│                    gRPC Clients                             │
└────────┬────────────────────────────────────────────────────┘
         │ Connect RPC (HTTP/2 on :50051)
         ▼
┌─────────────────────────────────────────────────────────────┐
│              Hydra Server (WorldServer)                     │
├─────────────────────────────────────────────────────────────┤
│  Incoming:  Push(EntityChangeRequest)                       │
│             └─> Store.Push()      [Timeline Storage]        │
│             └─> head[id] = entity [Live State]              │
│             └─> bus.publish()     [Event Distribution]      │
│                     │                                       │
│  Outgoing:          ▼                                       │
│  WatchEntities   Observer[1] ─> Channel ─> stream.Send()    │
│  ListEntities    Observer[2] ─> Channel ─> stream.Send()    │
│  GetEntity       Observer[N] ─> Channel ─> stream.Send()    │
│  Observe                                                    │
└─────────────────────────────────────────────────────────────┘
```

## What is an Entity?

Hydra uses an **Entity Component System (ECS)** architecture where entities are flexible, composable containers whose meaning and behavior emerge from the components they contain.

### Core Concept: Emergence over Classification

**An entity is nothing more than an ID with a collection of components.** There is no rigid type system or class hierarchy. Instead:

- **Entities** are universal containers identified by a unique string ID
- **Components** define capabilities, attributes, or characteristics
- **Meaning emerges** from which components are present

What something "is" depends on what components it has:
- An entity with location and symbology becomes a **map symbol**
- An entity with location and taskables is an **asset**
- An entity with a detector reference and bearing becomes a **detection**
- An entity with location and tracked-by marker becomes a **track**
- An entity with a camera url becomes a **camera view**

There is no `type` field. The system doesn't enforce semantics. Clients interpret meaning based on component presence.
It is entirely plausible and intended to have entities that have no visual representation, such as detections or sensor signals.

### Available Components

Entities compose from these building blocks:

| Component | Purpose |
|-----------|---------|
| **Lifetime**              | Temporal validity bounds (from/until timestamps) |
| **ControllerRef**         | Ownership by controlling system |
| **Priority**              | Quality of Service control for DDIL |
| **GeoSpatialComponent**   | Physical location in 3D space |
| **SymbolComponent**       | Visual representation (military symbology) |
| **DetectionComponent**    | Links to detector entity, classification metadata |
| **BearingComponent**      | Directional vector (azimuth, elevation) |
| **TrackComponent**        | Fused track metadata |
| **CameraComponent**       | Something that can be visually observed |
| **LocationUncertaintyComponent** | Spatial uncertainty geometry |

### Headless but with builtin UI

An important aspect is that hydra is headless, the UI can be completely or partially replaced with or run side by side with an automated system or a different UI.

The downstream system filters and interpret entities based on component presence:

- "Show me everything with a position" → filter for `geo` component
- "Show me all tracks" → filter for `track` component
- "Show me detections from sensor X" → filter for `detection.detectorEntityID == X`
- "Show me moving things" → filter for `geo` + `bearing` components
- "Show me camera views" → filter for `camera` component

Query logic operates on component presence, not entity types.

### Example: Sensor Fusion Emergence

Consider how sensor fusion works through component composition:

```
┌─────────────────────────────────────────────────────────────────┐
│                      SENSOR FUSION PIPELINE                     │
└─────────────────────────────────────────────────────────────────┘

Step 1: SENSORS (deployed assets)
┌──────────────────┐         ┌──────────────────┐
│ RF Sensor        │         │ Radar Sensor     │
│ ━━━━━━━━━━━━━━━━ │         │ ━━━━━━━━━━━━━━━━ │
│ id: rf-001       │         │ id: radar-001    │
│ geo: (lat,lon)   │         │ geo: (lat,lon)   │
│ symbol: "radar"  │         │ symbol: "radar"  │
└──────────────────┘         └──────────────────┘
        │                              │
        │ emits                        │ emits
        ▼                              ▼

Step 2: DETECTIONS (sensor activations)
┌──────────────────┐         ┌──────────────────┐
│ Detection A      │         │ Detection B      │
│ ━━━━━━━━━━━━━━━━ │         │ ━━━━━━━━━━━━━━━━ │
│ id: det-rf-001   │         │ id: det-rad-001  │
│ detection:       │         │ detection:       │
│   detectorID: rf │         │   detectorID: rad│
│ bearing: 180°    │         │ bearing: 182°    │
│ lifetime: 1.5s   │         │ lifetime: 1.5s   │
└──────────────────┘         └──────────────────┘
        │                              │
        └──────────┬───────────────────┘
                   │ correlation
                   ▼

Step 3: FUSED TRACK (correlated position)
        ┌──────────────────┐
        │ Correlated Track │
        │ ━━━━━━━━━━━━━━━━ │
        │ id: track-001    │
        │ geo: (fused pos) │
        │ symbol: "drone"  │
        │ track: {}        │
        │ lifetime: 5s     │
        └──────────────────┘
```

### Entity Lifecycle

Hydra is not just a message router - it actively manages entity state, enforces lifetimes, and maintains relationships between entities.
Entities are centrally garbage collected, depending on their lifecycle properties and state of the originating controller.

```
┌─────────────────────────────────────────────────────────────────┐
│                      ENTITY LIFECYCLE                           │
└─────────────────────────────────────────────────────────────────┘

BIRTH: Entity pushed via Push RPC
    │
    ├──> Store (timeline history)
    ├──> head map (live state)
    └──> Bus (broadcast to observers)
    │
    ▼
LIFE: Entity exists in system
    │
    ├─ Lifetime.from ────────────── Lifetime.until
    │  (becomes valid)               (expires)
    │
    ├─ Streamed to all WatchEntities subscribers
    ├─ Queryable via ListEntities
    └─ Referenced by other entities (via detectorID, locatorID, controller)
    │
    ▼
DEATH: Garbage collection triggers
    │
    ├─ Lifetime.until exceeded → EntityChangeExpired event
    ├─ Removed from head map (live state)
    ├─ Remains in Store (historical queries)
    └─ Broadcast expiration to observers
```

