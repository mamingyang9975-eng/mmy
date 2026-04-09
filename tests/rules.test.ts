import { describe, expect, it } from "vitest";
import { ROOMS } from "../src/game/content/rooms";
import {
  advanceInterpretation,
  canDoorOpen,
  createGuideMemory,
  createInterpretationScores,
  evaluateDroneState,
  resolveTerminalMode,
} from "../src/game/simulation/rules";
import { GameSession } from "../src/game/simulation/session";

function scoresFor(
  tag: "intruder" | "guidedVisitor" | "maintenanceCandidate",
  value = 7,
) {
  const scores = createInterpretationScores();
  scores[tag] = value;
  return scores;
}

function roomById(id: string) {
  const room = ROOMS.find((entry) => entry.id === id);
  if (!room) {
    throw new Error(`Missing room: ${id}`);
  }
  return room;
}

function advanceToRoom(session: GameSession, roomId: string): void {
  while (session.getSnapshot().room.id !== roomId) {
    const advanced = session.goToNextRoom();
    if (!advanced) {
      throw new Error(`Unable to reach room: ${roomId}`);
    }
  }
}

function enterRoomThree(session: GameSession): void {
  advanceToRoom(session, "room-3");
}

function enterRoomFour(session: GameSession): void {
  advanceToRoom(session, "room-4");
}

function enterRoomFive(session: GameSession): void {
  advanceToRoom(session, "room-5");
}

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
        activeWaitingZoneId: null,
      },
      createInterpretationScores(),
      "intruder",
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
        activeWaitingZoneId: null,
      },
      guided.scores,
      guided.tag,
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
        activeWaitingZoneId: null,
      },
      createInterpretationScores(),
      "intruder",
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
        activeWaitingZoneId: null,
      },
      guided.scores,
      guided.tag,
      guided.guideMemory,
      300,
    );

    expect(follow.tag).toBe("guidedVisitor");
  });

  it("refuses to interpret a disabled signal as guidance", () => {
    const result = advanceInterpretation(
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
      createInterpretationScores(),
      "intruder",
      createGuideMemory(),
      16,
    );

    expect(result.tag).toBe("intruder");
  });

  it("prioritizes maintenanceCandidate while maintenance mode is active", () => {
    const previousScores = createInterpretationScores();
    previousScores.maintenanceCandidate = 2.6;

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
        activeWaitingZoneId: null,
      },
      previousScores,
      "maintenanceCandidate",
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
        scores: scoresFor("intruder"),
        movementMode: "normal",
        speed: 110,
        playerVisible: true,
        isOnTrustedRoute: false,
        terminalMode: "none",
        escortActive: false,
        escortDistracted: false,
        escortRerouted: false,
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
        scores: scoresFor("maintenanceCandidate"),
        movementMode: "slow",
        speed: 48,
        playerVisible: true,
        isOnTrustedRoute: true,
        terminalMode: "maintenanceRequest",
        escortActive: true,
        escortDistracted: false,
        escortRerouted: false,
      },
    );

    expect(state).toBe("Escort");
  });

  it("lets rerouted escort drones drop back to Observe", () => {
    const state = evaluateDroneState(
      {
        id: "escort",
        kind: "escort",
        visionRadius: 120,
      },
      {
        interpretation: "maintenanceCandidate",
        scores: scoresFor("maintenanceCandidate"),
        movementMode: "slow",
        speed: 48,
        playerVisible: true,
        isOnTrustedRoute: true,
        terminalMode: "none",
        escortActive: true,
        escortDistracted: false,
        escortRerouted: true,
      },
    );

    expect(state).toBe("Observe");
  });
});

