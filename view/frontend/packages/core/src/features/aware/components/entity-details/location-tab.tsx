import { InfoRow } from "@hydra/ui/info-row";
import type { Entity } from "@projectqai/proto/world";
import { Compass } from "lucide-react-native";
import { ScrollView, Text, View } from "react-native";

type LocationTabProps = {
  entity: Entity;
};

export function LocationTab({ entity }: LocationTabProps) {
  return (
    <ScrollView className="flex-1">
      <View>
        {entity.bearing && (
          <View className="px-3 pt-2 pb-2">
            <Text className="text-foreground/50 mb-1 font-mono text-[11px] tracking-widest uppercase">
              Bearing
            </Text>
            {entity.bearing.azimuth !== undefined && (
              <InfoRow
                icon={Compass}
                label="Azimuth"
                value={`${entity.bearing.azimuth.toFixed(1)}°`}
              />
            )}
            {entity.bearing.elevation !== undefined && (
              <InfoRow
                icon={Compass}
                label="Elevation"
                value={`${entity.bearing.elevation.toFixed(1)}°`}
              />
            )}
          </View>
        )}

        {entity.locationUncertainty && (
          <View className="border-foreground/10 border-t px-3 pt-3 pb-2">
            <Text className="text-foreground/50 mb-1 font-mono text-[11px] tracking-widest uppercase">
              Location Uncertainty
            </Text>
            {entity.locationUncertainty.positionEnuCov && (
              <View className="gap-0.5 py-1.5">
                <Text className="font-sans-medium text-foreground/80 text-xs">
                  Position Covariance (ENU)
                </Text>
                <Text className="text-foreground/50 font-mono text-[11px]">
                  {JSON.stringify(entity.locationUncertainty.positionEnuCov, null, 2)}
                </Text>
              </View>
            )}
            {entity.locationUncertainty.velocityEnuCov && (
              <View className="gap-0.5 py-1.5">
                <Text className="font-sans-medium text-foreground/80 text-xs">
                  Velocity Covariance (ENU)
                </Text>
                <Text className="text-foreground/50 font-mono text-[11px]">
                  {JSON.stringify(entity.locationUncertainty.velocityEnuCov, null, 2)}
                </Text>
              </View>
            )}
          </View>
        )}
      </View>
    </ScrollView>
  );
}
