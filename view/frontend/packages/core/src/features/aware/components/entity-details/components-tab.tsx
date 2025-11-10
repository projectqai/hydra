import type { Entity } from "@projectqai/proto/world";
import {
  Camera,
  CheckCircle,
  Compass,
  Crosshair,
  Gauge,
  ListTodo,
  MapPin,
  Radar,
  Scan,
  Target,
} from "lucide-react-native";
import type { ComponentType } from "react";
import { ScrollView, Text, View } from "react-native";

type ComponentsTabProps = {
  entity: Entity;
};

type ComponentDef = {
  icon: ComponentType<{ size: number; color: string; strokeWidth?: number }>;
  label: string;
  description: string;
};

function ComponentItem({ icon: Icon, label, description }: ComponentDef) {
  return (
    <View className="flex-row items-center gap-2 py-1.5">
      <View className="w-5 items-center">
        <Icon size={15} color="rgba(255, 255, 255, 0.5)" strokeWidth={2} />
      </View>
      <View className="flex-1">
        <Text className="font-sans-medium text-foreground/80 text-xs">{label}</Text>
        <Text className="text-foreground/40 text-[10px]">{description}</Text>
      </View>
      <CheckCircle size={12} color="rgba(34, 197, 94, 0.6)" strokeWidth={2} />
    </View>
  );
}

function getActiveComponents(entity: Entity): ComponentDef[] {
  const components: ComponentDef[] = [];

  if (entity.track) {
    components.push({ icon: Crosshair, label: "Track", description: "Tracked object" });
  }
  if (entity.geo) {
    components.push({ icon: MapPin, label: "GeoSpatial", description: "Position data" });
  }
  if (entity.kinematics) {
    components.push({ icon: Gauge, label: "Kinematics", description: "Velocity & acceleration" });
  }
  if (entity.bearing) {
    components.push({ icon: Compass, label: "Bearing", description: "Azimuth & elevation" });
  }
  if (entity.camera) {
    const count = entity.camera.cameras?.length ?? 0;
    components.push({ icon: Camera, label: "Camera", description: `${count} feed(s)` });
  }
  if (entity.detection) {
    components.push({ icon: Target, label: "Detection", description: "Sensor detection" });
  }
  if (entity.locationUncertainty) {
    components.push({ icon: Radar, label: "Location Uncertainty", description: "Covariance data" });
  }
  if (entity.locator) {
    components.push({ icon: Scan, label: "Locator", description: "Location reference" });
  }
  if (entity.taskable) {
    components.push({ icon: ListTodo, label: "Taskable", description: "Can execute tasks" });
  }

  return components;
}

export function ComponentsTab({ entity }: ComponentsTabProps) {
  const components = getActiveComponents(entity);

  if (components.length === 0) {
    return (
      <View className="flex-1 items-center justify-center px-2.5 py-6">
        <Text className="font-sans-medium text-foreground/40 text-sm">No components</Text>
      </View>
    );
  }

  return (
    <ScrollView className="flex-1">
      <View className="px-3 pt-3 pb-2">
        <Text className="text-foreground/50 mb-1 font-mono text-[11px] tracking-widest uppercase">
          Active Components ({components.length})
        </Text>
        {components.map((comp) => (
          <ComponentItem key={comp.label} {...comp} />
        ))}
      </View>
    </ScrollView>
  );
}
