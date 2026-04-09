import { ROOMS } from "../content/rooms";
import {
  advanceInterpretation,
  canDoorOpen,
  createGuideMemory,
  evaluateDroneState,
  resolveTerminalMode,
} from "./rules";
import type {
  DoorContext,
  DoorDefinition,
  DroneContext,
  DroneState,
  MovementMode,
  PlayerIntentSnapshot,
  RoomDefinition,
  RoomRuntime,
  SessionSnapshot,
  TerminalMode,
} from "./types";

const ALERT_RESET_MS = 5000;
const ESCORT_DISTRACT_MS = 3200;

function createRuntime(room: RoomDefinition): RoomRuntime {
  return {
    terminalMode: "none",
    interpretation: "intruder",
    guideMemory: createGuideMemory(),
    guideFieldPrimed: false,
    placedItems: Object.fromEntries(room.items.map((item) => [item.id, null])),
    escortUnlocked: false,
    escortDistractedMs: 0,
    alertCountdownMs: null,
    triggeredIds: [],
    message: room.hint,
  };
}

export class GameSession {
  private roomIndex = 0;
  private runtime = createRuntime(ROOMS[0]);
  private paused = true;
  private complete = false;

  getSnapshot(): SessionSnapshot {
    return {
      roomIndex: this.roomIndex,
      room: this.getRoom(),
      runtime: this.runtime,
      isPaused: this.paused,
      isComplete: this.complete,
    };
  }

  getRoom(): RoomDefinition {
    return ROOMS[this.roomIndex];
  }

  start(): void {
    this.paused = false;
    this.runtime.message = this.getRoom().hint;
  }

  togglePause(): void {
    if (this.complete) {
      return;
    }
    this.paused = !this.paused;
  }

  setPaused(value: boolean): void {
    if (this.complete) {
      return;
    }
    this.paused = value;
  }

  updateIntent(snapshot: PlayerIntentSnapshot, deltaMs: number): Record<string, DroneState> {
    if (this.paused || this.complete) {
      return this.getDroneStates(snapshot);
    }

    if (this.runtime.alertCountdownMs !== null) {
      this.runtime.alertCountdownMs = Math.max(
        0,
        this.runtime.alertCountdownMs - deltaMs,
      );
      this.runtime.message = `区域已锁定，${Math.ceil(
        this.runtime.alertCountdownMs / 1000,
      )} 秒后重置。`;
      if (this.runtime.alertCountdownMs === 0) {
        this.resetRoom();
      }
      return this.getDroneStates(snapshot);
    }

    if (this.runtime.escortDistractedMs > 0) {
      this.runtime.escortDistractedMs = Math.max(
        0,
        this.runtime.escortDistractedMs - deltaMs,
      );
    }

    const interpretation = advanceInterpretation(
      snapshot,
      this.runtime.guideMemory,
      deltaMs,
    );
    this.runtime.guideMemory = interpretation.guideMemory;
    this.runtime.interpretation = interpretation.tag;

    const droneStates = this.getDroneStates(snapshot);

    if (Object.values(droneStates).includes("Alert")) {
      this.triggerAlert();
    } else if (!this.runtime.message) {
      this.runtime.message = this.getRoom().hint;
    }

    return droneStates;
  }

  placeItem(itemId: string, slotId: string | null): TerminalMode {
    const room = this.getRoom();
    const item = room.items.find((entry) => entry.id === itemId);

    if (!item) {
      return this.runtime.terminalMode;
    }

    this.runtime.placedItems[itemId] = slotId;

    const terminalMode = room.terminal
      ? resolveTerminalMode(room.terminal.recipes, slotId, item.itemType)
      : "none";

    this.runtime.terminalMode = terminalMode;

    if (room.id === "room-3" && slotId === "inspection-pad") {
      this.runtime.terminalMode = "none";
      this.runtime.escortDistractedMs = ESCORT_DISTRACT_MS;
      this.runtime.message =
        "护送机被检修台吸引。站定在中段示意区按住空格，即可切回访客流量。";
      return this.runtime.terminalMode;
    }

    if (terminalMode === "faultReport") {
      this.runtime.message = "异常槽触发故障上报。";
      this.triggerAlert();
    } else if (terminalMode === "maintenanceRequest") {
      this.runtime.message = "系统已把你登记为维修流量。";
    } else {
      this.runtime.message = room.hint;
    }

    return this.runtime.terminalMode;
  }

  activateConsole(consoleId: string): void {
    const room = this.getRoom();
    const consoleDef = room.consoles?.find((entry) => entry.id === consoleId);

    if (!consoleDef) {
      return;
    }

    if (consoleDef.action === "primeGuidance") {
      this.runtime.guideFieldPrimed = true;
      this.runtime.message =
        "引导面板已激活。现在站定在感应区按住空格示意，然后在巡逻机范围内慢行。";
    }
  }

  clearItemPlacement(itemId: string): void {
    this.runtime.placedItems[itemId] = null;
    if (
      Object.values(this.runtime.placedItems).every(
        (slotId) => slotId !== "service-tray",
      )
    ) {
      this.runtime.terminalMode = "none";
    }
  }

  canOpenDoor(
    door: DoorDefinition,
    approach?: {
      movementMode?: MovementMode;
      isInDroneRange?: boolean;
    },
  ): boolean {
    const context: DoorContext = {
      interpretation: this.runtime.interpretation,
      terminalMode: this.runtime.terminalMode,
      escortActive:
        this.runtime.escortUnlocked && this.runtime.escortDistractedMs <= 0,
      movementMode: approach?.movementMode,
      isInDroneRange: approach?.isInDroneRange,
    };
    return canDoorOpen(door.rule, context);
  }

  markTrigger(triggerId: string): void {
    if (this.runtime.triggeredIds.includes(triggerId)) {
      return;
    }

    this.runtime.triggeredIds.push(triggerId);

    if (triggerId === "escort-trigger") {
      this.runtime.escortUnlocked = true;
      this.runtime.message =
        "护送流量已接入。维修身份会被一路跟随。";
    }
  }

  goToNextRoom(): boolean {
    if (this.roomIndex >= ROOMS.length - 1) {
      this.complete = true;
      this.paused = true;
      this.runtime.message = "观察室：系统只是在替你完成那些最像你的选择。";
      return false;
    }

    this.roomIndex += 1;
    this.runtime = createRuntime(this.getRoom());
    this.paused = false;
    return true;
  }

  resetRoom(): void {
    this.runtime = createRuntime(this.getRoom());
    this.paused = false;
  }

  private triggerAlert(): void {
    if (this.runtime.alertCountdownMs !== null) {
      return;
    }
    this.runtime.alertCountdownMs = ALERT_RESET_MS;
    this.runtime.message = "已被标记为入侵者。";
  }

  private getDroneStates(
    snapshot: PlayerIntentSnapshot,
  ): Record<string, DroneState> {
    const room = this.getRoom();
    const states: Record<string, DroneState> = {};

    for (const drone of room.drones) {
      const context: DroneContext = {
        interpretation: this.runtime.interpretation,
        movementMode: snapshot.movementMode,
        speed: snapshot.speed,
        playerVisible: snapshot.visibleDroneIds.includes(drone.id),
        isOnTrustedRoute: snapshot.isOnTrustedRoute,
        terminalMode: this.runtime.terminalMode,
        escortActive: this.runtime.escortUnlocked,
        escortDistracted: this.runtime.escortDistractedMs > 0,
      };
      states[drone.id] = evaluateDroneState(drone.rule, context);
    }

    return states;
  }
}
