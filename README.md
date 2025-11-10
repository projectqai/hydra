PROJECT-Q HYDRA
===============

Hydra is an open-source tactical coordination machine that connects heterogeneous sensors
and command systems into a unified internet of defense network.
It provides real-time sensor fusion, automated track correlation,
and coordinated response workflows - without replacing your existing systems.

![Hydra Screenshot](screenshot.png)

- Sensor Fusion: Correlate tracks from sensors
- Multi-Domain: Single architecture for CUAS, ground surveillance, and maritime awareness
- DDIL-Native: Peer-to-peer mesh continues operating when disconnected
- API-First: Every capability accessible via REST/gRPC; integrate in hours, not months 

## Getting started:

download hydra from https://github.com/projectqai/hydra/releases
and start with `./hydra` and open http://localhost:50051 in the browser

in examples/cuas there's a minimal example of a CUAS scenario, run with `bun examples/cuas/push-entities.ts`

## Documentation

- [ARCHITECTURE.md](ARCHITECTURE.md) - Detailed technical documentation of the message router architecture, including how gRPC messages are received, routed, and forwarded to subscribers
