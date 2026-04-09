import { describe, expect, it } from "vitest";
import { ROOMS } from "../src/game/content/rooms";
import {
  advanceInterpretation,
  canDoorOpen,
  createGuideMemory,
  evaluateDroneState,
  resolveTerminalMode,
} from "../src/game/simulation/rules";
import { GameSession } from "../src/game/simulation/session";

describe("advanceInterpretation", () => {
  it("enters guidedVisitor after a completed signal and slow movement inside guide range", () => {
    const guided = advanceInterpretation(
      {
        movementMode: "slow",
        speed: 0,
        isIndicating: true,
        isInSignalZone: true,
        isInGuideRange: false,
        isOnTrustedRoute: false,
        signalEnabled: true,
        carryingItemType: null,
        terminalMode: "none",
        visibleDroneIds: [],
      },
      createGuideMemory(),
      16,
    );

    const follow = advanceInterpretation(
      {
        movementMode: "slow",
        speed: 48,
        isIndicating: false,
        isInSignalZone: false,
        isInGuideRange: true,
        isOnTrustedRoute: true,
        signalEnabled: true,
        carryingItemType: null,
        terminalMode: "none",
        visibleDroneIds: [],
      },
      guided.guideMemory,
      300,
    );

    expect(guided.tag).toBe("guidedVisitor");
    expect(follow.tag).toBe("guidedVisitor");
  });

  it("allows the signal zone to establish guided flow without holding slow", () => {
    const guided = advanceInterpretation(
      {
        movementMode: "normal",
        speed: 0,
        isIndicating: true,
        isInSignalZone: true,
        isInGuideRange: false,
        isOnTrustedRoute: false,
        signalEnabled: true,
        carryingItemType: null,
        terminalMode: "none",
        visibleDroneIds: [],
      },
      createGuideMemory(),
      16,
    );

    expect(guided.tag).toBe("guidedVisitor");
  });

  it("prioritizes maintenanceCandidate while maintenance mode is active", () => {
    const result = advanceInterpretation(
      {
        movementMode: "slow",
        speed: 40,
        isIndicating: true,
        isInSignalZone: true,
        isInGuideRange: true,
        isOnTrustedRoute: true,
        signalEnabled: true,
        carryingItemType: "battery",
        terminalMode: "maintenanceRequest",
        visibleDroneIds: [],
      },
      createGuideMemory(),
      120,
    );

    expect(result.tag).toBe("maintenanceCandidate");
  });
});

describe("evaluateDroneState", () => {
  it("alerts when an intruder is visible and moving off-path at normal speed", () => {
    const state = evaluateDroneState(
      {
        id: "scanner",
        kind: "scanner",
        visionRadius: 80,
      },
      {
        interpretation: "intruder",
        movementMode: "normal",
        speed: 110,
        playerVisible: true,
        isOnTrustedRoute: false,
        terminalMode: "none",
        escortActive: false,
        escortDistracted: false,
      },
    );

    expect(state).toBe("Alert");
  });

  it("switches an escort drone to Escort while maintenance flow is active", () => {
    const state = evaluateDroneState(
      {
        id: "escort",
        kind: "escort",
        visionRadius: 120,
      },
      {
        interpretation: "maintenanceCandidate",
        movementMode: "slow",
        speed: 48,
        playerVisible: true,
        isOnTrustedRoute: true,
        terminalMode: "maintenanceRequest",
        escortActive: true,
        escortDistracted: false,
      },
    );

    expect(state).toBe("Escort");
  });
});

