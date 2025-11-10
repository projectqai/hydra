import { InfoRow } from "@hydra/ui/info-row";
import { usePanelContext } from "@hydra/ui/panels";
import type { Entity } from "@projectqai/proto/world";
import * as Clipboard from "expo-clipboard";
import {
  ArrowDown,
  ArrowUp,
  Compass,
  Copy,
  Gauge,
  MapPin,
  Maximize2,
  Mountain,
  PauseCircle,
  Radio,
  TrendingUp,
  Video,
  Zap,
} from "lucide-react-native";
import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { runOnJS, useAnimatedReaction } from "react-native-reanimated";
import { toast } from "sonner-native";
import { useShallow } from "zustand/react/shallow";

import { formatAltitude, formatTime } from "../../../../lib/api/use-track-utils";
import { usePIPContext } from "../../pip-context";
import { useEntityStore } from "../../store/entity-store";
import {
  calculateCourseFromVelocity,
  calculateGroundSpeed,
  calculateVerticalRate,
  formatAcceleration,
  formatCourse,
  formatSpeed,
  formatVerticalRate,
} from "../../utils/format-kinematics";
import { toVideoProtocol } from "../video-stream/types";
import { VideoStream } from "../video-stream/video-stream";

type OverviewTabProps = {
  entity: Entity;
};

function formatCoordinate(value: number, type: "lat" | "lon") {
  const direction = type === "lat" ? (value >= 0 ? "N" : "S") : value >= 0 ? "E" : "W";
  return `${Math.abs(value).toFixed(6)}° ${direction}`;
}

type PositionEditorProps = {
  entity: Entity;
};

