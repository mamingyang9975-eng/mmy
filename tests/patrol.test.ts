import { describe, expect, it } from "vitest";
import { ROOMS } from "../src/game/content/rooms";
import { samplePatrolPosition } from "../src/game/simulation/patrol";

describe("samplePatrolPosition", () => {
  it("moves along the route and ping-pongs back to the start", () => {
    const patrol = {
      speed: 20,
      points: [
        { x: 10, y: 10 },
        { x: 30, y: 10 },
      ],
    };

    expect(samplePatrolPosition(patrol.points[0], patrol, 0)).toEqual({
      x: 10,
      y: 10,
    });
    expect(samplePatrolPosition(patrol.points[0], patrol, 500)).toEqual({
      x: 20,
      y: 10,
    });
    expect(samplePatrolPosition(patrol.points[0], patrol, 1000)).toEqual({
      x: 30,
      y: 10,
    });
    expect(samplePatrolPosition(patrol.points[0], patrol, 1500)).toEqual({
      x: 20,
      y: 10,
    });
  });
});

describe("scanner room tuning", () => {
  it("keeps scanner drones on short patrols with a two-cell radius and escalating speeds", () => {
    const scanners = ROOMS.map((room) =>
      room.drones.find((drone) => drone.rule.kind === "scanner"),
    ).filter((scanner) => scanner !== undefined);

    expect(scanners.length).toBe(3);

    for (const scanner of scanners) {
      expect(scanner.patrol?.points.length ?? 0).toBeGreaterThanOrEqual(2);
      expect(scanner.rule.visionRadius).toBe(48);
      expect(scanner.patrol?.points[0]).toEqual(scanner.position);
    }

    const speeds = scanners.map((scanner) => scanner.patrol?.speed ?? 0);
    expect(speeds[0]).toBeLessThan(speeds[1]);
    expect(speeds[1]).toBeLessThan(speeds[2]);
  });
});
