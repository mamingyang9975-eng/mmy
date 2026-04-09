import { describe, expect, it } from "vitest";
import { canAdvanceThroughDoor } from "../src/game/simulation/exits";
import { ROOMS } from "../src/game/content/rooms";

describe("canAdvanceThroughDoor", () => {
  const exitDoor = ROOMS[0].doors[0];

  it("allows room transition once the player has crossed an already open exit", () => {
    expect(
      canAdvanceThroughDoor(exitDoor, true, {
        x: exitDoor.rect.x + exitDoor.rect.width + 20,
        y: exitDoor.rect.y + exitDoor.rect.height / 2,
      }),
    ).toBe(true);
  });

  it("blocks transition when the exit was not open yet", () => {
    expect(
      canAdvanceThroughDoor(exitDoor, false, {
        x: exitDoor.rect.x + exitDoor.rect.width + 20,
        y: exitDoor.rect.y + exitDoor.rect.height / 2,
      }),
    ).toBe(false);
  });
});
