import { describe, expect, it } from "vitest";
import { ROOMS } from "../src/game/content/rooms";
import {
  createPatrolTarget,
  hasReachedTarget,
  moveTowardTarget,
} from "../src/game/simulation/patrol";

describe("patrol helpers", () => {
  it("creates wander targets inside the configured radius", () => {
    const patrol = {
      speed: 20,
      radius: 24,
    };
    const origin = { x: 10, y: 10 };

    expect(createPatrolTarget(origin, patrol, 0, 1)).toEqual({
      x: 34,
      y: 10,
    });
    expect(createPatrolTarget(origin, patrol, Math.PI / 2, 0.5)).toEqual({
      x: 10,
      y: 22,
    });
  });

  it("moves toward targets without overshooting and reports arrival", () => {
    const advanced = moveTowardTarget(
      { x: 10, y: 10 },
      { x: 22, y: 10 },
      12,
      500,
    );

    expect(advanced).toEqual({ x: 16, y: 10 });
    expect(hasReachedTarget(advanced, { x: 22, y: 10 })).toBe(false);
    expect(
      moveTowardTarget({ x: 20, y: 10 }, { x: 22, y: 10 }, 12, 500),
    ).toEqual({ x: 22, y: 10 });
    expect(hasReachedTarget({ x: 22, y: 10 }, { x: 22, y: 10 })).toBe(true);
  });
});

describe("scanner room tuning", () => {
  it("keeps scanner drones on short patrols with a two-cell radius and escalating speeds", () => {
    const scanners = ROOMS.map((room) =>
      room.drones.find((drone) => drone.rule.kind === "scanner"),
    ).filter((scanner) => scanner !== undefined);

    expect(scanners.length).toBe(3);

    for (const scanner of scanners) {
      expect(scanner.rule.visionRadius).toBe(48);
      expect(scanner.patrol?.radius).toBeGreaterThanOrEqual(22);
      expect(scanner.patrol?.radius).toBeLessThanOrEqual(26);
      expect(scanner.patrol?.lingerMs).toBe(1500);
      expect(scanner.patrol?.speed).toBe(scanner.patrol?.radius);
    }

    const speeds = scanners.map((scanner) => scanner.patrol?.speed ?? 0);
    expect(speeds[0]).toBeLessThan(speeds[1]);
    expect(speeds[1]).toBeLessThan(speeds[2]);
  });
});
