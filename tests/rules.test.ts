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

  it("keeps guidedVisitor while guide memory is active even after resuming normal movement", () => {
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
        movementMode: "normal",
        speed: 48,
        isIndicating: false,
        isInSignalZone: false,
        isInGuideRange: false,
        isOnTrustedRoute: false,
        signalEnabled: true,
        carryingItemType: null,
        terminalMode: "none",
        visibleDroneIds: [],
      },
      guided.guideMemory,
      300,
    );

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

  it("keeps room two scanner suspicious of maintenance traffic that does not slow down", () => {
    const state = evaluateDroneState(
      {
        id: "scanner-b",
        kind: "scanner",
        visionRadius: 48,
        requiresSlowGuide: true,
      },
      {
        interpretation: "maintenanceCandidate",
        movementMode: "normal",
        speed: 110,
        playerVisible: true,
        isOnTrustedRoute: false,
        terminalMode: "maintenanceRequest",
        escortActive: false,
        escortDistracted: false,
      },
    );

    expect(state).toBe("Alert");
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

  it("allows room two maintenance access once both required slots are filled", () => {
    const door = ROOMS[1].doors[0];
    const requiredSlotIds = ROOMS[1].terminal?.slots.map((slot) => slot.id) ?? [];
    const filledSlotIds = ["power-slot", "service-tray"];

    expect(
      canDoorOpen(door.rule, {
        interpretation: "maintenanceCandidate",
        terminalMode: "maintenanceRequest",
        escortActive: false,
        residentServiceActive: true,
        movementMode: "slow",
        isInDroneRange: true,
        filledSlotIds,
        requiredSlotIds,
      }),
    ).toBe(true);

    expect(
      canDoorOpen(door.rule, {
        interpretation: "maintenanceCandidate",
        terminalMode: "maintenanceRequest",
        escortActive: false,
        residentServiceActive: true,
        movementMode: "normal",
        isInDroneRange: true,
        filledSlotIds,
        requiredSlotIds,
      }),
    ).toBe(true);

    expect(
      canDoorOpen(door.rule, {
        interpretation: "maintenanceCandidate",
        terminalMode: "maintenanceRequest",
        escortActive: false,
        residentServiceActive: true,
        movementMode: "slow",
        isInDroneRange: false,
        filledSlotIds,
        requiredSlotIds,
      }),
    ).toBe(true);

    expect(
      canDoorOpen(door.rule, {
        interpretation: "maintenanceCandidate",
        terminalMode: "maintenanceRequest",
        escortActive: false,
        movementMode: "slow",
        isInDroneRange: true,
        filledSlotIds: ["service-tray"],
        requiredSlotIds,
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

  it("keeps room one visitor identity after leaving scanner range", () => {
    const session = new GameSession();
    session.start();
    session.activateConsole("guide-console-a");

    session.updateIntent(
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
        visibleDroneIds: ["scanner-a"],
      },
      16,
    );

    const states = session.updateIntent(
      {
        movementMode: "normal",
        speed: 72,
        isIndicating: false,
        isInSignalZone: false,
        isInGuideRange: false,
        isOnTrustedRoute: true,
        signalEnabled: true,
        carryingItemType: null,
        terminalMode: "none",
        visibleDroneIds: [],
      },
      300,
    );

    const snapshot = session.getSnapshot();
    expect(snapshot.runtime.interpretation).toBe("guidedVisitor");
    expect(states["scanner-a"]).toBe("Observe");
    expect(
      session.canOpenDoor(ROOMS[0].doors[0], {
        movementMode: "normal",
        isInDroneRange: false,
      }),
    ).toBe(true);
  });

  it("keeps room one visitor identity after guide memory would normally expire", () => {
    const session = new GameSession();
    session.start();
    session.activateConsole("guide-console-a");

    session.updateIntent(
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
        visibleDroneIds: ["scanner-a"],
      },
      16,
    );

    session.updateIntent(
      {
        movementMode: "normal",
        speed: 72,
        isIndicating: false,
        isInSignalZone: false,
        isInGuideRange: false,
        isOnTrustedRoute: true,
        signalEnabled: true,
        carryingItemType: null,
        terminalMode: "none",
        visibleDroneIds: [],
      },
      5000,
    );

    const snapshot = session.getSnapshot();
    expect(snapshot.runtime.visitorFlowUnlocked).toBe(true);
    expect(snapshot.runtime.interpretation).toBe("guidedVisitor");
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
    expect(snapshot.runtime.escortReleased).toBe(false);
    expect(snapshot.runtime.terminalMode).toBe("none");
    expect(snapshot.runtime.triggeredIds).toHaveLength(0);
  });

  it("unlocks room three maintenance gate after the service tray battery is placed", () => {
    const session = new GameSession();
    session.start();
    session.goToNextRoom();
    session.goToNextRoom();

    expect(
      session.canOpenDoor(ROOMS[2].doors[0], {
        movementMode: "normal",
        isInDroneRange: false,
      }),
    ).toBe(false);

    session.placeItem("battery-main", "service-tray");
    session.updateIntent(
      {
        movementMode: "normal",
        speed: 72,
        isIndicating: false,
        isInSignalZone: false,
        isInGuideRange: false,
        isOnTrustedRoute: false,
        signalEnabled: false,
        carryingItemType: null,
        terminalMode: "maintenanceRequest",
        visibleDroneIds: [],
      },
      16,
    );

    expect(
      session.canOpenDoor(ROOMS[2].doors[0], {
        movementMode: "normal",
        isInDroneRange: false,
      }),
    ).toBe(true);
  });

  it("closes room three maintenance gate again after the player switches to visitor flow", () => {
    const session = new GameSession();
    session.start();
    session.goToNextRoom();
    session.goToNextRoom();

    session.placeItem("battery-main", "service-tray");
    session.markTrigger("escort-trigger");
    session.placeItem("battery-spare", "inspection-pad");
    session.updateIntent(
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
        visibleDroneIds: ["escort-c"],
      },
      16,
    );

    expect(session.getSnapshot().runtime.interpretation).toBe("guidedVisitor");
    expect(
      session.canOpenDoor(ROOMS[2].doors[0], {
        movementMode: "normal",
        isInDroneRange: false,
      }),
    ).toBe(false);
  });

  it("does not unlock room three maintenance gate from the inspection pad alone", () => {
    const session = new GameSession();
    session.start();
    session.goToNextRoom();
    session.goToNextRoom();

    session.placeItem("battery-spare", "inspection-pad");

    expect(
      session.canOpenDoor(ROOMS[2].doors[0], {
        movementMode: "normal",
        isInDroneRange: false,
      }),
    ).toBe(false);
  });

  it("resets interpretation and terminal mode when entering room three", () => {
    const session = new GameSession();
    session.start();
    session.goToNextRoom();

    session.placeItem("battery-a", "service-tray");
    session.updateIntent(
      {
        movementMode: "slow",
        speed: 0,
        isIndicating: false,
        isInSignalZone: false,
        isInGuideRange: false,
        isOnTrustedRoute: false,
        signalEnabled: false,
        carryingItemType: null,
        terminalMode: "maintenanceRequest",
        visibleDroneIds: [],
      },
      16,
    );
    let snapshot = session.getSnapshot();
    expect(snapshot.runtime.interpretation).toBe("maintenanceCandidate");
    expect(snapshot.runtime.terminalMode).toBe("maintenanceRequest");

    session.goToNextRoom();
    snapshot = session.getSnapshot();

    expect(snapshot.room.id).toBe("room-3");
    expect(snapshot.runtime.interpretation).toBe("intruder");
    expect(snapshot.runtime.terminalMode).toBe("none");
    expect(snapshot.runtime.guideMemory.remainingMs).toBe(0);
  });

  it("releases the escort after room three signal completion", () => {
    const session = new GameSession();
    session.start();
    session.goToNextRoom();
    session.goToNextRoom();
    session.placeItem("battery-main", "service-tray");
    session.markTrigger("escort-trigger");
    session.placeItem("battery-spare", "inspection-pad");

    const droneStates = session.updateIntent(
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
        visibleDroneIds: ["escort-c"],
      },
      16,
    );

    const snapshot = session.getSnapshot();
    expect(snapshot.runtime.interpretation).toBe("guidedVisitor");
    expect(snapshot.runtime.escortReleased).toBe(true);
    expect(droneStates["escort-c"]).toBe("Observe");
    expect(
      session.canOpenDoor(ROOMS[2].doors[1], {
        movementMode: "slow",
        isInDroneRange: true,
      }),
    ).toBe(true);
  });

  it("warns for about a second before locking the room", () => {
    const session = new GameSession();
    session.start();

    let states = session.updateIntent(
      {
        movementMode: "normal",
        speed: 110,
        isIndicating: false,
        isInSignalZone: false,
        isInGuideRange: false,
        isOnTrustedRoute: false,
        signalEnabled: false,
        carryingItemType: null,
        terminalMode: "none",
        visibleDroneIds: ["scanner-a"],
      },
      16,
    );

    expect(states["scanner-a"]).toBe("Warn");
    expect(session.getSnapshot().runtime.alertCountdownMs).toBeNull();
    expect(session.getSnapshot().runtime.alertWarningMs).toBe(1000);

    states = session.updateIntent(
      {
        movementMode: "normal",
        speed: 110,
        isIndicating: false,
        isInSignalZone: false,
        isInGuideRange: false,
        isOnTrustedRoute: false,
        signalEnabled: false,
        carryingItemType: null,
        terminalMode: "none",
        visibleDroneIds: ["scanner-a"],
      },
      1000,
    );

    expect(states["scanner-a"]).toBe("Alert");
    expect(session.getSnapshot().runtime.alertCountdownMs).toBeGreaterThan(0);
  });

  it("keeps room two maintenance access open without forcing slow movement", () => {
    const session = new GameSession();
    session.start();
    session.goToNextRoom();
    session.placeItem("battery-a", "service-tray");
    session.placeItem("battery-b", "power-slot");

    let states = session.updateIntent(
      {
        movementMode: "normal",
        speed: 110,
        isIndicating: false,
        isInSignalZone: false,
        isInGuideRange: false,
        isOnTrustedRoute: false,
        signalEnabled: false,
        carryingItemType: null,
        terminalMode: "maintenanceRequest",
        visibleDroneIds: ["scanner-b"],
      },
      1500,
    );

    expect(session.getSnapshot().runtime.interpretation).toBe("maintenanceCandidate");
    expect(states["scanner-b"]).toBe("Warn");
    expect(
      session.canOpenDoor(ROOMS[1].doors[0], {
        movementMode: "normal",
        isInDroneRange: true,
      }),
    ).toBe(true);

    states = session.updateIntent(
      {
        movementMode: "slow",
        speed: 56,
        isIndicating: false,
        isInSignalZone: false,
        isInGuideRange: false,
        isOnTrustedRoute: false,
        signalEnabled: false,
        carryingItemType: null,
        terminalMode: "maintenanceRequest",
        visibleDroneIds: ["scanner-b"],
      },
      300,
    );

    expect(states["scanner-b"]).toBe("Guide");
    expect(session.getSnapshot().runtime.alertWarningMs).toBe(0);
    expect(
      session.canOpenDoor(ROOMS[1].doors[0], {
        movementMode: "slow",
        isInDroneRange: false,
      }),
    ).toBe(true);
  });

  it("cancels the warning if the player recovers before punishment", () => {
    const session = new GameSession();
    session.start();

    session.updateIntent(
      {
        movementMode: "normal",
        speed: 110,
        isIndicating: false,
        isInSignalZone: false,
        isInGuideRange: false,
        isOnTrustedRoute: false,
        signalEnabled: false,
        carryingItemType: null,
        terminalMode: "none",
        visibleDroneIds: ["scanner-a"],
      },
      16,
    );

    const states = session.updateIntent(
      {
        movementMode: "slow",
        speed: 42,
        isIndicating: false,
        isInSignalZone: false,
        isInGuideRange: false,
        isOnTrustedRoute: false,
        signalEnabled: false,
        carryingItemType: null,
        terminalMode: "none",
        visibleDroneIds: ["scanner-a"],
      },
      300,
    );

    expect(states["scanner-a"]).toBe("Observe");
    expect(session.getSnapshot().runtime.alertWarningMs).toBe(0);
    expect(session.getSnapshot().runtime.alertCountdownMs).toBeNull();
  });
});
