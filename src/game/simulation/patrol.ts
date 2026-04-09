import type { DronePatrol, Vec2 } from "./types";

export function createPatrolTarget(
  origin: Vec2,
  patrol: DronePatrol | undefined,
  angleRadians: number,
  distanceFactor: number,
): Vec2 {
  if (!patrol || patrol.radius <= 0) {
    return origin;
  }

  const radius = patrol.radius * clamp(distanceFactor, 0.45, 1);
  return {
    x: origin.x + Math.cos(angleRadians) * radius,
    y: origin.y + Math.sin(angleRadians) * radius,
  };
}

export function moveTowardTarget(
  current: Vec2,
  target: Vec2,
  speed: number,
  deltaMs: number,
): Vec2 {
  if (speed <= 0 || deltaMs <= 0) {
    return current;
  }

  const dx = target.x - current.x;
  const dy = target.y - current.y;
  const remaining = Math.hypot(dx, dy);

  if (remaining === 0) {
    return target;
  }

  const maxStep = (speed * deltaMs) / 1000;
  if (maxStep >= remaining) {
    return target;
  }

  const t = maxStep / remaining;
  return {
    x: current.x + dx * t,
    y: current.y + dy * t,
  };
}

export function hasReachedTarget(
  current: Vec2,
  target: Vec2,
  threshold = 3,
): boolean {
  return distance(current, target) <= threshold;
}

function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