function PositionEditor({ entity }: PositionEditorProps) {
  if (!entity.geo) return null;

  /* Edit position functionality disabled - can't edit track positions
  const [isEditing, setIsEditing] = useState(false);
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [alt, setAlt] = useState("");
  const { updateEntityLocation, isPending } = useEntityMutation();

  const startEditing = () => {
    if (!entity.geo) return;
    setLat(String(entity.geo.latitude));
    setLng(String(entity.geo.longitude));
    setAlt(entity.geo.altitude != null ? String(entity.geo.altitude) : "");
    setIsEditing(true);
  };

  const cancelEditing = () => {
    setIsEditing(false);
  };

  const saveChanges = async () => {
    const latitude = parseFloat(lat);
    const longitude = parseFloat(lng);
    const altitude = parseFloat(alt);

    if (isNaN(latitude) || isNaN(longitude) || isNaN(altitude)) return;

    try {
      await updateEntityLocation(entity, { latitude, longitude, altitude });
      setIsEditing(false);
    } catch {
    }
  };

  const handleTextChange = (value: string, setter: (v: string) => void) => {
    const parsed = parseCoordinates(value);
    if (parsed) {
      setLat(String(parsed.lat));
      setLng(String(parsed.lng));
      if (parsed.alt !== undefined) {
        setAlt(String(parsed.alt));
      }
      return;
    }
    setter(value);
  };

  if (isEditing) {
    return (
      <View className="px-3 pt-3 pb-2">
        <Text className="text-foreground/50 mb-1.5 font-mono text-[11px] tracking-widest uppercase">
          {entity.geo ? "Edit Position" : "Add Position"}
        </Text>
        <View className="gap-1.5">
          <View className="gap-0.5">
            <Text className="font-sans-medium text-foreground/50 mb-0.5 text-[11px]">Latitude</Text>
            <TextInput
              value={lat}
              onChangeText={(text) => handleTextChange(text, setLat)}
              className="border-foreground/20 bg-foreground/5 text-foreground/90 focus:border-foreground/40 rounded border px-2 py-1.5 font-mono text-sm focus:outline-none"
              keyboardType="numeric"
              selectTextOnFocus
              placeholderTextColor="rgba(255, 255, 255, 0.3)"
            />
          </View>
          <View className="gap-0.5">
            <Text className="font-sans-medium text-foreground/50 mb-0.5 text-[11px]">
              Longitude
            </Text>
            <TextInput
              value={lng}
              onChangeText={(text) => handleTextChange(text, setLng)}
              className="border-foreground/20 bg-foreground/5 text-foreground/90 focus:border-foreground/40 rounded border px-2 py-1.5 font-mono text-sm focus:outline-none"
              keyboardType="numeric"
              selectTextOnFocus
              placeholderTextColor="rgba(255, 255, 255, 0.3)"
            />
          </View>
          <View className="gap-0.5">
            <Text className="font-sans-medium text-foreground/50 mb-0.5 text-[11px]">
              Altitude (m)
            </Text>
            <TextInput
              value={alt}
              onChangeText={(text) => handleTextChange(text, setAlt)}
              className="border-foreground/20 bg-foreground/5 text-foreground/90 focus:border-foreground/40 rounded border px-2 py-1.5 font-mono text-sm focus:outline-none"
              keyboardType="numeric"
              selectTextOnFocus
              placeholderTextColor="rgba(255, 255, 255, 0.3)"
            />
          </View>
        </View>
        <View className="mt-2 flex-row gap-1.5">
          {entity.geo && (
            <Pressable
              onPress={cancelEditing}
              disabled={isPending}
              className="border-foreground/20 bg-foreground/5 hover:bg-foreground/10 active:bg-foreground/10 flex-1 items-center justify-center rounded border py-2.5"
            >
              <Text className="font-sans-medium text-foreground/70 text-xs leading-none">
                Cancel
              </Text>
            </Pressable>
          )}
          <Pressable
            onPress={saveChanges}
            disabled={isPending}
            className="bg-green flex-1 items-center justify-center rounded py-2.5 hover:opacity-80 active:opacity-70"
          >
            <Text className="font-sans-medium text-background text-xs leading-none">
              {isPending ? "Saving..." : "Save"}
            </Text>
          </Pressable>
        </View>
      </View>
    );
  }
  */

  const copyAllCoords = async () => {
    const coords = `${entity.geo!.latitude}, ${entity.geo!.longitude}, ${entity.geo!.altitude}`;
    await Clipboard.setStringAsync(coords);
    toast("Copied to clipboard");
  };

  return (
    <View className="px-3 pt-3 pb-2">
      <View className="mb-1 flex-row items-center justify-between">
        <Text className="text-foreground/50 font-mono text-[11px] tracking-widest uppercase">
          Position
        </Text>
        <Pressable
          onPress={copyAllCoords}
          hitSlop={8}
          className="hover:opacity-70 active:opacity-50"
        >
          <Copy size={12} color="rgba(255, 255, 255, 0.4)" strokeWidth={2} />
        </Pressable>
      </View>
      <InfoRow
        icon={MapPin}
        label="Latitude"
        value={formatCoordinate(entity.geo.latitude, "lat")}
      />
      <InfoRow
        icon={MapPin}
        label="Longitude"
        value={formatCoordinate(entity.geo.longitude, "lon")}
      />
      <InfoRow icon={Mountain} label="Altitude" value={formatAltitude(entity.geo.altitude)} />
      {/* Edit position functionality disabled can't edit track positions
      <Pressable
        onPress={startEditing}
        className="border-foreground/10 bg-foreground/5 hover:bg-foreground/10 active:bg-foreground/10 mt-1.5 flex-row items-center justify-center gap-1.5 rounded border py-1"
      >
        <Text className="font-sans-medium text-foreground/60 text-xs">Edit</Text>
      </Pressable>
      */}
    </View>
  );
}

