import { Badge } from "@hydra/ui/badge";
import { truncateMiddle } from "@hydra/ui/lib/utils";
import { Tab, Tabs } from "@hydra/ui/tabs";
import type { Entity } from "@projectqai/proto/world";
import * as Clipboard from "expo-clipboard";
import { Copy, Eye, Info, MapPin, Settings, SquareStack } from "lucide-react-native";
import type { ReactNode } from "react";
import { createContext, useContext, useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { toast } from "sonner-native";

import {
  getEntityName,
  getStatusBadgeVariant,
  getTrackStatus,
} from "../../../../lib/api/use-track-utils";
import { useUrlParams } from "../../../../lib/use-url-params";
import { useTabStore } from "../../store/tab-store";
import { ComponentsTab } from "./components-tab";
import { ConfigTab } from "./config-tab";
import { InfoTab } from "./info-tab";
import { LocationTab } from "./location-tab";
import { OverviewTab } from "./overview-tab";

type EntityDetailsContextValue = {
  entity: Entity;
  entityName: string;
  status: "Blue" | "Red" | "Neutral" | "Unknown" | null;
};

const EntityDetailsContext = createContext<EntityDetailsContextValue | null>(null);

function useEntityDetails() {
  const context = useContext(EntityDetailsContext);
  if (!context) throw new Error("EntityDetails components must be used within EntityDetails.Root");
  return context;
}

function Root({ entity, children }: { entity: Entity; children: ReactNode }) {
  const status = entity.symbol?.milStd2525C ? getTrackStatus(entity.symbol.milStd2525C) : null;
  const entityName = getEntityName(entity);

  return (
    <EntityDetailsContext.Provider value={{ entity, entityName, status }}>
      <View className="flex-1">{children}</View>
    </EntityDetailsContext.Provider>
  );
}

function Header({ children }: { children?: ReactNode }) {
  const { entity, entityName, status } = useEntityDetails();

  const copyToClipboard = async (text: string) => {
    await Clipboard.setStringAsync(text);
    toast("Copied to clipboard");
  };

  return (
    <View className="border-foreground/5 border-b px-3 pt-2 pb-2.5">
      <View className="flex-row items-center justify-between">
        <Text className="font-sans-semibold text-foreground text-[15px]">{entityName}</Text>
        {status && (
          <Badge variant={getStatusBadgeVariant(status)} size="sm">
            {status}
          </Badge>
        )}
      </View>

      <Pressable
        onPress={() => copyToClipboard(entity.id)}
        className="mt-3 mb-2.5 flex-row items-center gap-1.5 active:opacity-70"
        hitSlop={8}
      >
        <Text className="text-foreground/50 flex-1 font-mono text-xs">
          {truncateMiddle(entity.id)}
        </Text>
        <Copy size={12} color="rgba(255, 255, 255, 0.4)" strokeWidth={2} />
      </Pressable>

      {children}
    </View>
  );
}

function DetailTabs() {
  const { entity } = useEntityDetails();
  const { params } = useUrlParams();
  const storedTab = useTabStore((s) => s.initialTab);
  const clearInitialTab = useTabStore((s) => s.clearInitialTab);

  const hasLocationTab = !!(entity.bearing || entity.locationUncertainty);
  const hasInfoTab = !!(entity.symbol || entity.lifetime);
  const hasConfigTab = !!entity.config;
  const availableTabs = [
    "overview",
    ...(hasLocationTab ? ["location"] : []),
    ...(hasInfoTab ? ["info"] : []),
    ...(hasConfigTab ? ["config"] : []),
    "components",
  ];

  const initialTab = params.tab ?? storedTab ?? "overview";
  const [activeTab, setActiveTab] = useState(initialTab);

  useEffect(() => {
    if (storedTab) clearInitialTab();
  }, [storedTab, clearInitialTab]);

  useEffect(() => {
    if (params.tab && !availableTabs.includes(params.tab)) {
      toast.error(`Tab "${params.tab}" not available for this entity`);
    }
  }, [params.tab, availableTabs]);

  const handleTabChange = (tabName: string) => {
    setActiveTab(tabName);
  };

  return (
    <Tabs currentTab={activeTab} onTabChange={handleTabChange}>
      <Tab name="overview" title="Overview" subtitle="Overview" icon={Eye}>
        <OverviewTab entity={entity} />
      </Tab>
      {hasLocationTab && (
        <Tab name="location" title="Location" subtitle="Location" icon={MapPin}>
          <LocationTab entity={entity} />
        </Tab>
      )}
      {hasInfoTab && (
        <Tab name="info" title="Info" subtitle="Info" icon={Info}>
          <InfoTab entity={entity} />
        </Tab>
      )}
      {hasConfigTab && (
        <Tab name="config" title="Config" subtitle="Config" icon={Settings}>
          <ConfigTab entity={entity} />
        </Tab>
      )}
      <Tab name="components" title="Components" subtitle="Components" icon={SquareStack}>
        <ComponentsTab entity={entity} />
      </Tab>
    </Tabs>
  );
}

export { useEntityDetails };

export const EntityDetails = {
  Root,
  Header,
  Tabs: DetailTabs,
};
