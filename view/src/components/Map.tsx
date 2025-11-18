import { onMount, onCleanup, createSignal, createMemo } from 'solid-js';
import * as L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import milsymbol from 'milsymbol';
import { WorldService, boundsToGeometry } from '../services/worldService';
import { TimelineService } from '../services/timelineService';
import { EntityChangeEvent } from '../proto/world_pb';
import { GetTimelineResponse } from '../proto/timeline_pb';
import { Timestamp } from '@bufbuild/protobuf';
import EntitySidebar from './EntitySidebar';

interface MapProps {
	center?: [number, number];
	zoom?: number;
	height?: string;
}

type ConnectionState = 'disconnected' | 'connecting' | 'connected';

export default function Map(props: MapProps) {
	let mapContainer!: HTMLDivElement;
	let map: L.Map | undefined;
	let worldService: WorldService | undefined;
	let timelineService: TimelineService | undefined;
	let entityMarkers = new globalThis.Map<string, L.Marker>();
	let entityTrails = new globalThis.Map<string, L.Polyline>();
	let missionTrails = new globalThis.Map<string, L.Polyline>();
	let symbolCache = new globalThis.Map<string, string>(); // Cache for generated SVG symbols
	const [connectionState, setConnectionState] = createSignal<ConnectionState>('disconnected');
	const [timeline, setTimeline] = createSignal<GetTimelineResponse | null>(null);
	const [isPlaying, setIsPlaying] = createSignal<boolean>(false);
	const [frontendTimelinePosition, setFrontendTimelinePosition] = createSignal<number | null>(null);
	const [selectedEntity, setSelectedEntity] = createSignal<any | null>(null);
	const [isEntitySidebarOpen, setIsEntitySidebarOpen] = createSignal<boolean>(false);
	const [isMovingEntity, setIsMovingEntity] = createSignal<boolean>(false);
	const [movingEntityPosition, setMovingEntityPosition] = createSignal<[number, number] | null>(null);
	const [isFollowingEntity, setIsFollowingEntity] = createSignal<boolean>(false);
	let playbackInterval: number | undefined;
		let mapMoveDebounceTimeout: number | undefined;
	let urlUpdateDebounceTimeout: number | undefined;
	let suppressUrlUpdate = false;
	
	const timestampToMs = (timestamp: Timestamp | undefined): number => {
		if (!timestamp) return 0;
		return Number(timestamp.seconds) * 1000 + Number(timestamp.nanos || 0) / 1000000;
	};

	const msToTimestamp = (ms: number): Timestamp => {
		const seconds = Math.floor(ms / 1000);
		const nanos = Math.floor((ms % 1000) * 1000000);
		return new Timestamp({ seconds: BigInt(seconds), nanos });
	};

	const handleEntityClick = async (entity: any) => {
		setSelectedEntity(entity);
		setIsEntitySidebarOpen(true);
	};

	const handleMapClick = (e?: L.LeafletMouseEvent) => {
		// Cancel follow mode on any map click
		if (isFollowingEntity()) {
			setIsFollowingEntity(false);
		}
		
		if (isMovingEntity() && e) {
			// Complete the move operation
			completeMoveEntity(e.latlng);
		} else {
			setIsEntitySidebarOpen(false);
			setSelectedEntity(null);
		}
	};

	const startFollowEntity = () => {
		const entity = selectedEntity();
		if (!entity?.geo) return;
		
		setIsFollowingEntity(true);
		
		// Center map on entity
		if (map) {
			map.setView([entity.geo.latitude, entity.geo.longitude], map.getZoom(), { animate: true });
		}
	};

	const stopFollowEntity = () => {
		setIsFollowingEntity(false);
	};

	const startMoveEntity = () => {
		const entity = selectedEntity();
		if (!entity?.geo) return;
		
		// Disable follow mode when starting move
		setIsFollowingEntity(false);
		
		setIsMovingEntity(true);
		setMovingEntityPosition([entity.geo.latitude, entity.geo.longitude]);
		
		// Change cursor to indicate move mode
		if (map) {
			map.getContainer().style.cursor = 'crosshair';
		}
	};

	const cancelMoveEntity = () => {
		setIsMovingEntity(false);
		setMovingEntityPosition(null);
		
		// Reset cursor
		if (map) {
			map.getContainer().style.cursor = '';
		}
	};


	const completeMoveEntity = async (newLatLng: L.LatLng) => {
		const entity = selectedEntity();
		if (!entity || !worldService) return;

		try {
			// Create updated entity with new position
			const updatedEntity = { ...entity };
			updatedEntity.geo = {
				...entity.geo,
				latitude: newLatLng.lat,
				longitude: newLatLng.lng
			};

			// Send Push call to update entity
			await worldService.pushEntity(updatedEntity);
			
			// Update local state
			setSelectedEntity(updatedEntity);
			
		} catch (error) {
			console.error('Error updating entity position:', error);
		} finally {
			cancelMoveEntity();
		}
	};



	const handleReturn = async () => {
		if (!timelineService || !timeline()) return;

		try {
			stopPlayback();
			setFrontendTimelinePosition(null); // Clear frontend position to return to backend control
			await timelineService.moveTimeline(false);
		} catch (error) {
			console.error('Error returning to live:', error);
		}
	};

	const stopPlayback = () => {
		if (playbackInterval) {
			clearInterval(playbackInterval);
			playbackInterval = undefined;
		}
		setIsPlaying(false);
	};

	const handlePlayPause = async () => {
		if (!timeline()) return;

		if (isPlaying()) {
			stopPlayback();
		} else {
			setIsPlaying(true);

			playbackInterval = setInterval(async () => {
				const currentMs = frontendTimelinePosition() ?? timestampToMs(timeline()?.at);
				const maxMs = timestampToMs(timeline()?.max);
				const newMs = currentMs + 500;

				if (newMs >= maxMs) {
					stopPlayback();
					return;
				}

				try {
					setFrontendTimelinePosition(newMs); // Update frontend position
					const timestamp = msToTimestamp(newMs);
					await timelineService?.moveTimeline(true, timestamp);
				} catch (error) {
					console.error('Error advancing timeline:', error);
					stopPlayback();
				}
			}, 100); // Update every 100ms for smoother playback
		}
	};


	const handleTimelineMove = async (ms: number) => {
		if (!timelineService) return;

		try {
			setFrontendTimelinePosition(ms); // Update frontend position
			//clearAllMarkers();
			const timestamp = msToTimestamp(ms);
			await timelineService.moveTimeline(true, timestamp);
		} catch (error) {
			console.error('Error moving timeline:', error);
		}
	};

	const getSymbolFromEntity = (entity: any): string | null => {
		// Use the symbol component with milStd2525C code
		if (entity.symbol?.milStd2525C) {
			return entity.symbol.milStd2525C;
		}

		// No default symbol - return null if no symbol component
		return null;
	};

	const isEntityExpired = (entity: any): boolean => {
		if (!entity.lifetime?.until) {
			return false;
		}

		const untilMs = Number(entity.lifetime.until.seconds) * 1000 +
			Number(entity.lifetime.until.nanos || 0) / 1000000;

		// Use frontend position if available, otherwise backend timeline time, otherwise current time
		const currentTime = timeline()?.frozen
			? (frontendTimelinePosition() ?? timestampToMs(timeline()?.at))
			: Date.now();

		return currentTime > untilMs;
	};

	const createBearingArrowSvg = (azimuth: number, elevation?: number): string => {
		// Create an arrow pointing in the direction of the bearing
		const arrowStartDistance = 20; // Start arrow away from center
		const arrowLength = 60; // Length of the arrow from start point
		const arrowWidth = 4;

		// Convert azimuth to radians (0° = North, clockwise)
		const azimuthRadians = (azimuth * Math.PI) / 180;

		// Center the SVG viewBox on the symbol
		const centerX = 75;
		const centerY = 75;

		// Calculate arrow start point (away from symbol)
		const startX = centerX + Math.sin(azimuthRadians) * arrowStartDistance;
		const startY = centerY - Math.cos(azimuthRadians) * arrowStartDistance;

		// Calculate arrow end point
		const endX = centerX + Math.sin(azimuthRadians) * (arrowStartDistance + arrowLength);
		const endY = centerY - Math.cos(azimuthRadians) * (arrowStartDistance + arrowLength);

		// Calculate arrowhead points
		const headLength = 8;
		const headAngle = Math.PI / 6; // 30 degrees

		const headLeft = {
			x: endX - headLength * Math.sin(azimuthRadians - headAngle),
			y: endY + headLength * Math.cos(azimuthRadians - headAngle)
		};
		const headRight = {
			x: endX - headLength * Math.sin(azimuthRadians + headAngle),
			y: endY + headLength * Math.cos(azimuthRadians + headAngle)
		};

		// Color based on elevation if present (red = looking down, blue = looking up, yellow = level)
		let color = '#FFD700'; // Default yellow
		if (elevation !== undefined) {
			if (elevation < -10) {
				color = '#FF4444'; // Red for looking down
			} else if (elevation > 10) {
				color = '#4444FF'; // Blue for looking up
			}
		}

		return `<svg width="150" height="150" viewBox="0 0 150 150" xmlns="http://www.w3.org/2000/svg" style="position: absolute; top: -60px; left: -60px; pointer-events: none; z-index: 0;">
			<line x1="${startX}" y1="${startY}" x2="${endX}" y2="${endY}" stroke="${color}" stroke-width="${arrowWidth}" stroke-linecap="round" opacity="0.8"/>
			<polygon points="${endX},${endY} ${headLeft.x},${headLeft.y} ${headRight.x},${headRight.y}" fill="${color}" opacity="0.8"/>
		</svg>`;
	};

	const getCachedSymbolSvg = (symbolCode: string, _entity: any): string => {
		// entity.track no longer exists - use symbolCode only for cache key
		const cacheKey = `${symbolCode}-0`;

		if (symbolCache.has(cacheKey)) {
			return symbolCache.get(cacheKey)!;
		}

		let symbolSvg: string;

		if (symbolCode) {
			// Create milsymbol icon for entities with symbols
			const symbolIcon = new milsymbol.Symbol(symbolCode, {
				size: 30,
				fill: true,
				frame: true
			});

			if (!symbolIcon.isValid()) {
				console.warn(`Invalid SIDC code: ${symbolCode} for entity`);
			}

			symbolSvg = symbolIcon.asSVG();
		}
		// entity.track no longer exists - commented out track-based dot rendering
		// else if (entity.track) {
		// 	// Create small dot with direction line for TrackComponent entities
		// 	const azimuth = entity.track.azimuth || 0;
		// 	const azimuthRadians = (azimuth * Math.PI) / 180;
		// 	const lineLength = 15;
		// 	const endX = Math.sin(azimuthRadians) * lineLength;
		// 	const endY = -Math.cos(azimuthRadians) * lineLength;
		//
		// 	symbolSvg = `<svg width="20" height="20" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
        // <circle cx="10" cy="10" r="3" fill="#ff6b6b" stroke="#fff" stroke-width="1"/>
        // <line x1="10" y1="10" x2="${10 + endX}" y2="${10 + endY}" stroke="#ff6b6b" stroke-width="2" stroke-linecap="round"/>
        // </svg>`;
		// }
		else {
			symbolSvg = '';
		}

		symbolCache.set(cacheKey, symbolSvg);
		return symbolSvg;
	};

	const updateMarkerContent = (marker: L.Marker, iconHtml: string, iconSizeValue: [number, number], iconAnchorValue: [number, number]) => {
		const icon = marker.getIcon() as L.DivIcon;
		const element = marker.getElement();

		if (element && icon.options.html !== iconHtml) {
			element.innerHTML = iconHtml;
			// Update icon options for consistency
			(icon.options as any).html = iconHtml;
			(icon.options as any).iconSize = iconSizeValue;
			(icon.options as any).iconAnchor = iconAnchorValue;
		}
	};

	const handleEntityEvent = (event: EntityChangeEvent) => {
		// Mark as connected on first event
		if (connectionState() !== 'connected') {
			setConnectionState('connected');
		}

		if (!map || !event.entity) {
			return;
		}

		const entityId = event.entity.id;

		try {
			// Check if entity has expired or has no geo data
			if (isEntityExpired(event.entity) || !event.entity.geo) {
				// Remove entity from map
				const existingMarker = entityMarkers.get(entityId);
				if (existingMarker) {
					map.removeLayer(existingMarker);
					entityMarkers.delete(entityId);
				}
				const existingTrail = entityTrails.get(entityId);
				if (existingTrail) {
					map.removeLayer(existingTrail);
					entityTrails.delete(entityId);
				}
				// Clear selection if the removed entity was selected
				if (selectedEntity()?.id === entityId) {
					setSelectedEntity(null);
					setIsEntitySidebarOpen(false);
				}
				return;
			}

			// Update selected entity if it matches the current entity
			if (selectedEntity()?.id === entityId) {
				setSelectedEntity(event.entity);
				
				// If following this entity, center map on its new position
				if (isFollowingEntity()) {
					map.setView([event.entity.geo.latitude, event.entity.geo.longitude], map.getZoom(), { animate: true });
				}
			}

			const { latitude, longitude } = event.entity.geo;
			const symbolCode = getSymbolFromEntity(event.entity);

			// entity.track no longer exists - skip entities without symbols
			// if (!symbolCode && !event.entity.track) {
			if (!symbolCode) {
				return;
			}

			// Get cached symbol SVG
			const symbolSvg = getCachedSymbolSvg(symbolCode || '', event.entity);

			// Build label text efficiently
			// entity.description no longer exists - use empty string
			const entityName = '';
			// entity.track no longer exists - elevation and speed no longer available
			// const elevation = event.entity.track?.elevation;
			// const speed = event.entity.track?.speed;
			const elevation = undefined;
			const speed = undefined;

			let labelText = entityName;
			if (elevation !== undefined || speed !== undefined) {
				const details: string[] = [];
				if (elevation !== undefined) details.push(`${Math.round(elevation)}m`);
				if (speed !== undefined) details.push(`${Math.round(speed)}kts`);

				if (labelText) {
					labelText += ` (${details.join(', ')})`;
				} else {
					labelText = details.join(', ');
				}
			}

			// Calculate sizes and anchors
			// entity.track no longer exists
			// const isTrackOnly = !symbolCode && event.entity.track;
			const isTrackOnly = false;
			const symbolSize = isTrackOnly ? 20 : 30;
			const anchor = isTrackOnly ? 10 : 15;

			// Check if entity has bearing component
			const hasBearing = event.entity.bearing?.azimuth !== undefined;
			const bearingArrowSvg = hasBearing
				? createBearingArrowSvg(event.entity.bearing!.azimuth!, event.entity.bearing?.elevation)
				: '';

			let iconHtml: string;
			let iconSizeValue: [number, number];
			let iconAnchorValue: [number, number];

			if (labelText) {
				iconHtml = `<div style="display: flex; align-items: center; gap: 4px; width: max-content; background: transparent;">
             <div style="position: relative; width: ${symbolSize}px; height: ${symbolSize}px; flex-shrink: 0;">
               ${bearingArrowSvg}
               <div style="position: relative; z-index: 1;">${symbolSvg}</div>
             </div>
             <span style="font-size: 12px; font-weight: 500; color: #fff; text-shadow: 1px 1px 2px rgba(0,0,0,0.8), -1px -1px 2px rgba(0,0,0,0.8), 1px -1px 2px rgba(0,0,0,0.8), -1px 1px 2px rgba(0,0,0,0.8); padding: 2px 4px; white-space: nowrap; font-family: 'CommitMono', monospace;">${labelText}</span>
           </div>`;
				iconSizeValue = [200, symbolSize];
				iconAnchorValue = [anchor, anchor];
			} else {
				iconHtml = `<div style="position: relative; width: ${symbolSize}px; height: ${symbolSize}px;">
             ${bearingArrowSvg}
             <div style="position: relative; z-index: 1;">${symbolSvg}</div>
           </div>`;
				iconSizeValue = [symbolSize, symbolSize];
				iconAnchorValue = [anchor, anchor];
			}

			// Try to reuse existing marker instead of creating new one
			const existingMarker = entityMarkers.get(entityId);
			if (existingMarker) {
				// Update position if changed
				const currentLatLng = existingMarker.getLatLng();
				if (currentLatLng.lat !== latitude || currentLatLng.lng !== longitude) {
					existingMarker.setLatLng([latitude, longitude]);
				}

				// Update marker content
				updateMarkerContent(existingMarker, iconHtml, iconSizeValue, iconAnchorValue);

				// Update entity data
				(existingMarker as any)._entityData = event.entity;
			} else {
				// Create new marker only if none exists
				const marker = L.marker([latitude, longitude], {
					icon: L.divIcon({
						html: iconHtml,
						className: 'milsymbol-icon',
						iconSize: iconSizeValue,
						iconAnchor: iconAnchorValue,
						popupAnchor: [0, -15]
					})
				}).addTo(map);

				(marker as any)._entityData = event.entity;
				marker.on('click', (e) => {
					if (e.originalEvent) {
						e.originalEvent.stopPropagation();
						e.originalEvent.preventDefault();
					}
					L.DomEvent.stopPropagation(e);
					handleEntityClick(event.entity);
				});
				entityMarkers.set(entityId, marker);
			}

			// Handle trail updates more efficiently
			// entity.track no longer exists - trail functionality disabled
			// const hasTrail = event.entity.track?.trail && event.entity.track.trail.length > 1;
			// const existingTrail = entityTrails.get(entityId);

			// if (hasTrail) {
			// 	const trailPoints: [number, number][] = event.entity.track!.trail.map((point: any) =>
			// 		[point.latitude, point.longitude]
			// 	);

			// 	if (existingTrail) {
			// 		// Update existing trail
			// 		existingTrail.setLatLngs(trailPoints);
			// 	} else {
			// 		// Create new trail
			// 		const trail = L.polyline(trailPoints, {
			// 			color: '#000000',
			// 			weight: 2,
			// 			opacity: 0.7
			// 		}).addTo(map);

			// 		entityTrails.set(entityId, trail);
			// 	}
			// } else if (existingTrail) {
			// 	// Remove trail if entity no longer has one
			// 	map.removeLayer(existingTrail);
			// 	entityTrails.delete(entityId);
			// }

			// Handle mission waypoint trails
			// entity.mission no longer exists - mission functionality disabled
			// const hasMission = event.entity.mission?.waypoints && event.entity.mission.waypoints.length > 1;
			// const existingMissionTrail = missionTrails.get(entityId);

			// if (hasMission) {
			// 	console.log('First waypoint object:', event.entity.mission!.waypoints[0]);
			// 	const waypointPoints: [number, number][] = event.entity.mission!.waypoints.map((waypoint: any) =>
			// 		[waypoint.latitude, waypoint.longitude]
			// 	);

			// 	if (existingMissionTrail) {
			// 		// Update existing mission trail
			// 		existingMissionTrail.setLatLngs(waypointPoints);
			// 	} else {
			// 		// Create new mission trail
			// 		const missionTrail = L.polyline(waypointPoints, {
			// 			color: '#0066ff',    // Blue color
			// 			weight: 2,
			// 			opacity: 0.8,
			// 			dashArray: '10, 5'   // Dashed line to distinguish from track history
			// 		}).addTo(map);

			// 		missionTrails.set(entityId, missionTrail);
			// 	}
			// } else if (existingMissionTrail) {
			// 	// Remove mission trail if entity no longer has one
			// 	map.removeLayer(existingMissionTrail);
			// 	missionTrails.delete(entityId);
			// }

		} catch (error) {
			console.error('Error handling entity event:', error);
		}
	};

	const clearAllMarkers = () => {
		if (!map) return;

		// Batch remove all markers and trails at once
		const markersToRemove = Array.from(entityMarkers.values());
		const trailsToRemove = Array.from(entityTrails.values());
		const missionTrailsToRemove = Array.from(missionTrails.values());

		markersToRemove.forEach(marker => map!.removeLayer(marker));
		trailsToRemove.forEach(trail => map!.removeLayer(trail));
		missionTrailsToRemove.forEach(missionTrail => map!.removeLayer(missionTrail));

		entityMarkers.clear();
		entityTrails.clear();
		missionTrails.clear();
		// Clear symbol cache when clearing all markers
		symbolCache.clear();
		// Don't clear selection during map view changes - let the entity sidebar handle timeout logic
	};

	const cleanupExpiredEntities = () => {
		if (!map) return;

		// Batch collect expired entities to minimize DOM operations
		const expiredEntities: string[] = [];

		entityMarkers.forEach((marker, entityId) => {
			const markerEntity = (marker as any)._entityData;
			if (markerEntity && isEntityExpired(markerEntity)) {
				expiredEntities.push(entityId);
			}
		});

		// Remove expired entities in batch
		expiredEntities.forEach(entityId => {
			const marker = entityMarkers.get(entityId);
			if (marker) {
				map!.removeLayer(marker);
				entityMarkers.delete(entityId);
			}

			const trail = entityTrails.get(entityId);
			if (trail) {
				map!.removeLayer(trail);
				entityTrails.delete(entityId);
			}

			const missionTrail = missionTrails.get(entityId);
			if (missionTrail) {
				map!.removeLayer(missionTrail);
				missionTrails.delete(entityId);
			}
		});
	};

	const debouncedUrlUpdate = () => {
		if (urlUpdateDebounceTimeout) {
			clearTimeout(urlUpdateDebounceTimeout);
		}
		
		urlUpdateDebounceTimeout = setTimeout(() => {
			updateUrlFromMapView();
			urlUpdateDebounceTimeout = undefined;
		}, 300); // 300ms debounce for URL updates
	};

	const updateUrlFromMapView = () => {
		if (!map || suppressUrlUpdate) return;
		
		const center = map.getCenter();
		const zoom = map.getZoom();
		
		const url = new URL(window.location.href);
		url.searchParams.set('lat', center.lat.toFixed(6));
		url.searchParams.set('lng', center.lng.toFixed(6));
		url.searchParams.set('z', zoom.toString());
		
		window.history.replaceState(null, '', url.toString());
	};

	const parseUrlParams = () => {
		const url = new URL(window.location.href);
		const lat = parseFloat(url.searchParams.get('lat') || '');
		const lng = parseFloat(url.searchParams.get('lng') || '');
		const zoom = parseInt(url.searchParams.get('z') || '');
		
		return {
			lat: isNaN(lat) ? null : lat,
			lng: isNaN(lng) ? null : lng,
			zoom: isNaN(zoom) ? null : zoom
		};
	};

	const debouncedStartWatching = () => {
		if (mapMoveDebounceTimeout) {
			clearTimeout(mapMoveDebounceTimeout);
		}
		
		mapMoveDebounceTimeout = setTimeout(() => {
			startWatchingCurrentView();
			mapMoveDebounceTimeout = undefined;
		}, 500); // 500ms debounce
	};

	const startWatchingCurrentView = () => {
		if (!map || !worldService) return;

		try {
			const bounds = map.getBounds();
			const geometry = boundsToGeometry(bounds);

			// Clear markers before starting new watch
			clearAllMarkers();

			// Set connecting state
			setConnectionState('connecting');

			// Stop any existing watch and start a new one for the current view
			worldService.startWatching(
				geometry,
				handleEntityEvent,
				(error) => {
					// Ignore abort/canceled errors
					if (!(error as any)?.message?.includes('aborted') &&
						!(error as any)?.message?.includes('canceled')) {
						console.error('Watch stream error:', error);
						setConnectionState('disconnected');
					}
				}
			);
		} catch (error) {
			console.error('Error starting watch for current view:', error);
			setConnectionState('disconnected');
		}
	};


	onMount(() => {
		// Parse URL parameters for initial map view
		const urlParams = parseUrlParams();
		const initialCenter: [number, number] = [
			urlParams.lat ?? props.center?.[0] ?? 52.362067356320544,
			urlParams.lng ?? props.center?.[1] ?? 13.500166167425972
		];
		const initialZoom = urlParams.zoom ?? props.zoom ?? 10;
		
		map = L.map(mapContainer).setView(initialCenter, initialZoom);

		L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
			attribution: '© OpenStreetMap contributors © CARTO',
			subdomains: 'abcd',
			maxZoom: 20
		}).addTo(map);

		// Initialize world service
		try {
			worldService = new WorldService();
		} catch (error) {
			console.error('Error initializing WorldService:', error);
		}

		// Initialize timeline service
		try {
			timelineService = new TimelineService();
			timelineService.startWatchingTimeline(
				(timelineUpdate) => {
					setTimeline(timelineUpdate);
				},
				(error) => {
					console.error('Timeline error:', error);
				}
			);
		} catch (error) {
			console.error('Error initializing TimelineService:', error);
		}

		// Add map event listeners to restart watching when view changes

		map.on('moveend', () => {
			debouncedStartWatching();
			debouncedUrlUpdate();
		});

		map.on('zoomend', () => {
			debouncedStartWatching();
			debouncedUrlUpdate();
		});

		// Add click handler to close entity sidebar when clicking on map
		map.on('click', (e: L.LeafletMouseEvent) => {
			handleMapClick(e);
		});

		// Add mouse move handler for entity moving
		map.on('mousemove', (e: L.LeafletMouseEvent) => {
			if (isMovingEntity()) {
				const newPosition: [number, number] = [e.latlng.lat, e.latlng.lng];
				setMovingEntityPosition(newPosition);
			}
		});

		// Cancel follow mode on any user interaction with map
		map.getContainer().addEventListener('mousedown', () => {
			if (isFollowingEntity()) {
				setIsFollowingEntity(false);
			}
		});

		// Start initial watch when map is ready
		map.whenReady(() => {
			startWatchingCurrentView();
			// Update URL with initial view if URL params were used
			if (urlParams.lat !== null || urlParams.lng !== null || urlParams.zoom !== null) {
				updateUrlFromMapView();
			}
		});

		// Set up periodic cleanup of expired entities (every 5 seconds for better performance)
		const cleanupInterval = setInterval(cleanupExpiredEntities, 5000);

		// Store interval for cleanup
		(map as any)._cleanupInterval = cleanupInterval;
	});

	onCleanup(() => {
		stopPlayback();
		if (mapMoveDebounceTimeout) {
			clearTimeout(mapMoveDebounceTimeout);
		}
		if (urlUpdateDebounceTimeout) {
			clearTimeout(urlUpdateDebounceTimeout);
		}
		if (map && (map as any)._cleanupInterval) {
			clearInterval((map as any)._cleanupInterval);
		}
		if (worldService) {
			worldService.stopWatching();
		}
		if (timelineService) {
			timelineService.stopWatchingTimeline();
		}
		if (map) {
			map.remove();
		}
	});

	const shouldShowTimeline = createMemo(() => {
		const t = timeline();
		if (!t) return false;
		const minMs = timestampToMs(t.min);
		const maxMs = timestampToMs(t.max);
		return minMs !== maxMs;
	});

	return (
		<>
			<style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
			<div style={{ position: 'relative', height: props.height || '400px', width: '100%' }}>
				<EntitySidebar 
					selectedEntity={selectedEntity()}
					isOpen={isEntitySidebarOpen()}
					onClose={() => handleMapClick()}
					isMovingEntity={isMovingEntity()}
					movingEntityPosition={movingEntityPosition()}
					onStartMove={startMoveEntity}
					onCancelMove={cancelMoveEntity}
					isFollowingEntity={isFollowingEntity()}
					onStartFollow={startFollowEntity}
					onStopFollow={stopFollowEntity}
				/>
				

				{/* Timeline controls */}
				{shouldShowTimeline() && (
					<div
						style={{
							position: 'absolute',
							bottom: '20px',
							left: '84px',
							right: timeline()?.frozen ? '20px' : 'auto',
							transform: 'none',
							width: timeline()?.frozen ? 'auto' : 'max-content',
							'z-index': '1000',
							'background-color': timeline()?.frozen ? 'rgba(0, 0, 0, 0.8)' : 'transparent',
							'border-radius': timeline()?.frozen ? '8px' : '0',
							padding: timeline()?.frozen ? '12px' : '0',
							display: 'flex',
							'align-items': 'center',
							gap: '12px',
							'box-shadow': '0 4px 6px rgba(0, 0, 0, 0.3)'
						}}
					>
						{timeline()?.frozen ? (
							<>
								<button
									style={{
										background: '#6b7280',
										border: 'none',
										'border-radius': '4px',
										color: 'white',
										padding: '8px 12px',
										cursor: 'pointer',
										'font-size': '14px'
									}}
									onClick={handleReturn}
								>
									⬅ Return
								</button>
								<button
									style={{
										background: isPlaying() ? '#dc2626' : '#10b981',
										border: 'none',
										'border-radius': '4px',
										color: 'white',
										padding: '8px 12px',
										cursor: 'pointer',
										'font-size': '14px'
									}}
									onClick={handlePlayPause}
								>
									{isPlaying() ? '⏸ Pause' : '▶ Play'}
								</button>
								<input
									type="range"
									min={timestampToMs(timeline()?.min)}
									max={timestampToMs(timeline()?.max)}
									value={frontendTimelinePosition() ?? timestampToMs(timeline()?.at)}
									onInput={(e) => handleTimelineMove(Number((e.target as HTMLInputElement).value))}
									style={{
										flex: '1',
										height: '20px',
										'border-radius': '3px',
										background: '#374151',
										outline: 'none',
										cursor: 'pointer',
										'-webkit-appearance': 'none',
										appearance: 'none'
									}}
								/>
								{/* Current time display */}
								<div
									style={{
										color: 'white',
										'font-size': '12px',
										'font-family': "'CommitMono', monospace",
										'white-space': 'nowrap',
										'margin-left': '12px'
									}}
								>
									{new Date(frontendTimelinePosition() ?? timestampToMs(timeline()?.at)).toLocaleString('en-US', {
										year: 'numeric',
										month: '2-digit',
										day: '2-digit',
										hour: '2-digit',
										minute: '2-digit',
										second: '2-digit',
										fractionalSecondDigits: 3,
										hour12: false
									})}
								</div>
							</>
						) : (
							<button
								style={{
									background: connectionState() === 'connected' ? '#dc2626' : '#f59e0b',
									border: 'none',
									'border-radius': '20px',
									color: 'white',
									padding: '8px 16px',
									cursor: connectionState() === 'connected' ? 'pointer' : 'default',
									'font-size': '14px',
									'font-weight': 'bold',
									display: 'flex',
									'align-items': 'center',
									gap: '6px',
									opacity: connectionState() === 'connected' ? 1 : 0.8
								}}
								onClick={connectionState() === 'connected' ? async () => {
									// Initialize frontend position when entering timeline mode (freezing)
									if (!timelineService || !timeline()) return;
									try {
										setFrontendTimelinePosition(timestampToMs(timeline()?.at));
										await timelineService.moveTimeline(true); // Freeze the timeline
									} catch (error) {
										console.error('Error freezing timeline:', error);
									}
								} : undefined}
							>
								{connectionState() === 'connected' ? (
									<>
										<span
											style={{
												width: '8px',
												height: '8px',
												'background-color': 'white',
												'border-radius': '50%',
												animation: 'pulse 2s infinite'
											}}
										></span>
										LIVE
									</>
								) : (
									<>
										<span
											style={{
												width: '8px',
												height: '8px',
												'background-color': 'white',
												'border-radius': '50%',
												animation: 'pulse 1s infinite'
											}}
										></span>
										{connectionState() === 'connecting' ? 'CONNECTING...' : 'DISCONNECTED'}
									</>
								)}
							</button>
						)}
					</div>
				)}

				<div
					ref={mapContainer}
					style={{
						height: '100%',
						width: '100%',
						background: '#000000'
					}}
				/>
			</div>
		</>
	);
}
