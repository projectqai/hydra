import { Show, onMount, onCleanup, createSignal, createEffect, createMemo } from 'solid-js';
import { Entity } from '../proto/world_pb';
import feather from 'feather-icons';
import milsymbol from 'milsymbol';
import './EntitySidebar.css';

interface EntitySidebarProps {
	selectedEntity: any | null;
	isOpen: boolean;
	onClose: () => void;
	isMovingEntity?: boolean;
	movingEntityPosition?: [number, number] | null;
	onStartMove?: () => void;
	onCancelMove?: () => void;
	isFollowingEntity?: boolean;
	onStartFollow?: () => void;
	onStopFollow?: () => void;
}

type TabType = 'id' | 'world' | 'configuration';

const EntitySidebar = (props: EntitySidebarProps) => {
	const [detailedEntity, setDetailedEntity] = createSignal<Entity | null>(null);
	const [loading, setLoading] = createSignal<boolean>(false);
	const [error, setError] = createSignal<string | null>(null);
	const [activeTab, setActiveTab] = createSignal<TabType>('id');

	let closeTimeout: number | undefined;
	let lifetimeTimeout: number | undefined;

	const tabs = [
		{ id: 'id', icon: 'crosshair', label: 'Target' },
		{ id: 'world', icon: 'globe', label: 'World' },
		{ id: 'configuration', icon: 'settings', label: 'Configuration' }
	] as const;


	onMount(() => {
		feather.replace();
	});

	const handleKeyDown = (event: KeyboardEvent) => {
		if (event.key === 'Escape' && props.isOpen) {
			if (props.isMovingEntity) {
				// Cancel move mode if entity is being moved
				props.onCancelMove?.();
			} else {
				// Otherwise close the sidebar
				props.onClose();
			}
		}

		if (event.key === 'Tab' && props.isOpen && detailedEntity()) {
			event.preventDefault();
			const currentIndex = tabs.findIndex(tab => tab.id === activeTab());
			const nextIndex = event.shiftKey
				? (currentIndex - 1 + tabs.length) % tabs.length
				: (currentIndex + 1) % tabs.length;
			setActiveTab(tabs[nextIndex].id as TabType);
			setTimeout(() => feather.replace(), 0);
		}
	};

	const isEntityExpired = (entity: any): boolean => {
		if (!entity?.lifetime?.until) {
			return false;
		}

		const untilMs = Number(entity.lifetime.until.seconds) * 1000 +
			Number(entity.lifetime.until.nanos || 0) / 1000000;

		return Date.now() > untilMs;
	};

	const scheduleLifetimeTimeout = (entity: any) => {
		if (lifetimeTimeout) {
			clearTimeout(lifetimeTimeout);
			lifetimeTimeout = undefined;
		}

		if (entity?.lifetime?.until) {
			const untilMs = Number(entity.lifetime.until.seconds) * 1000 +
				Number(entity.lifetime.until.nanos || 0) / 1000000;
			const now = Date.now();

			if (untilMs > now) {
				const timeUntilExpiry = untilMs - now;
				lifetimeTimeout = setTimeout(() => {
					setDetailedEntity(null);
					props.onClose();
					lifetimeTimeout = undefined;
				}, timeUntilExpiry);
			}
		}
	};

	createEffect(() => {
		if (props.selectedEntity) {
			// Clear any pending close timeout when entity is selected/updated
			if (closeTimeout) {
				clearTimeout(closeTimeout);
				closeTimeout = undefined;
			}
			setDetailedEntity(props.selectedEntity);
			setError(null);
			setLoading(false);
			setTimeout(() => feather.replace(), 0);

			// Schedule timeout for entity lifetime expiry
			scheduleLifetimeTimeout(props.selectedEntity);
		} else {
			// Check if the current entity has expired
			const currentEntity = detailedEntity();
			if (currentEntity && isEntityExpired(currentEntity)) {
				// Entity has expired, close immediately
				setDetailedEntity(null);
				if (closeTimeout) {
					clearTimeout(closeTimeout);
					closeTimeout = undefined;
				}
			} else {
				// Entity might reappear, delay clearing for 1 second
				if (closeTimeout) {
					clearTimeout(closeTimeout);
				}
				closeTimeout = setTimeout(() => {
					setDetailedEntity(null);
					closeTimeout = undefined;
				}, 1000);
			}
		}
	});

	// Update feather icons when move state changes (but not on position updates)
	createEffect(() => {
		if (props.isMovingEntity !== undefined) {
			setTimeout(() => feather.replace(), 0);
		}
	});

	onMount(() => {
		document.addEventListener('keydown', handleKeyDown);
	});

	onCleanup(() => {
		document.removeEventListener('keydown', handleKeyDown);
		if (closeTimeout) {
			clearTimeout(closeTimeout);
		}
		if (lifetimeTimeout) {
			clearTimeout(lifetimeTimeout);
		}
	});

	const getHeaderIcon = () => {
		const entity = detailedEntity();
		if (entity?.symbol?.milStd2525C) {
			const symbolIcon = new milsymbol.Symbol(entity.symbol.milStd2525C, {
				size: 20,
				fill: true,
				frame: true
			});

			if (symbolIcon.isValid()) {
				return symbolIcon.asSVG();
			}
		}
		return '';
	};

	const renderComponentSection = (title: string, component: any) => {
		if (!component) return null;

		return (
			<div class="component-section">
				<h4 class="component-title">{title}</h4>
				<div class="component-fields">
					{Object.entries(component).map(([key, value]) => (
						<div class="entity-field">
							<label>{key}:</label>
							<span>{typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value)}</span>
						</div>
					))}
				</div>
			</div>
		);
	};

	const renderControllerSection = () => {
		const entity = detailedEntity();
		if (!entity?.controller) return null;

		return (
			<div class="component-section">
				<h4 class="component-title">Controller</h4>
				<div class="component-fields">
					<div class="controller-name">{entity.controller.name || 'Unknown'}</div>
				</div>
			</div>
		);
	};

	// const formatTimestamp = (timestamp: any) => {
	// 	if (!timestamp?.seconds) return 'Unknown';

	// 	const date = new Date(Number(timestamp.seconds) * 1000);
	// 	const now = new Date();
	// 	const diffMs = now.getTime() - date.getTime();
	// 	const diffMinutes = Math.floor(diffMs / (1000 * 60));
	// 	const diffHours = Math.floor(diffMinutes / 60);
	// 	const diffDays = Math.floor(diffHours / 24);

	// 	if (diffMinutes < 1) return 'Just now';
	// 	if (diffMinutes < 60) return `${diffMinutes} minute${diffMinutes === 1 ? '' : 's'} ago`;
	// 	if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
	// 	return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
	// };

	// const renderAssetSection = () => {
	// 	const entity = detailedEntity();
	// 	if (!entity?.asset) return null;

	// 	return (
	// 		<div class="component-section">
	// 			<h4 class="component-title">Asset</h4>
	// 			<div class="component-fields">
	// 				{/* Battery Progress Bar */}
	// 				<Show when={entity.asset.batteryPercent !== undefined}>
	// 					<div class="entity-field">
	// 						<label>Battery:</label>
	// 						<div class="battery-container">
	// 							<div class="battery-bar">
	// 								<div
	// 									class={`battery-fill ${entity.asset.batteryPercent! < 20 ? 'low' : entity.asset.batteryPercent! < 50 ? 'medium' : 'high'}`}
	// 									style={`width: ${Math.max(0, Math.min(100, entity.asset.batteryPercent!))}%`}
	// 								></div>
	// 							</div>
	// 							<span class="battery-text">{entity.asset.batteryPercent}%</span>
	// 						</div>
	// 					</div>
	// 				</Show>

	// 				{/* Last Seen */}
	// 				<Show when={entity.asset.lastSeen}>
	// 					<div class="entity-field">
	// 						<label>Last Seen:</label>
	// 						<span>{formatTimestamp(entity.asset.lastSeen)}</span>
	// 					</div>
	// 				</Show>

	// 				{/* Mavlink - Flight Mode only */}
	// 				<Show when={entity.asset.mavlink?.flightMode}>
	// 					<div class="entity-field">
	// 						<label>Flight Mode:</label>
	// 						<span>{entity.asset.mavlink!.flightMode}</span>
	// 					</div>
	// 				</Show>
	// 			</div>
	// 		</div>
	// 	);
	// };

	// const renderPhySection = () => {
	// 	const entity = detailedEntity();
	// 	if (!entity?.phy) return null;

	// 	return (
	// 		<div class="component-section">
	// 			<h4 class="component-title">Physical Layer</h4>
	// 			<div class="component-fields">
	// 				{/* Frequency */}
	// 				<Show when={entity.phy.frequency !== undefined && entity.phy.frequency !== 0n}>
	// 					<div class="entity-field">
	// 						<label>Frequency:</label>
	// 						<span>{Number(entity.phy.frequency).toLocaleString()} Hz</span>
	// 					</div>
	// 				</Show>

	// 				{/* RSSI */}
	// 				<Show when={entity.phy.rssi !== undefined && entity.phy.rssi !== 0}>
	// 					<div class="entity-field">
	// 						<label>RSSI:</label>
	// 						<span>{entity.phy.rssi} dBm</span>
	// 					</div>
	// 				</Show>

	// 				{/* LSNR */}
	// 				<Show when={entity.phy.lsnr !== undefined && entity.phy.lsnr !== 0}>
	// 					<div class="entity-field">
	// 						<label>SNR:</label>
	// 						<span>{entity.phy.lsnr} dB</span>
	// 					</div>
	// 				</Show>

	// 				{/* Protocol */}
	// 				<Show when={entity.phy.proto && entity.phy.proto.trim() !== ""}>
	// 					<div class="entity-field">
	// 						<label>Protocol:</label>
	// 						<span>{entity.phy.proto}</span>
	// 					</div>
	// 				</Show>
	// 			</div>
	// 		</div>
	// 	);
	// };

	const renderCameraSection = () => {
		const entity = detailedEntity();
		if (!entity?.camera?.cameras || entity.camera.cameras.length === 0) return null;

		return (
			<div class="component-section camera-section">
				<h4 class="component-title">Camera View</h4>
				<div class="camera-grid">
					{entity.camera.cameras.map((camera) => (
						<div class="camera-item">
							<div class="camera-view">
								<img
									src={camera.url}
									alt={camera.label || 'Camera'}
									class="camera-image"
									onError={(e) => {
										e.currentTarget.style.display = 'none';
										const nextElement = e.currentTarget.nextElementSibling as HTMLElement;
										if (nextElement) {
											nextElement.style.display = 'block';
										}
									}}
								/>
								<div class="camera-error" style="display: none;">
									<div class="camera-error-icon">📷</div>
									<div class="camera-error-text">Camera unavailable</div>
									<div class="camera-error-url">{camera.url}</div>
								</div>
							</div>
						</div>
					))}
				</div>
			</div>
		);
	};

	const renderGeospatialCoordinates = () => {
		const entity = detailedEntity();
		if (!entity?.geo) return null;

		// Use moving position if in move mode, otherwise use entity position
		const currentLat = props.isMovingEntity && props.movingEntityPosition
			? props.movingEntityPosition[0]
			: entity.geo.latitude;
		const currentLng = props.isMovingEntity && props.movingEntityPosition
			? props.movingEntityPosition[1]
			: entity.geo.longitude;

		// Format coordinates to consistent decimal places to prevent layout shifting
		const formatCoordinate = (coord: number) => coord.toFixed(10);

		return (
			<div class="component-fields">
				<div class="entity-field">
					<label>latitude:</label>
					<span class={props.isMovingEntity ? 'moving-coordinate' : ''}>{formatCoordinate(currentLat)}</span>
				</div>
				<div class="entity-field">
					<label>longitude:</label>
					<span class={props.isMovingEntity ? 'moving-coordinate' : ''}>{formatCoordinate(currentLng)}</span>
				</div>
				{/* {entity.track?.elevation !== undefined && (
					<div class="entity-field">
						<label>elevation:</label>
						<span>{entity.track.elevation}</span>
					</div>
				)} */}
			</div>
		);
	};

	const renderGeospatialButtons = createMemo(() => {
		// Only re-render when button states change, not when coordinates change
		const isMoving = props.isMovingEntity;
		const isFollowing = props.isFollowingEntity;

		return (
			<div class="move-controls">
				<button
					class={`move-button ${isMoving ? 'active' : ''}`}
					onClick={() => {
						if (isMoving) {
							props.onCancelMove?.();
						} else {
							props.onStartMove?.();
						}
					}}
				>
					{isMoving ? 'Cancel Move' : 'Move Entity'}
				</button>
				<button
					class={`follow-button ${isFollowing ? 'active' : ''}`}
					onClick={() => {
						if (isFollowing) {
							props.onStopFollow?.();
						} else {
							props.onStartFollow?.();
						}
					}}
				>
					{isFollowing ? 'Stop Follow' : 'Follow'}
				</button>
			</div>
		);
	});

	const renderGeospatialSection = () => {
		const entity = detailedEntity();
		if (!entity?.geo) return null;

		return (
			<div class="component-section">
				<h4 class="component-title">Geospatial</h4>
				{renderGeospatialCoordinates()}
				{renderGeospatialButtons()}
			</div>
		);
	};

	const renderIdTab = () => (
		<div>
			{/* Symbol Component */}
			{renderComponentSection('Symbol', detailedEntity()?.symbol)}

			{/* Controller */}
			{renderControllerSection()}

			{/* Asset Component */}
			{/* {renderAssetSection()} */}

			{/* Phy Component */}
			{/* {renderPhySection()} */}

			{/* GeoSpatial Component */}
			{renderGeospatialSection()}

			{/* Taskable Component */}
			{/* <Show when={detailedEntity()?.taskable?.Taskables && detailedEntity()!.taskable!.Taskables.length > 0}>
				<div class="component-section">
					<h4 class="component-title">Taskable</h4>
					<div class="component-fields">
						<For each={detailedEntity()!.taskable!.Taskables}>
							{(taskable) => (
								<button
									class="taskable-button"
									onClick={() => {
										console.log('Taskable clicked:', taskable);
									}}
								>
									<div class="taskable-button-content">
										<div class="taskable-header">
											<span class="taskable-action">{taskable.actionLabel || 'No Action Label'}</span>
											<span class="taskable-controller">({taskable.controller || 'Unknown Controller'})</span>
										</div>
										<div class="taskable-description">{taskable.description || 'No description available'}</div>
										<Show when={taskable.taskedEntityID && taskable.taskedEntityID.length > 0}>
											<div class="taskable-entities">
												Affects: {taskable.taskedEntityID.join(', ')}
											</div>
										</Show>
									</div>
								</button>
							)}
						</For>
					</div>
				</div>
			</Show> */}

			{/* Camera Views - Always at bottom */}
			{renderCameraSection()}
		</div>
	);

	const renderWorldTab = () => (
		<div>
			{/* GeoSpatial Component */}
			{renderGeospatialSection()}

			{/* Track Component */}
			{/* {renderComponentSection('Track', detailedEntity()?.track)} */}

			{/* Lifetime */}
			<Show when={detailedEntity()?.lifetime}>
				<div class="component-section">
					<h4 class="component-title">Lifetime</h4>
					<div class="component-fields">
						<Show when={detailedEntity()?.lifetime?.from}>
							<div class="entity-field">
								<label>From:</label>
								<span>{new Date(Number(detailedEntity()!.lifetime!.from!.seconds) * 1000).toLocaleString()}</span>
							</div>
						</Show>
						<Show when={detailedEntity()?.lifetime?.until}>
							<div class="entity-field">
								<label>Until:</label>
								<span>{new Date(Number(detailedEntity()!.lifetime!.until!.seconds) * 1000).toLocaleString()}</span>
							</div>
						</Show>
					</div>
				</div>
			</Show>

			{/* Signals Component */}
			{/* <Show when={detailedEntity()?.signals && detailedEntity()!.signals.length > 0}>
				<div class="component-section">
					<h4 class="component-title">Signals</h4>
					<div class="component-fields">
						{detailedEntity()!.signals.map((signal, index) => (
							<div class="signal-item">
								<label>Signal {index + 1}:</label>
								<span>{JSON.stringify(signal, null, 2)}</span>
							</div>
						))}
					</div>
				</div>
			</Show> */}
		</div>
	);

	const renderConfigurationTab = () => (
		<div>
			{/* Lifetime */}
			<Show when={detailedEntity()?.lifetime}>
				<div class="component-section">
					<h4 class="component-title">Lifetime</h4>
					<div class="component-fields">
						<Show when={detailedEntity()?.lifetime?.from}>
							<div class="entity-field">
								<label>From:</label>
								<span>{new Date(Number(detailedEntity()!.lifetime!.from!.seconds) * 1000).toLocaleString()}</span>
							</div>
						</Show>
						<Show when={detailedEntity()?.lifetime?.until}>
							<div class="entity-field">
								<label>Until:</label>
								<span>{new Date(Number(detailedEntity()!.lifetime!.until!.seconds) * 1000).toLocaleString()}</span>
							</div>
						</Show>
					</div>
				</div>
			</Show>

			{/* Controller */}
			{renderComponentSection('Controller', detailedEntity()?.controller)}

			{/* Mavlink Details */}
			{/* <Show when={detailedEntity()?.asset?.mavlink}>
				<div class="component-section">
					<h4 class="component-title">Mavlink</h4>
					<div class="component-fields">
						{Object.entries(detailedEntity()!.asset!.mavlink!).map(([key, value]) => (
							<div class="entity-field">
								<label>{key}:</label>
								<span>{typeof value === 'object' ? JSON.stringify(value) : String(value)}</span>
							</div>
						))}
					</div>
				</div>
			</Show> */}
		</div>
	);

	return (
		<Show when={props.isOpen}>
			<div class="entity-sidebar">
				<div class="entity-sidebar-header">
					<h3>
						<span innerHTML={getHeaderIcon()}></span>
						<span>{detailedEntity()?.label || 'ENTITY DETAILS'}</span>
					</h3>
					<button class="close-button" onClick={props.onClose}>✕</button>
				</div>
				<Show when={detailedEntity() && !loading()}>
					<div class="tab-navigation">
						{tabs.map(tab => (
							<button
								class={`tab-button ${activeTab() === tab.id ? 'active' : ''}`}
								onClick={() => {
									setActiveTab(tab.id as TabType);
									setTimeout(() => feather.replace(), 0);
								}}
								title={tab.label}
							>
								<div class="tab-icon">
									<i data-feather={tab.icon}></i>
								</div>
							</button>
						))}
					</div>
				</Show>

				<div class="entity-sidebar-content">
					<Show when={loading()}>
						<div class="loading">Loading entity details...</div>
					</Show>
					<Show when={error()}>
						<div class="error">Error: {error()}</div>
					</Show>
					<Show when={detailedEntity() && !loading()}>
						<div class="entity-info">
							<Show when={activeTab() === 'id'}>
								{renderIdTab()}
							</Show>
							<Show when={activeTab() === 'world'}>
								{renderWorldTab()}
							</Show>
							<Show when={activeTab() === 'configuration'}>
								{renderConfigurationTab()}
							</Show>
						</div>
					</Show>
					<Show when={!props.selectedEntity && !loading()}>
						<p>No entity selected</p>
					</Show>
				</div>
			</div>
		</Show>
	);
};

export default EntitySidebar;
