import Phaser from "phaser";
import type { PathPoint, Rect, Vec2 } from "./types";

export function rectContains(rect: Rect, point: Vec2): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
}

export function rectCenter(rect: Rect): Vec2 {
  return {
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2,
  };
}

export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function distanceToRect(point: Vec2, rect: Rect): number {
  const clampedX = Phaser.Math.Clamp(point.x, rect.x, rect.x + rect.width);
  const clampedY = Phaser.Math.Clamp(point.y, rect.y, rect.y + rect.height);
  return distance(point, { x: clampedX, y: clampedY });
}

export function distanceToPolyline(point: Vec2, points: PathPoint[]): number {
  if (points.length < 2) {
    return Number.POSITIVE_INFINITY;
  }

  let minDistance = Number.POSITIVE_INFINITY;

  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    minDistance = Math.min(
      minDistance,
      distanceToSegment(point, start, end),
    );
  }

  return minDistance;
}

function distanceToSegment(point: Vec2, start: Vec2, end: Vec2): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;

  if (lengthSquared === 0) {
    return distance(point, start);
  }

  const t = Phaser.Math.Clamp(
    ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared,
    0,
    1,
  );

  return distance(point, {
    x: start.x + dx * t,
    y: start.y + dy * t,
  });
}
