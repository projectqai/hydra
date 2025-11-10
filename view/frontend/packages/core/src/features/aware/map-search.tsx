import { GradientPanel } from "@hydra/ui/lib/theme";
import { MapPin, Search, X } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Keyboard, Pressable, Text, TextInput, View } from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";

import { useMapEngine } from "./store/map-engine-store";

type SearchResult = {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
};

const SEARCH_WIDTH = 320;
const DEBOUNCE_MS = 300;

function formatResult(displayName: string): { primary: string; secondary: string } {
  const parts = displayName.split(",").map((s) => s.trim());
  const primary = parts[0] || displayName;
  const secondary = parts.slice(1, 3).join(", ");
  return { primary, secondary };
}

export function MapSearch() {
  const mapEngine = useMapEngine();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<TextInput>(null);

  const searchLocation = async (searchQuery: string) => {
    if (!searchQuery.trim()) {
      setResults([]);
      setShowResults(false);
      return;
    }

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    abortControllerRef.current = new AbortController();
    setIsLoading(true);
    setError(null);

    const response = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchQuery)}&limit=5`,
      {
        headers: {
          "User-Agent": "HydraApp/1.0",
          Accept: "application/json",
        },
        signal: abortControllerRef.current.signal,
      },
    ).catch((err) => {
      if (err instanceof Error && err.name === "AbortError") {
        return null;
      }
      console.error("Search failed:", err);
      setError("Search failed");
      setResults([]);
      setShowResults(false);
      setIsLoading(false);
      return null;
    });

    if (!response) {
      return;
    }

    if (!response.ok) {
      setError(`Search failed: ${response.status}`);
      setResults([]);
      setShowResults(false);
      setIsLoading(false);
      return;
    }

    const data = await response.json();
    setResults(data);
    setShowResults(data.length > 0);
    setIsLoading(false);
  };

  const handleQueryChange = (text: string) => {
    setQuery(text);

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    if (!text.trim()) {
      setResults([]);
      setShowResults(false);
      setError(null);
      return;
    }

    debounceRef.current = setTimeout(() => {
      searchLocation(text);
    }, DEBOUNCE_MS);
  };

  const handleSubmit = () => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    searchLocation(query);
  };

  const handleSelectResult = (result: SearchResult) => {
    const lat = parseFloat(result.lat);
    const lon = parseFloat(result.lon);

    const { primary } = formatResult(result.display_name);
    setQuery(primary);
    setResults([]);
    setShowResults(false);

    Keyboard.dismiss();

    requestAnimationFrame(() => {
      mapEngine.flyTo(lat, lon);
    });
  };

  const handleClear = () => {
    setQuery("");
    setResults([]);
    setShowResults(false);
    setError(null);
    inputRef.current?.focus();
  };

  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);

  return (
    <View
      className="absolute z-10"
      style={{
        bottom: 24,
        left: "50%",
        transform: [{ translateX: -SEARCH_WIDTH / 2 }],
        width: SEARCH_WIDTH,
      }}
    >
      {showResults && results.length > 0 && (
        <Animated.View entering={FadeIn.duration(150)} exiting={FadeOut.duration(100)}>
          <GradientPanel
            variant="dense"
            className="border-border/40 mb-2 overflow-hidden rounded-xl border"
          >
            {results.map((result, index) => {
              const { primary, secondary } = formatResult(result.display_name);
              return (
                <View key={result.place_id}>
                  {index > 0 && <View className="border-border/40 border-t" />}
                  <Pressable
                    onPress={() => handleSelectResult(result)}
                    className="flex-row items-center px-3 py-2.5 active:bg-white/10"
                  >
                    <View className="mr-3">
                      <MapPin size={18} color="rgba(255, 255, 255, 0.4)" />
                    </View>
                    <View className="flex-1">
                      <Text
                        className="text-foreground"
                        style={{ fontSize: 14, fontWeight: "500" }}
                        numberOfLines={1}
                      >
                        {primary}
                      </Text>
                      {secondary && (
                        <Text
                          className="text-muted-foreground"
                          style={{ fontSize: 12, marginTop: 2 }}
                          numberOfLines={1}
                        >
                          {secondary}
                        </Text>
                      )}
                    </View>
                  </Pressable>
                </View>
              );
            })}
          </GradientPanel>
        </Animated.View>
      )}

      <GradientPanel className="border-border/40 h-11 flex-row items-center overflow-hidden rounded-xl border px-3">
        <Search size={16} color="rgba(255, 255, 255, 0.5)" />
        <TextInput
          ref={inputRef}
          value={query}
          onChangeText={handleQueryChange}
          onSubmitEditing={handleSubmit}
          placeholder="Search location or address"
          placeholderTextColor="rgba(255, 255, 255, 0.4)"
          className="ml-2 h-full flex-1 font-sans text-sm text-white focus:outline-none focus-visible:outline-none"
          returnKeyType="search"
          autoCorrect={false}
          autoCapitalize="none"
        />
        {isLoading ? (
          <ActivityIndicator size="small" color="rgba(255, 255, 255, 0.5)" />
        ) : query ? (
          <Pressable onPress={handleClear} hitSlop={8}>
            <X size={16} color="rgba(255, 255, 255, 0.5)" />
          </Pressable>
        ) : null}
      </GradientPanel>

      {error && <Text className="mt-1 text-center text-xs text-red-400">{error}</Text>}
    </View>
  );
}
