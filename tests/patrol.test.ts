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
  it("keeps scanner drones on compact patrols while later rooms widen the patrol radius", () => {
    const scanners = ROOMS.map((room) =>
      room.drones.find((drone) => drone.rule.kind === "scanner"),
    ).filter((scanner) => scanner !== undefined);

    expect(scanners.length).toBe(4);

    for (const scanner of scanners) {
      expect(scanner.rule.visionRadius).toBeGreaterThanOrEqual(48);
      expect(scanner.rule.visionRadius).toBeLessThanOrEqual(52);
      expect(scanner.patrol?.radius).toBeGreaterThanOrEqual(22);
      expect(scanner.patrol?.radius).toBeLessThanOrEqual(36);
      expect(scanner.patrol?.lingerMs).toBeGreaterThanOrEqual(1400);
      expect(scanner.patrol?.lingerMs).toBeLessThanOrEqual(1500);
      expect(scanner.patrol?.speed).toBeGreaterThanOrEqual(22);
      expect(scanner.patrol?.speed).toBeLessThanOrEqual(24);
    }

    expect((scanners[2].patrol?.radius ?? 0)).toBeGreaterThan(
      scanners[1].patrol?.radius ?? 0,
    );
    expect((scanners[3].patrol?.radius ?? 0)).toBeGreaterThan(
      scanners[2].patrol?.radius ?? 0,
    );
  });
});