describe("door and terminal rules", () => {
  it("opens visitor doors only for guidedVisitor", () => {
    const room = ROOMS[0];
    const door = room.doors[0];

    expect(
      canDoorOpen(door.rule, {
        interpretation: "guidedVisitor",
        terminalMode: "none",
        escortActive: false,
        movementMode: "slow",
        isInDroneRange: true,
      }),
    ).toBe(true);

    expect(
      canDoorOpen(door.rule, {
        interpretation: "intruder",
        terminalMode: "none",
        escortActive: false,
        movementMode: "slow",
        isInDroneRange: true,
      }),
    ).toBe(false);
  });

  it("requires room two maintenance access to happen while slow inside drone range", () => {
    const door = ROOMS[1].doors[0];

    expect(
      canDoorOpen(door.rule, {
        interpretation: "maintenanceCandidate",
        terminalMode: "maintenanceRequest",
        escortActive: false,
        movementMode: "slow",
        isInDroneRange: true,
      }),
    ).toBe(true);

    expect(
      canDoorOpen(door.rule, {
        interpretation: "maintenanceCandidate",
        terminalMode: "maintenanceRequest",
        escortActive: false,
        movementMode: "normal",
        isInDroneRange: true,
      }),
    ).toBe(false);

    expect(
      canDoorOpen(door.rule, {
        interpretation: "maintenanceCandidate",
        terminalMode: "maintenanceRequest",
        escortActive: false,
        movementMode: "slow",
        isInDroneRange: false,
      }),
    ).toBe(false);
  });

  it("resolves terminal slots into maintenance and fault modes", () => {
    const recipes = ROOMS[1].terminal?.recipes ?? [];
    expect(resolveTerminalMode(recipes, "service-tray", "battery")).toBe(
      "maintenanceRequest",
    );
    expect(resolveTerminalMode(recipes, "fault-slot", "battery")).toBe(
      "faultReport",
    );
    expect(resolveTerminalMode(recipes, "power-slot", "battery")).toBe("none");
  });

  it("keeps the room two service tray on the player's side of the wall", () => {
    const room = ROOMS[1];
    const wallX = room.wallRects[0].x;
    const serviceTray = room.terminal?.slots.find(
      (slot) => slot.id === "service-tray",
    );

    expect(serviceTray).toBeDefined();
    expect((serviceTray?.rect.x ?? 999) + (serviceTray?.rect.width ?? 0)).toBeLessThan(
      wallX,
    );
  });

  it("keeps the room three signal zone between the two doors", () => {
    const room = ROOMS[2];
    const signalZone = room.signalZones[0];
    const leftWallRight = room.wallRects[1].x + room.wallRects[1].width;
    const rightWallLeft = room.wallRects[2].x;

    expect(signalZone.rect.x).toBeGreaterThanOrEqual(leftWallRight);
    expect(signalZone.rect.x + signalZone.rect.width).toBeLessThanOrEqual(
      rightWallLeft,
    );
  });
});

describe("GameSession", () => {
  it("requires the room one console before the signal zone can establish guided flow", () => {
    const session = new GameSession();
    session.start();

    let guided = advanceInterpretation(
      {
        movementMode: "slow",
        speed: 0,
        isIndicating: true,
        isInSignalZone: true,
        isInGuideRange: false,
        isOnTrustedRoute: false,
        signalEnabled: false,
        carryingItemType: null,
        terminalMode: "none",
        visibleDroneIds: [],
      },
      createGuideMemory(),
      16,
    );

    expect(guided.tag).toBe("intruder");

    session.activateConsole("guide-console-a");
    expect(session.getSnapshot().runtime.guideFieldPrimed).toBe(true);

    guided = advanceInterpretation(
      {
        movementMode: "slow",
        speed: 0,
        isIndicating: true,
        isInSignalZone: true,
        isInGuideRange: false,
        isOnTrustedRoute: false,
        signalEnabled: true,
        carryingItemType: null,
        terminalMode: "none",
        visibleDroneIds: [],
      },
      createGuideMemory(),
      16,
    );

    expect(guided.tag).toBe("guidedVisitor");
  });

  it("spawns the escort flow in room three and resets room state", () => {
    const session = new GameSession();
    session.start();
    session.goToNextRoom();
    session.goToNextRoom();
    session.placeItem("battery-main", "service-tray");
    session.markTrigger("escort-trigger");

    let snapshot = session.getSnapshot();
    expect(snapshot.runtime.escortUnlocked).toBe(true);
    expect(snapshot.runtime.terminalMode).toBe("maintenanceRequest");

    session.placeItem("battery-spare", "inspection-pad");
    snapshot = session.getSnapshot();
    expect(snapshot.runtime.escortDistractedMs).toBeGreaterThan(0);
    expect(snapshot.runtime.terminalMode).toBe("none");

    session.resetRoom();
    snapshot = session.getSnapshot();
    expect(snapshot.runtime.escortUnlocked).toBe(false);
    expect(snapshot.runtime.terminalMode).toBe("none");
    expect(snapshot.runtime.triggeredIds).toHaveLength(0);
  });
});
