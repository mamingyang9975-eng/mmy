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
    const scannerByRoom = new Map(
      ROOMS.map((room) => [
        room.id,
        room.drones.find((drone) => drone.rule.kind === "scanner"),
      ]).filter((entry): entry is [string, NonNullable<(typeof ROOMS)[number]["drones"][number]>] => entry[1] !== undefined),
    );
    const scanners = [...scannerByRoom.values()];

    expect(scanners.length).toBe(6);

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

    expect((scannerByRoom.get("room-3")?.patrol?.radius ?? 0)).toBeGreaterThan(
      scannerByRoom.get("room-2")?.patrol?.radius ?? 0,
    );
    expect((scannerByRoom.get("room-4")?.patrol?.radius ?? 0)).toBeGreaterThan(
      scannerByRoom.get("room-3")?.patrol?.radius ?? 0,
    );
  });
});
