import type { BaseLayer } from "@hydra/map-engine/types";
import type { OverlayCategoryOption } from "@hydra/ui/controls";
import { ControlButton, OverlayCategory } from "@hydra/ui/controls";
import { GRADIENT_COLORS, GRADIENT_PROPS } from "@hydra/ui/lib/theme";
import { cn } from "@hydra/ui/lib/utils";
import { PANEL_TOP_OFFSET, usePanelContext } from "@hydra/ui/panels";
import { LinearGradient } from "expo-linear-gradient";
import {
  Eye,
  Layers,
  Link2,
  Maximize2,
  Minimize2,
  Radius,
  Satellite,
  ZoomIn,
  ZoomOut,
} from "lucide-react-native";
import { useRef, useState } from "react";
import { Platform, Pressable, Text, useWindowDimensions, View } from "react-native";
import Animated, {
  FadeIn,
  FadeOut,
  interpolate,
  runOnJS,
  runOnUI,
  useAnimatedReaction,
  useAnimatedStyle,
  withSpring,
} from "react-native-reanimated";

import {
  copyShareableLink,
  getShareableEntityUrl,
  getShareableLocationUrl,
  useUrlParams,
} from "../../lib/use-url-params";
import { mapEngineActions, useMapEngine } from "./store/map-engine-store";
import { useMapStore } from "./store/map-store";
import { useOverlayStore } from "./store/overlay-store";
import { useSelectionStore } from "./store/selection-store";

type NetworkType = "datalinks";
type SensorStatus = "online" | "degraded";
type TrackType = "hostile" | "unknown" | "friend";
type VisualizationType = "coverage";

const BUTTON_SIZE = 40;
const ICON_SIZE = 16;
const ICON_COLOR = "rgba(255, 255, 255, 0.7)";
const ICON_COLOR_ACTIVE = "rgba(255, 255, 255, 1)";
const RIGHT_PANEL_MARGIN = 12;

type LayerOption = {
  id: BaseLayer;
  label: string;
  icon: typeof Layers;
};

const LAYER_OPTIONS: LayerOption[] = [
  { id: "dark", label: "Dark", icon: Layers },
  { id: "satellite", label: "Satellite", icon: Satellite },
];

const SPRING_CONFIG = {
  damping: 35,
  stiffness: 180,
  mass: 1,
  overshootClamping: true,
};

const TRACK_OPTIONS: OverlayCategoryOption[] = [
  { id: "hostile", label: "Hostile", color: "red" },
  { id: "unknown", label: "Unknown", color: "yellow" },
  { id: "friend", label: "Friend", color: "blue" },
];

const SENSOR_OPTIONS: OverlayCategoryOption[] = [
  { id: "online", label: "Online", color: "green" },
  { id: "degraded", label: "Degraded", color: "yellow" },
];

const NETWORK_OPTIONS: OverlayCategoryOption[] = [
  { id: "datalinks", label: "Datalinks", color: "blue" },
];

const VISUALIZATION_OPTIONS: OverlayCategoryOption[] = [
  { id: "coverage", label: "Coverage Area", icon: Radius },
];

function ControlMenu({ visible, children }: { visible: boolean; children: React.ReactNode }) {
  if (!visible) return null;

  return (
    <Animated.View
      entering={FadeIn.duration(150)}
      exiting={FadeOut.duration(100)}
      style={{ position: "absolute", top: 0, right: BUTTON_SIZE + 8 }}
    >
      {children}
    </Animated.View>
  );
}