describe("door and terminal rules", () => {
  it("opens visitor doors only for guidedVisitor", () => {
    const door = ROOMS[0].doors[0];

    expect(
      canDoorOpen(door.rule, {
        interpretation: "guidedVisitor",
        scores: scoresFor("guidedVisitor"),
        terminalMode: "none",
        escortActive: false,
        movementMode: "slow",
        isInDroneRange: true,
      }),
    ).toBe(true);

    expect(
      canDoorOpen(door.rule, {
        interpretation: "intruder",
        scores: scoresFor("intruder"),
        terminalMode: "none",
        escortActive: false,
        movementMode: "slow",
        isInDroneRange: true,
      }),
    ).toBe(false);
  });

  it("allows room two maintenance access once both required slots are filled", () => {
    const room = roomById("room-2");
    const door = room.doors[0];
    const requiredSlotIds = room.terminal?.slots.map((slot) => slot.id) ?? [];
    const filledSlotIds = ["power-slot", "service-tray"];

    expect(
      canDoorOpen(door.rule, {
        interpretation: "maintenanceCandidate",
        scores: scoresFor("maintenanceCandidate"),
        terminalMode: "maintenanceRequest",
        escortActive: false,
        residentServiceActive: true,
        movementMode: "slow",
        isInDroneRange: true,
        filledSlotIds,
        requiredSlotIds,
      }),
    ).toBe(true);
  });

  it("resolves terminal slots into maintenance and fault modes", () => {
    const recipes = roomById("room-2").terminal?.recipes ?? [];
    expect(resolveTerminalMode(recipes, "service-tray", "battery")).toBe(
      "maintenanceRequest",
    );
    expect(resolveTerminalMode(recipes, "fault-slot", "battery")).toBe(
      "faultReport",
    );
    expect(resolveTerminalMode(recipes, "power-slot", "battery")).toBe("none");
  });

  it("expands room three and room four to give escort logic more space", () => {
    expect(roomById("room-3").dimensions?.width).toBe(512);
    expect(roomById("room-4").dimensions?.width).toBe(640);
  });

  it("keeps room four signal zone inside the final switch area before the exit wall", () => {
    const room = roomById("room-4");
    const signalZone = room.signalZones[0];
    const leftWallRight = room.wallRects[1].x + room.wallRects[1].width;
    const exitWallLeft = room.wallRects[2].x;

    expect(signalZone.rect.x).toBeGreaterThan(leftWallRight);
    expect(signalZone.rect.x + signalZone.rect.width).toBeLessThan(exitWallLeft);
  });
});

