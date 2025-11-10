import { format } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { useEffect, useState } from "react";
import { Text, type TextStyle, View } from "react-native";

type TimeDisplayProps = {
  label: string;
  time: string;
  subtitle: string;
};

function TimeDisplay({ label, time, subtitle }: TimeDisplayProps) {
  return (
    <View>
      <Text className="text-muted-foreground font-sans-medium text-[10px] leading-tight">
        {label}
      </Text>
      <Text
        className="text-foreground font-mono text-xs leading-tight"
        style={{ fontVariantNumeric: "tabular-nums" } as TextStyle}
      >
        {time}
      </Text>
      <Text className="text-muted-foreground font-sans text-[10px]">{subtitle}</Text>
    </View>
  );
}

export function TimeWidget() {
  const [time, setTime] = useState<Date | null>(null);

  useEffect(() => {
    setTime(new Date());
    const interval = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  if (!time) {
    return (
      <View className="android:pl-2 h-11 flex-row gap-8">
        <TimeDisplay label="Local Time" time="--:--:--" subtitle="Loading..." />
        <TimeDisplay label="UTC Time" time="--:--:--" subtitle="Coordinated Universal Time" />
      </View>
    );
  }

  const localTime = format(time, "HH:mm:ss");
  const localDate = format(time, "EEEE, MMMM d, yyyy");
  const utcTime = formatInTimeZone(time, "UTC", "HH:mm:ss");

  return (
    <View className="android:pl-2 h-11 flex-row gap-8">
      <TimeDisplay label="Local Time" time={localTime} subtitle={localDate} />
      <TimeDisplay label="UTC Time" time={utcTime} subtitle="Coordinated Universal Time" />
    </View>
  );
}