export function MapControls() {
  const { height: windowHeight } = useWindowDimensions();
  const { params } = useUrlParams();
  const paramsRef = useRef(params);
  paramsRef.current = params;
  const mapEngine = useMapEngine();
  const currentLayer = useMapStore((s) => s.layer);
  const setLayerStore = useMapStore((s) => s.setLayer);
  const tracks = useOverlayStore((s) => s.tracks);
  const sensors = useOverlayStore((s) => s.sensors);
  const network = useOverlayStore((s) => s.network);
  const visualization = useOverlayStore((s) => s.visualization);
  const toggleOverlayStore = useOverlayStore((s) => s.toggle);
  const {
    toggleFullscreen,
    isFullscreen,
    rightPanelCollapsed,
    rightPanelWidth,
    mapControlsHeight,
  } = usePanelContext();
  const [showLayerMenu, setShowLayerMenu] = useState(false);
  const [showOverlayMenu, setShowOverlayMenu] = useState(false);
  const [isFullscreenActive, setIsFullscreenActive] = useState(false);

  const anyMenuOpen = showLayerMenu || showOverlayMenu;

  const closeAllMenus = () => {
    setShowLayerMenu(false);
    setShowOverlayMenu(false);
  };

  // Sync isFullscreenActive with isFullscreen SharedValue
  useAnimatedReaction(
    () => isFullscreen.value,
    (value) => runOnJS(setIsFullscreenActive)(value),
    [],
  );

  const panelMaxHeight = windowHeight - PANEL_TOP_OFFSET;
  const panelTop = windowHeight - panelMaxHeight - RIGHT_PANEL_MARGIN;

  const animatedContainerStyle = useAnimatedStyle(() => {
    const shouldMoveRight = isFullscreen.value || rightPanelCollapsed.value;
    const rightPosition = interpolate(
      shouldMoveRight ? 1 : 0,
      [0, 1],
      [rightPanelWidth.value + RIGHT_PANEL_MARGIN + 8, RIGHT_PANEL_MARGIN],
    );

    return {
      right: withSpring(rightPosition, SPRING_CONFIG),
    };
  });

  const handleFullscreenToggle = () => {
    toggleFullscreen();
    setShowLayerMenu(false);
    setShowOverlayMenu(false);
  };

  const handleLayerSelect = (layer: BaseLayer) => {
    setLayerStore(layer);
    mapEngine.setBaseLayer(layer);
    setShowLayerMenu(false);
  };

  const toggleOverlay = <K extends "tracks" | "sensors" | "network" | "visualization">(
    category: K,
    item: string,
  ) => {
    toggleOverlayStore(category, item as never);
    const state = useOverlayStore.getState();

    if (category === "tracks" || category === "sensors") {
      mapEngine.setEntityVisibility(JSON.stringify(state.tracks), JSON.stringify(state.sensors));
    } else if (category === "visualization" && item === "coverage") {
      mapEngine.setCoverageVisible(state.visualization.coverage);
    }
  };

  const handleLayout = (event: { nativeEvent: { layout: { height: number } } }) => {
    const height = event.nativeEvent.layout.height;
    runOnUI(() => {
      "worklet";
      // eslint-disable-next-line react-compiler/react-compiler
      mapControlsHeight.value = height;
    })();
  };

  return (
    <>
      {Platform.OS !== "web" && anyMenuOpen && (
        <Pressable
          style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 9 }}
          onPress={closeAllMenus}
        />
      )}
      <Animated.View
        style={[
          {
            position: "absolute",
            top: panelTop,
            zIndex: 10,
            gap: 8,
          },
          animatedContainerStyle,
        ]}
        pointerEvents="box-none"
        onLayout={handleLayout}
      >
        <ControlButton
          onPress={handleFullscreenToggle}
          isActive={isFullscreenActive}
          size={BUTTON_SIZE}
        >
          {isFullscreenActive ? (
            <Minimize2 size={ICON_SIZE} color={ICON_COLOR_ACTIVE} />
          ) : (
            <Maximize2 size={ICON_SIZE} color={ICON_COLOR} />
          )}
        </ControlButton>

        <View className="relative">
          <ControlButton
            onPress={() => {
              setShowLayerMenu(!showLayerMenu);
              setShowOverlayMenu(false);
            }}
            isActive={showLayerMenu}
            size={BUTTON_SIZE}
          >
            {currentLayer === "satellite" ? (
              <Satellite size={ICON_SIZE} color={showLayerMenu ? ICON_COLOR_ACTIVE : ICON_COLOR} />
            ) : (
              <Layers size={ICON_SIZE} color={showLayerMenu ? ICON_COLOR_ACTIVE : ICON_COLOR} />
            )}
          </ControlButton>

          <ControlMenu visible={showLayerMenu}>
            <LinearGradient
              colors={GRADIENT_COLORS}
              {...GRADIENT_PROPS}
              className="border-border/40 w-full gap-0.5 overflow-hidden rounded-lg border p-1"
            >
              {LAYER_OPTIONS.map((option) => {
                const Icon = option.icon;
                const isSelected = currentLayer === option.id;
                return (
                  <Pressable
                    key={option.id}
                    onPress={() => handleLayerSelect(option.id)}
                    className="min-w-[100px] hover:opacity-70 active:opacity-70"
                  >
                    <View
                      className={cn(
                        "flex-row items-center gap-2.5 rounded px-3 py-2.5 select-none",
                        isSelected && "bg-white/15",
                      )}
                    >
                      <Icon size={ICON_SIZE} color={isSelected ? ICON_COLOR_ACTIVE : ICON_COLOR} />
                      <Text
                        selectable={false}
                        className={cn("text-sm", isSelected ? "text-white" : "text-white/50")}
                        style={{ fontWeight: isSelected ? "500" : "400" }}
                      >
                        {option.label}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </LinearGradient>
          </ControlMenu>
        </View>

        <View className="relative">
          <ControlButton
            onPress={() => {
              setShowOverlayMenu(!showOverlayMenu);
              setShowLayerMenu(false);
            }}
            isActive={showOverlayMenu}
            size={BUTTON_SIZE}
          >
            <Eye size={ICON_SIZE} color={showOverlayMenu ? ICON_COLOR_ACTIVE : ICON_COLOR} />
          </ControlButton>

          <ControlMenu visible={showOverlayMenu}>
            <LinearGradient
              colors={GRADIENT_COLORS}
              {...GRADIENT_PROPS}
              className="border-border/40 gap-2.5 overflow-hidden rounded-lg border p-2.5"
              style={{ minWidth: 240 }}
            >
              <OverlayCategory
                title="Tracks"
                options={TRACK_OPTIONS}
                activeStates={tracks}
                onToggle={(id) => toggleOverlay("tracks", id as TrackType)}
              />

              <OverlayCategory
                title="Sensors"
                options={SENSOR_OPTIONS}
                activeStates={sensors}
                onToggle={(id) => toggleOverlay("sensors", id as SensorStatus)}
              />

              <OverlayCategory
                title="Network"
                options={NETWORK_OPTIONS}
                activeStates={network}
                onToggle={(id) => toggleOverlay("network", id as NetworkType)}
              />

              <OverlayCategory
                title="Visualization"
                options={VISUALIZATION_OPTIONS}
                activeStates={visualization}
                onToggle={(id) => toggleOverlay("visualization", id as VisualizationType)}
              />
            </LinearGradient>
          </ControlMenu>
        </View>

        <ControlButton onPress={mapEngine.zoomIn} size={BUTTON_SIZE}>
          <ZoomIn size={ICON_SIZE} color={ICON_COLOR} />
        </ControlButton>

        <ControlButton onPress={mapEngine.zoomOut} size={BUTTON_SIZE}>
          <ZoomOut size={ICON_SIZE} color={ICON_COLOR} />
        </ControlButton>

        <ControlButton
          onPress={() => {
            const selectedEntityId = useSelectionStore.getState().selectedEntityId;
            const view = mapEngineActions.getView();
            const currentParams = paramsRef.current;
            if (selectedEntityId) {
              copyShareableLink(
                getShareableEntityUrl(selectedEntityId, {
                  tab: currentParams.tab,
                  zoom: view?.zoom,
                }),
              );
            } else if (view) {
              copyShareableLink(getShareableLocationUrl(view.lat, view.lng, { zoom: view.zoom }));
            }
          }}
          size={BUTTON_SIZE}
        >
          <Link2 size={ICON_SIZE} color={ICON_COLOR} />
        </ControlButton>
      </Animated.View>
    </>
  );
}
