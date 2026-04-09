import type { DronePatrol, Vec2 } from "./types";

export function samplePatrolPosition(
  origin: Vec2,
  patrol: DronePatrol | undefined,
  elapsedMs: number,
): Vec2 {
  if (!patrol || patrol.points.length < 2 || patrol.speed <= 0) {
    return origin;
  }

  const pathLength = getPathLength(patrol.points);
  if (pathLength === 0) {
    return patrol.points[0] ?? origin;
  }

  const travelled = (elapsedMs / 1000) * patrol.speed;
  const cycleLength = pathLength * 2;
  let pathDistance = travelled % cycleLength;

  if (pathDistance > pathLength) {
    pathDistance = cycleLength - pathDistance;
  }

  return getPointAtDistance(patrol.points, pathDistance);
}

function getPathLength(points: Vec2[]): number {
  let total = 0;

  for (let index = 1; index < points.length; index += 1) {
    total += distance(points[index - 1], points[index]);
  }

  return total;
}

function getPointAtDistance(points: Vec2[], targetDistance: number): Vec2 {
  let remaining = targetDistance;

  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    const segmentLength = distance(start, end);

    if (segmentLength === 0) {
      continue;
    }

    if (remaining <= segmentLength) {
      const t = remaining / segmentLength;
      return {
        x: start.x + (end.x - start.x) * t,
        y: start.y + (end.y - start.y) * t,
      };
    }

    remaining -= segmentLength;
  }

  return points[points.length - 1];
}

function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