describe("GameSession", () => {
  it("keeps room one as intruder until the visitor registration panel is used", () => {
    const session = new GameSession();
    session.start();

    session.updateIntent(
      {
        movementMode: "slow",
        speed: 32,
        isIndicating: false,
        isInSignalZone: false,
        isInGuideRange: false,
        isOnTrustedRoute: false,
        signalEnabled: false,
        carryingItemType: null,
        terminalMode: "none",
        visibleDroneIds: [],
        activeWaitingZoneId: null,
      },
      120,
    );

    expect(session.getSnapshot().runtime.interpretation).toBe("intruder");

    session.activateConsole("registration-console-a");
    expect(session.getSnapshot().runtime.visitorFlowUnlocked).toBe(true);
    expect(session.getSnapshot().runtime.interpretation).toBe("guidedVisitor");

    session.updateIntent(
      {
        movementMode: "slow",
        speed: 32,
        isIndicating: false,
        isInSignalZone: false,
        isInGuideRange: false,
        isOnTrustedRoute: false,
        signalEnabled: false,
        carryingItemType: null,
        terminalMode: "none",
        visibleDroneIds: [],
      },
      120,
    );

    const snapshot = session.getSnapshot();
    expect(snapshot.runtime.interpretation).toBe("guidedVisitor");
    expect(snapshot.runtime.interpretationScores.guidedVisitor).toBeGreaterThan(
      snapshot.runtime.interpretationScores.intruder,
    );
    expect(
      session.canOpenDoor(ROOMS[0].doors[0], {
        movementMode: "slow",
        isInDroneRange: true,
      }),
    ).toBe(true);
  });

  it("supports room two's calmer visitor branch after a fault report", () => {
    const room = roomById("room-2");
    const alternateRule = room.doors[0].alternateRules?.[0];

    expect(alternateRule).toBeDefined();
    expect(
      canDoorOpen(alternateRule!, {
        interpretation: "guidedVisitor",
        scores: {
          intruder: 4,
          guidedVisitor: 8,
          maintenanceCandidate: 1,
        },
        terminalMode: "faultReport",
        escortActive: false,
        residentServiceActive: true,
        movementMode: "slow",
        isInDroneRange: true,
      }),
    ).toBe(true);
  });

  it("requires a fresh reception confirmation before the buffer door opens", () => {
    const room = roomById("room-1b");
    const door = room.doors[0];

    expect(
      canDoorOpen(door.rule, {
        interpretation: "guidedVisitor",
        scores: scoresFor("guidedVisitor"),
        terminalMode: "none",
        escortActive: false,
        movementMode: "slow",
        isInDroneRange: true,
        receptionConfirmedActive: false,
      }),
    ).toBe(false);

    expect(
      canDoorOpen(door.rule, {
        interpretation: "guidedVisitor",
        scores: scoresFor("guidedVisitor"),
        terminalMode: "none",
        escortActive: false,
        movementMode: "slow",
        isInDroneRange: true,
        receptionConfirmedActive: true,
      }),
    ).toBe(true);
  });

  it("requires office clearance before the office exit opens", () => {
    const room = roomById("room-5");
    const door = room.doors[0];

    expect(
      canDoorOpen(door.rule, {
        interpretation: "guidedVisitor",
        scores: scoresFor("guidedVisitor"),
        terminalMode: "none",
        escortActive: false,
        movementMode: "slow",
        isInDroneRange: true,
        officeClearanceActive: false,
      }),
    ).toBe(false);

    expect(
      canDoorOpen(door.rule, {
        interpretation: "guidedVisitor",
        scores: scoresFor("guidedVisitor"),
        terminalMode: "none",
        escortActive: false,
        movementMode: "slow",
        isInDroneRange: true,
        officeClearanceActive: true,
      }),
    ).toBe(true);
  });

  it("uses the room two fault slot as a noisy setup instead of an instant failure", () => {
    const session = new GameSession();
    session.start();
    advanceToRoom(session, "room-2");
    session.placeItem("battery-a", "fault-slot");

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
        terminalMode: "faultReport",
        visibleDroneIds: [],
      },
      2000,
    );

    const snapshot = session.getSnapshot();
    expect(snapshot.runtime.alertCountdownMs).toBeNull();
    expect(snapshot.runtime.residentStates["resident-b"]?.mode).not.toBe("idle");
  });

  it("lets the porter route nudge a slow player with a battery toward maintenance flow", () => {
    const session = new GameSession();
    session.start();
    advanceToRoom(session, "room-2");

    session.updateIntent(
      {
        playerPosition: { x: 74, y: 172 },
        movementMode: "slow",
        speed: 24,
        isIndicating: false,
        isInSignalZone: false,
        isInGuideRange: false,
        isOnTrustedRoute: false,
        signalEnabled: false,
        carryingItemType: "battery",
        terminalMode: "none",
        visibleDroneIds: [],
        activeWaitingZoneId: null,
      },
      300,
    );

    const snapshot = session.getSnapshot();
    expect(snapshot.runtime.porterFlowMs).toBeGreaterThan(0);
    expect(snapshot.runtime.interpretation).toBe("maintenanceCandidate");
    expect(snapshot.runtime.interpretationScores.maintenanceCandidate).toBeGreaterThan(
      snapshot.runtime.interpretationScores.guidedVisitor,
    );
  });

  it("lets a calm registered visitor pass room two through the fault-report branch", () => {
    const session = new GameSession();
    session.start();
    session.activateConsole("registration-console-a");
    advanceToRoom(session, "room-2");
    session.placeItem("battery-a", "fault-slot");

    session.updateIntent(
      {
        movementMode: "slow",
        speed: 18,
        isIndicating: false,
        isInSignalZone: false,
        isInGuideRange: true,
        isOnTrustedRoute: true,
        signalEnabled: false,
        carryingItemType: null,
        terminalMode: "faultReport",
        visibleDroneIds: ["scanner-b"],
        activeWaitingZoneId: null,
      },
      2200,
    );

    expect(session.getSnapshot().runtime.residentStates["resident-b"]?.mode).toBe(
      "waitingAtService",
    );
    expect(
      session.canOpenDoor(roomById("room-2").doors[0], {
        movementMode: "slow",
        isInDroneRange: true,
      }),
    ).toBe(true);
    expect(session.getSnapshot().runtime.interpretation).toBe("guidedVisitor");
  });

  it("uses the receptionist cycle to unlock the reception buffer door", () => {
    const session = new GameSession();
    session.start();
    session.activateConsole("registration-console-a");
    advanceToRoom(session, "room-1b");

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
        terminalMode: "none",
        visibleDroneIds: [],
        activeWaitingZoneId: "queue-a",
      },
      3000,
    );

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
        terminalMode: "none",
        visibleDroneIds: [],
        activeWaitingZoneId: "queue-a",
      },
      4000,
    );

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
        terminalMode: "none",
        visibleDroneIds: [],
        activeWaitingZoneId: "queue-a",
      },
      120,
    );

    const snapshot = session.getSnapshot();
    expect(snapshot.runtime.receptionConfirmedMs).toBeGreaterThan(0);
    expect(
      session.canOpenDoor(roomById("room-1b").doors[0], {
        movementMode: "slow",
        isInDroneRange: true,
      }),
    ).toBe(true);
  });

  it("keeps room three maintenance exit closed until the escort has been diverted", () => {
    const session = new GameSession();
    session.start();
    enterRoomThree(session);

    session.placeItem("battery-main", "service-tray");
    session.markTrigger("escort-trigger");
    session.updateIntent(
      {
        movementMode: "slow",
        speed: 56,
        isIndicating: false,
        isInSignalZone: false,
        isInGuideRange: false,
        isOnTrustedRoute: true,
        signalEnabled: false,
        carryingItemType: null,
        terminalMode: "maintenanceRequest",
        visibleDroneIds: ["escort-c"],
      },
      16,
    );

    expect(
      session.canOpenDoor(roomById("room-3").doors[1], {
        movementMode: "slow",
        isInDroneRange: true,
      }),
    ).toBe(false);

    session.placeItem("battery-spare", "inspection-pad");

    expect(
      session.canOpenDoor(roomById("room-3").doors[1], {
        movementMode: "slow",
        isInDroneRange: true,
      }),
    ).toBe(true);
    expect(session.getSnapshot().runtime.terminalMode).toBe("maintenanceRequest");
  });

  it("opens the room three maintenance gate as soon as a valid work order is active", () => {
    const session = new GameSession();
    session.start();
    enterRoomThree(session);
    session.placeItem("battery-main", "service-tray");
    session.updateIntent(
      {
        movementMode: "slow",
        speed: 48,
        isIndicating: false,
        isInSignalZone: false,
        isInGuideRange: false,
        isOnTrustedRoute: true,
        signalEnabled: false,
        carryingItemType: null,
        terminalMode: "maintenanceRequest",
        visibleDroneIds: [],
      },
      16,
    );

    expect(
      session.canOpenDoor(roomById("room-3").doors[0], {
        movementMode: "normal",
        isInDroneRange: false,
      }),
    ).toBe(false);

    expect(
      session.canOpenDoor(roomById("room-3").doors[0], {
        movementMode: "slow",
        isInDroneRange: false,
      }),
    ).toBe(true);
  });

  it("resets room three escort state on reset", () => {
    const session = new GameSession();
    session.start();
    enterRoomThree(session);
    session.placeItem("battery-main", "service-tray");
    session.markTrigger("escort-trigger");
    session.placeItem("battery-spare", "inspection-pad");

    session.resetRoom();
    const snapshot = session.getSnapshot();
    expect(snapshot.runtime.escortUnlocked).toBe(false);
    expect(snapshot.runtime.escortDistractedMs).toBe(0);
    expect(snapshot.runtime.triggeredIds).toHaveLength(0);
  });

  it("resets interpretation and terminal mode when entering room four", () => {
    const session = new GameSession();
    session.start();
    enterRoomThree(session);

    session.placeItem("battery-main", "service-tray");
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

    session.goToNextRoom();
    const snapshot = session.getSnapshot();
    expect(snapshot.room.id).toBe("room-4");
    expect(snapshot.runtime.interpretation).toBe("intruder");
    expect(snapshot.runtime.terminalMode).toBe("none");
  });

  it("uses the room four broadcast console to clear the local maintenance tag", () => {
    const session = new GameSession();
    session.start();
    enterRoomFour(session);

    session.placeItem("battery-main", "service-tray");
    session.markTrigger("escort-trigger");
    session.activateConsole("escort-reroute-console");

    const snapshot = session.getSnapshot();
    expect(snapshot.runtime.escortReroutedMs).toBeGreaterThan(0);
    expect(snapshot.runtime.terminalMode).toBe("none");
  });

  it("lets the archivist's review window reinforce visitor identity in room four", () => {
    const session = new GameSession();
    session.start();
    enterRoomFour(session);
    session.placeItem("battery-main", "service-tray");
    session.markTrigger("escort-trigger");
    session.activateConsole("escort-reroute-console");

    session.updateIntent(
      {
        playerPosition: { x: 486, y: 162 },
        movementMode: "slow",
        speed: 0,
        isIndicating: false,
        isInSignalZone: true,
        isInGuideRange: false,
        isOnTrustedRoute: false,
        signalEnabled: true,
        carryingItemType: null,
        terminalMode: "none",
        visibleDroneIds: [],
        activeWaitingZoneId: null,
      },
      2200,
    );

    const snapshot = session.getSnapshot();
    expect(snapshot.runtime.archiveReviewMs).toBeGreaterThan(0);
    expect(snapshot.runtime.interpretationScores.guidedVisitor).toBeGreaterThan(
      snapshot.runtime.interpretationScores.intruder,
    );
  });

  it("opens the room four maintenance gate on a slow approach once maintenance is registered", () => {
    const session = new GameSession();
    session.start();
    enterRoomFour(session);
    session.placeItem("battery-main", "service-tray");
    session.updateIntent(
      {
        movementMode: "slow",
        speed: 48,
        isIndicating: false,
        isInSignalZone: false,
        isInGuideRange: false,
        isOnTrustedRoute: true,
        signalEnabled: false,
        carryingItemType: null,
        terminalMode: "maintenanceRequest",
        visibleDroneIds: [],
      },
      16,
    );

    expect(
      session.canOpenDoor(roomById("room-4").doors[0], {
        movementMode: "slow",
        isInDroneRange: false,
      }),
    ).toBe(true);
  });

  it("lets the night clerk write a guided visitor into the office handover log", () => {
    const session = new GameSession();
    session.start();
    enterRoomFive(session);

    session.updateIntent(
      {
        playerPosition: { x: 540, y: 154 },
        movementMode: "slow",
        speed: 0,
        isIndicating: false,
        isInSignalZone: false,
        isInGuideRange: false,
        isOnTrustedRoute: true,
        signalEnabled: false,
        carryingItemType: null,
        terminalMode: "none",
        visibleDroneIds: [],
        activeWaitingZoneId: "handover-zone",
      },
      2600,
    );

    const snapshot = session.getSnapshot();
    expect(snapshot.runtime.officeClearanceMs).toBeGreaterThan(0);
    expect(
      session.canOpenDoor(roomById("room-5").doors[0], {
        movementMode: "slow",
        isInDroneRange: true,
      }),
    ).toBe(true);
  });

  it("releases the room four escort after signal completion and opens the visitor exit", () => {
    const session = new GameSession();
    session.start();
    enterRoomFour(session);
    session.placeItem("battery-main", "service-tray");
    session.markTrigger("escort-trigger");
    session.activateConsole("escort-reroute-console");

    const states = session.updateIntent(
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
        visibleDroneIds: ["escort-d"],
      },
      16,
    );

    const snapshot = session.getSnapshot();
    expect(snapshot.runtime.interpretation).toBe("guidedVisitor");
    expect(snapshot.runtime.escortReleased).toBe(true);
    expect(states["escort-d"]).toBe("Observe");
    expect(
      session.canOpenDoor(roomById("room-4").doors[1], {
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