function DetectionRow({ detection }: { detection: Entity }) {
  const classification = detection.detection?.classification || "Unknown";
  const azimuth = detection.bearing?.azimuth;
  const time = detection.detection?.lastMeasured;

  return (
    <View className="flex-row items-center justify-between py-1.5">
      <View className="flex-row items-center gap-2">
        <View className="w-5 items-center">
          <Radio size={15} color="rgba(255, 255, 255, 0.5)" strokeWidth={2} />
        </View>
        <View>
          <Text className="font-sans-medium text-foreground/60 text-xs">{classification}</Text>
          {time && (
            <Text className="text-foreground/40 font-mono text-[10px]">{formatTime(time)}</Text>
          )}
        </View>
      </View>
      {azimuth !== undefined && (
        <Text className="text-foreground/90 font-mono text-xs">{azimuth.toFixed(0)}°</Text>
      )}
    </View>
  );
}

function hasEnuData(enu: { east?: number; north?: number; up?: number } | undefined): boolean {
  if (!enu) return false;
  return enu.east !== undefined || enu.north !== undefined || enu.up !== undefined;
}

function KinematicsSection({ entity }: { entity: Entity }) {
  const velocityEnu = entity.kinematics?.velocityEnu;
  const accelerationEnu = entity.kinematics?.accelerationEnu;
  const courseFromBearing = entity.bearing?.azimuth;

  const groundSpeed = calculateGroundSpeed(velocityEnu);
  const courseFromVelocity = calculateCourseFromVelocity(velocityEnu);
  const verticalRate = calculateVerticalRate(velocityEnu);

  const showVelocityEnu = hasEnuData(velocityEnu);
  const showAcceleration = hasEnuData(accelerationEnu);

  if (!entity.kinematics) return null;

  return (
    <>
      <View className="border-foreground/10 border-t px-3 pt-3 pb-2">
        <Text className="text-foreground/50 mb-1 font-mono text-[11px] tracking-widest uppercase">
          Velocity
        </Text>
        <InfoRow icon={Zap} label="Ground Speed" value={formatSpeed(groundSpeed)} />
        {verticalRate !== undefined && (
          <InfoRow
            icon={verticalRate >= 0 ? ArrowUp : ArrowDown}
            label="Vertical Rate"
            value={formatVerticalRate(verticalRate)}
          />
        )}
        <InfoRow
          icon={Compass}
          label="Course"
          value={formatCourse(courseFromBearing ?? courseFromVelocity)}
        />
        {courseFromBearing !== undefined && courseFromVelocity !== undefined && (
          <InfoRow icon={Gauge} label="Track (velocity)" value={formatCourse(courseFromVelocity)} />
        )}
      </View>

      {showVelocityEnu && velocityEnu && (
        <View className="border-foreground/10 border-t px-3 pt-3 pb-2">
          <Text className="text-foreground/50 mb-1 font-mono text-[11px] tracking-widest uppercase">
            Velocity ENU
          </Text>
          <InfoRow label="East" value={`${velocityEnu.east?.toFixed(2) ?? "—"} m/s`} />
          <InfoRow label="North" value={`${velocityEnu.north?.toFixed(2) ?? "—"} m/s`} />
          <InfoRow label="Up" value={`${velocityEnu.up?.toFixed(2) ?? "—"} m/s`} />
        </View>
      )}

      {showAcceleration && accelerationEnu && (
        <View className="border-foreground/10 border-t px-3 pt-3 pb-2">
          <Text className="text-foreground/50 mb-1 font-mono text-[11px] tracking-widest uppercase">
            Acceleration
          </Text>
          <InfoRow
            icon={TrendingUp}
            label="Magnitude"
            value={formatAcceleration(accelerationEnu)}
          />
          <InfoRow label="East" value={`${accelerationEnu.east?.toFixed(2) ?? "—"} m/s²`} />
          <InfoRow label="North" value={`${accelerationEnu.north?.toFixed(2) ?? "—"} m/s²`} />
          <InfoRow label="Up" value={`${accelerationEnu.up?.toFixed(2) ?? "—"} m/s²`} />
        </View>
      )}
    </>
  );
}

