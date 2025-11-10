import { SensorSectors } from "@hydra/map-engine/constants";
import type { ActiveSensorSectors, CircleSector } from "@hydra/map-engine/types";

function isWithinSector(angle: number, sector: CircleSector): boolean {
  const { start, end } = sector;
  return start <= angle && end >= angle;
}

function isCircleSegmentOverlappingSector(
  segmentStart: number,
  segmentEnd: number,
  sector: CircleSector,
): boolean {
  const { start, end } = sector;
  return (
    isWithinSector(segmentStart, sector) ||
    isWithinSector(segmentEnd, sector) ||
    (segmentStart < start && segmentEnd > end)
  );
}

export function degreesToSectors<T extends { mid: number; width: number }>(
  sectorConfigs: T[],
): ActiveSensorSectors {
  const activeSectors: ActiveSensorSectors = new Set();

  sectorConfigs.forEach((sectorConfig) => {
    const { mid, width } = sectorConfig;
    const start = mid - width / 2;
    const end = mid + width / 2;

    // To ease calculations we move arguments to have start always in interval [0, 360]. If start angle
    // is negative we shift start by (1 + n) - times 360 degree, where n equals the integer divider
    // of 360 degree.
    const shiftToPositive = start < 0 ? (Math.floor((start * -1) / 360) + 1) * 360 : 0;
    // We also move arguments down to [0, 360] if start is greater than 360
    const shiftToCircleDomain = start > 360 ? Math.floor(start / 360) * 360 : 0;

    // Move segment angles from [-22.5, 337.5] to definition domain [0, 360] and apply
    // further argument shifting. Note that only the shift by 22.5 has to be considered also
    // for the sectors. shiftToPositive and shiftToCircleDomain do NOT change computation as
    // they are full shifts of 360 degree where sectors are equal
    const segmentStart = start + 22.5 + shiftToPositive - shiftToCircleDomain;
    const segmentEnd = end + 22.5 + shiftToPositive - shiftToCircleDomain;

    const segmentsToTest = [
      {
        start: segmentStart,
        end: segmentEnd,
      },
    ];
    // We split up the segment in case the end is greater than 360 degree, as the test will
    // fail for our hardcoded sectors in interval [-22.5, 337.5]
    if (segmentEnd > 360 && segmentsToTest[0] !== undefined) {
      segmentsToTest[0].end = 360;

      // add test segment for the part above 360 degree shifted by -360 degree
      segmentsToTest.push({
        start: 0,
        end: segmentEnd - 360,
      });
    }

    SensorSectors.forEach((sector) => {
      const sectorInSegmentDefinitionDomain = {
        ...sector,
        start: sector.start + 22.5, // we also need to shift sectors for computation
        end: sector.end + 22.5,
      };

      if (
        segmentsToTest.some(({ start, end }) =>
          isCircleSegmentOverlappingSector(start, end, sectorInSegmentDefinitionDomain),
        )
      ) {
        activeSectors.add(sector.label);
      }
    });
  });

  return activeSectors;
}
