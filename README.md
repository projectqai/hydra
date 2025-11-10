hydra the "world state machine", or "headless COP"
==================================================

Hydra is for geolocated threat awareness. connect off the shelf sensors and data sources to create a common operational picture.

For security reasons, contributions are invite-only at this time.

goals:

 - holds, stores, distributes entities, components and tracks.
 - provides a common, reliable api for multiple systems to exchange state information about these things
 - below 100ms distribution of event processing from inflow to outflow
 - recover from single hardware failure
 - provides hooks etc for analytics, observability, forensics

non-goals:

 - hard-realtime fire/weapons guidance




Working with Hydra
------------------

 - Download the binary or use `make`.
 - An out of the box demo is `./hydra --view`