export function OverviewTab({ entity }: OverviewTabProps) {
  const { openPIP, isInPIP } = usePIPContext();
  const { rightPanelCollapsed } = usePanelContext();
  const [isPanelExpanded, setIsPanelExpanded] = useState(true);
  const sensorDetections = useEntityStore(
    useShallow((s) =>
      Array.from(s.entities.values()).filter((e) => e.detection?.detectorEntityId === entity.id),
    ),
  );

  useAnimatedReaction(
    () => rightPanelCollapsed.value,
    (collapsed, prev) => {
      if (prev !== null && collapsed !== prev) {
        runOnJS(setIsPanelExpanded)(!collapsed);
      }
    },
    [],
  );

  return (
    <ScrollView className="flex-1">
      <View>
        {entity.controller && (
          <View className="px-3 pt-3 pb-2">
            <Text className="text-foreground/50 mb-1 font-mono text-[11px] tracking-widest uppercase">
              Controller
            </Text>
            <InfoRow label="ID" value={entity.controller.id} onCopy />
            <InfoRow label="Name" value={entity.controller.name || "Unknown"} />
          </View>
        )}

        <PositionEditor entity={entity} />

        <KinematicsSection entity={entity} />

        {(entity.detection?.classification || entity.detection?.detectorEntityId) && (
          <View className="border-foreground/10 border-t px-3 pt-3 pb-2">
            <Text className="text-foreground/50 mb-1 font-mono text-[11px] tracking-widest uppercase">
              Detection
            </Text>
            {entity.detection?.classification && (
              <InfoRow label="Classification" value={entity.detection.classification} />
            )}
            {entity.detection?.detectorEntityId && (
              <InfoRow label="Detected By" value={entity.detection.detectorEntityId} onCopy />
            )}
          </View>
        )}

        {sensorDetections.length > 0 && (
          <View className="border-foreground/10 border-t px-3 pt-3 pb-2">
            <Text className="text-foreground/50 mb-1 font-mono text-[11px] tracking-widest uppercase">
              Detections ({sensorDetections.length})
            </Text>
            <View>
              {sensorDetections.map((detection) => (
                <DetectionRow key={detection.id} detection={detection} />
              ))}
            </View>
          </View>
        )}

        {entity.camera && entity.camera.cameras.length > 0 && (
          <View className="border-foreground/10 border-t px-3 pt-3 pb-2">
            <Text className="text-foreground/50 mb-1.5 font-mono text-[11px] tracking-widest uppercase">
              Video Feeds
            </Text>
            <View className="gap-2">
              {entity.camera.cameras.map((camera, index) => {
                const isThisCameraPaused = isInPIP(entity.id, camera.url);

                return (
                  <View key={index} className="gap-1">
                    <View className="flex-row items-center justify-between">
                      <View className="flex-row items-center gap-1.5">
                        <View className="opacity-50">
                          <Video size={12} color="white" strokeWidth={1.5} />
                        </View>
                        <Text className="text-foreground/70 font-mono text-xs">
                          {camera.label || `CAM-${index + 1}`}
                        </Text>
                      </View>
                      <Pressable
                        onPress={() => openPIP(entity, camera)}
                        hitSlop={8}
                        className="focus-visible:outline-none active:opacity-50"
                      >
                        <Maximize2 size={12} color="rgba(255, 255, 255, 0.3)" strokeWidth={1.5} />
                      </Pressable>
                    </View>
                    <View className="border-foreground/5 bg-background relative aspect-video overflow-hidden rounded border">
                      {isPanelExpanded && !isThisCameraPaused && (
                        <VideoStream
                          url={camera.url}
                          protocol={toVideoProtocol(camera.protocol)}
                          objectFit="cover"
                        />
                      )}
                      {isThisCameraPaused && (
                        <View className="bg-background absolute inset-0 items-center justify-center">
                          <PauseCircle
                            size={24}
                            color="rgba(255, 255, 255, 0.5)"
                            strokeWidth={1.5}
                          />
                          <Text className="text-foreground/50 mt-1 font-sans text-xs">
                            Playing in PIP
                          </Text>
                        </View>
                      )}
                    </View>
                  </View>
                );
              })}
            </View>
          </View>
        )}
      </View>
    </ScrollView>
  );
}
