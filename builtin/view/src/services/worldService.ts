import { createPromiseClient } from '@connectrpc/connect';
import { createConnectTransport } from '@connectrpc/connect-web';
import { WorldService as WorldServiceDef } from '../proto/world_connect';
import { ListEntitiesRequest, EntityChangeEvent, Geometry, GetEntityRequest, GetEntityResponse, EntityChangeRequest, EntityChangeResponse, Entity } from '../proto/world_pb';

export class WorldService {
	private client: any;
	private watchController: AbortController | null = null;
	private currentWatchPromise: Promise<void> | null = null;
	private shouldReconnect: boolean = false;
	private lastGeometry: Geometry | null = null;
	private lastOnEntityEvent: ((event: EntityChangeEvent) => void) | null = null;
	private lastOnError: ((error: Error) => void) | undefined;
	private isStarting: boolean = false;

	constructor(baseUrl: string = import.meta.env.DEV ? 'http://localhost:50051' : window.location.origin) {
		const transport = createConnectTransport({
			baseUrl,
			useBinaryFormat: false,
			useHttpGet: false,
		});

		this.client = createPromiseClient(WorldServiceDef, transport);
	}

	async startWatching(
		geometry: Geometry,
		onEntityEvent: (event: EntityChangeEvent) => void,
		onError?: (error: Error) => void
	): Promise<void> {
		// Prevent concurrent starts
		if (this.isStarting) {
			return;
		}

		this.isStarting = true;

		try {
			// Wait for any existing watch to fully stop before starting a new one
			if (this.currentWatchPromise) {
				this.stopWatching();
				await this.currentWatchPromise;
			}

			// Store for reconnection
			this.shouldReconnect = true;
			this.lastGeometry = geometry;
			this.lastOnEntityEvent = onEntityEvent;
			this.lastOnError = onError;
		} finally {
			this.isStarting = false;
		}

		this.watchController = new AbortController();
		const controller = this.watchController;

		// Store the promise so we can await it when stopping
		this.currentWatchPromise = (async () => {
			let connected = false;
			try {
				const request = new ListEntitiesRequest({
					geo: geometry
				});

				const stream = this.client.watchEntities(
					request,
					{ signal: controller.signal }
				);

				// Handle incoming entity events
				for await (const event of stream) {
					if (!connected) {
						console.log('Connected');
						connected = true;
					}
					onEntityEvent(event);
				}
			} catch (error) {
				const errorMsg = (error as any)?.message || '';
				const errorCode = (error as any)?.code || '';
				const isAbortError = (error as any)?.name === 'AbortError' ||
					errorCode === 'canceled' ||
					errorMsg.includes('aborted') ||
					errorMsg.includes('canceled');

				// Ignore abort errors as they're expected when stopping
				if (!isAbortError) {
					console.error('Stream error:', error);
					if (onError) {
						onError(error as Error);
					}

					// Reconnect if we should
					if (this.shouldReconnect && this.lastGeometry && this.lastOnEntityEvent) {
						console.log('Reconnecting...');
						// Clear current promise so startWatching can proceed
						this.watchController = null;
						this.currentWatchPromise = null;
						await new Promise(resolve => setTimeout(resolve, 1000));
						if (this.shouldReconnect && this.lastGeometry && this.lastOnEntityEvent) {
							await this.startWatching(this.lastGeometry, this.lastOnEntityEvent, this.lastOnError);
						}
					}
				}
			} finally {
				if (!this.shouldReconnect) {
					this.watchController = null;
					this.currentWatchPromise = null;
				}
			}
		})();

		return this.currentWatchPromise;
	}

	stopWatching(): void {
		this.shouldReconnect = false;
		if (this.watchController) {
			this.watchController.abort();
			this.watchController = null;
		}
	}

	async getEntity(entityId: string): Promise<GetEntityResponse> {
		const request = new GetEntityRequest({
			id: entityId
		});

		return await this.client.getEntity(request);
	}

	async pushEntity(entity: Entity): Promise<EntityChangeResponse> {
		const request = new EntityChangeRequest({
			changes: [entity]
			// changeid property no longer exists in EntityChangeRequest
		});

		return await this.client.push(request);
	}
}

// Helper function to convert Leaflet bounds to WKB Polygon geometry
export function boundsToGeometry(bounds: L.LatLngBounds): Geometry {
	const sw = bounds.getSouthWest();
	const ne = bounds.getNorthEast();

	// Create a simple WKB polygon for the bounding box
	// WKB format for Polygon:
	// - byte order (1 byte): 0x01 for little-endian
	// - geometry type (4 bytes): 0x03000000 for Polygon
	// - num rings (4 bytes)
	// - num points per ring (4 bytes)
	// - points (16 bytes each: 8 bytes for X/longitude, 8 bytes for Y/latitude)

	const numRings = 1;
	const numPoints = 5; // 5 points to close the polygon

	// Calculate buffer size: 1 + 4 + 4 + 4 + (5 * 16)
	const buffer = new ArrayBuffer(1 + 4 + 4 + 4 + (numPoints * 16));
	const view = new DataView(buffer);
	let offset = 0;

	// Byte order (little-endian)
	view.setUint8(offset, 0x01);
	offset += 1;

	// Geometry type (Polygon = 3)
	view.setUint32(offset, 3, true);
	offset += 4;

	// Number of rings
	view.setUint32(offset, numRings, true);
	offset += 4;

	// Number of points in the ring
	view.setUint32(offset, numPoints, true);
	offset += 4;

	// Points (longitude, latitude pairs)
	const points = [
		[sw.lng, sw.lat],
		[ne.lng, sw.lat],
		[ne.lng, ne.lat],
		[sw.lng, ne.lat],
		[sw.lng, sw.lat], // Close the ring
	];

	for (const [lng, lat] of points) {
		view.setFloat64(offset, lng, true);
		offset += 8;
		view.setFloat64(offset, lat, true);
		offset += 8;
	}

	return new Geometry({
		wkb: new Uint8Array(buffer)
	});
}
