import type { BadgeVariant } from "@hydra/ui/badge";
import type { Entity } from "@projectqai/proto/world";
import { format } from "date-fns";

export type TrackStatus = "Friend" | "Hostile" | "Neutral" | "Unknown";
export type Timestamp = { seconds: bigint; nanos: number };

/**
 * Convert protobuf Timestamp to milliseconds since epoch
 */
export function timestampToMs(timestamp?: Timestamp): number {
  if (!timestamp) return 0;
  return Number(timestamp.seconds) * 1000 + Math.floor((timestamp.nanos || 0) / 1_000_000);
}

/**
 * Extract affiliation/status from MIL-STD-2525C SIDC
 * Character at index 1 determines affiliation:
 * - F = Friend (blue)
 * - H = Hostile (red)
 * - N = Neutral (greyish)
 * - U = Unknown (greyish)
 * - default = Unknown
 */
export function getTrackStatus(sidc: string): TrackStatus {
  const affiliation = sidc?.[1]?.toUpperCase();

  switch (affiliation) {
    case "F":
      return "Friend";
    case "H":
      return "Hostile";
    case "N":
      return "Neutral";
    case "U":
    default:
      return "Unknown";
  }
}

/**
 * Convert track status to badge variant for UI
 */
export function getStatusBadgeVariant(status: TrackStatus | null): BadgeVariant {
  if (status === "Friend") return "info";
  if (status === "Hostile") return "danger";
  return "neutral";
}

export function formatAltitude(altitudeMeters?: number): string {
  if (altitudeMeters == null) return "N/A";
  return `${Math.round(altitudeMeters)}m`;
}

export function formatTime(timestamp?: Timestamp): string {
  if (!timestamp) return "--:--:--";
  return format(new Date(timestampToMs(timestamp)), "HH:mm:ss");
}

export function getEntityName(entity: Entity): string {
  return entity.label || entity.controller?.name || entity.id;
}

/**
 * Tracks are entities marked with the TrackComponent
 * This includes air (drones, aircraft), ground (vehicles, tanks), and other tracked objects
 */
export function isTrack(entity: Entity): boolean {
  return !!(entity.geo && entity.symbol && entity.track);
}

/**
 * Assets are entities with geo and symbol but no track component
 */
export function isAsset(entity: Entity): boolean {
  return !entity.track && !!entity.symbol && !!entity.geo;
}

export function isExpired(entity: Entity): boolean {
  if (!entity.lifetime?.until) return false;
  return timestampToMs(entity.lifetime.until) < Date.now();
}

/**
 * Format coordinates for display
 */
export function formatCoordinate(value: number | undefined, type: "lat" | "lon"): string {
  if (value == null) return "N/A";
  const direction = type === "lat" ? (value >= 0 ? "N" : "S") : value >= 0 ? "E" : "W";
  return `${Math.abs(value).toFixed(6)}° ${direction}`;
}

export type ParsedCoordinates = {
  lat: number;
  lng: number;
  alt?: number;
};

/**
 * Parse DMS (degrees, minutes, seconds) to decimal degrees
 * e.g., "34°07'24.4"N" -> 34.123444...
 */
function parseDMS(dms: string): number | null {
  const match = dms.match(/(\d+)[°]\s*(\d+)?[′']?\s*(\d+\.?\d*)?[″"]?\s*([NSEW])?/i);
  if (!match) return null;

  const degrees = parseFloat(match[1] || "0");
  const minutes = parseFloat(match[2] || "0");
  const seconds = parseFloat(match[3] || "0");
  const direction = match[4]?.toUpperCase();

  let decimal = degrees + minutes / 60 + seconds / 3600;
  if (direction === "S" || direction === "W") decimal = -decimal;

  return decimal;
}

/**
 * Parse coordinates from various formats
 * Supports:
 * - Comma separated: "34.123456, -118.456789, 100"
 * - Space separated: "34.123456 -118.456789 100"
 * - DMS format: "34°07'24.4"N 118°27'24.4"W"
 */
export function parseCoordinates(input: string): ParsedCoordinates | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Try DMS format first (contains degree symbol)
  if (trimmed.includes("°")) {
    const parts = trimmed.split(/\s+/).filter((p) => p.includes("°"));
    if (parts.length >= 2) {
      const lat = parseDMS(parts[0]!);
      const lng = parseDMS(parts[1]!);
      if (lat !== null && lng !== null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
        return { lat, lng };
      }
    }
    return null;
  }

  // Try comma or space separated decimal format
  const numbers = trimmed
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => parseFloat(s))
    .filter((n) => !isNaN(n));

  if (numbers.length >= 2) {
    const [lat, lng, alt] = numbers;
    if (Math.abs(lat!) <= 90 && Math.abs(lng!) <= 180) {
      return { lat: lat!, lng: lng!, alt };
    }
  }

  return null;
}
