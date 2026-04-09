import type { DoorDefinition, Vec2 } from "./types";

export function canAdvanceThroughDoor(
  door: DoorDefinition,
  doorWasOpen: boolean,
  playerPos: Vec2,
): boolean {
  if (!door.exitToNextRoom || !doorWasOpen) {
    return false;
  }

  return (
    playerPos.x > door.rect.x + door.rect.width + 12 &&
    playerPos.y >= door.rect.y - 6 &&
    playerPos.y <= door.rect.y + door.rect.height + 6
  );
}
