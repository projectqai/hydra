import type { KinematicsEnu } from "@projectqai/proto/world";

export function calculateGroundSpeed(velocityEnu?: KinematicsEnu): number | undefined {
  if (!velocityEnu) return undefined;
  const east = velocityEnu.east ?? 0;
  const north = velocityEnu.north ?? 0;
  if (east === 0 && north === 0) return undefined;
  return Math.sqrt(east * east + north * north);
}

export function calculateCourseFromVelocity(velocityEnu?: KinematicsEnu): number | undefined {
  if (!velocityEnu) return undefined;
  const east = velocityEnu.east ?? 0;
  const north = velocityEnu.north ?? 0;
  if (east === 0 && north === 0) return undefined;
  return ((Math.atan2(east, north) * 180) / Math.PI + 360) % 360;
}

export function calculateVerticalRate(velocityEnu?: KinematicsEnu): number | undefined {
  if (!velocityEnu?.up) return undefined;
  return velocityEnu.up;
}

export function formatSpeed(speedMs?: number): string {
  if (speedMs === undefined) return "—";
  return `${speedMs.toFixed(0)} m/s`;
}

export function formatCourse(degrees?: number): string {
  if (degrees === undefined) return "—";
  return `${degrees.toFixed(0)}°`;
}

export function formatVerticalRate(upMs?: number): string {
  if (upMs === undefined) return "—";
  const sign = upMs >= 0 ? "+" : "";
  return `${sign}${upMs.toFixed(1)} m/s`;
}

export function formatAcceleration(accelerationEnu?: KinematicsEnu): string {
  if (!accelerationEnu) return "—";
  const east = accelerationEnu.east ?? 0;
  const north = accelerationEnu.north ?? 0;
  const up = accelerationEnu.up ?? 0;
  const magnitude = Math.sqrt(east * east + north * north + up * up);
  if (magnitude === 0) return "—";
  return `${magnitude.toFixed(2)} m/s²`;
}
