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
  ResidentRuntime,
  SessionSnapshot,
  TerminalMode,
  Vec2,
} from "./types";

const ALERT_RESET_MS = 5000;
const ALERT_WARNING_MS = 1000;
const ESCORT_DISTRACT_MS = 3200;

function createRuntime(room: RoomDefinition): RoomRuntime {
  return {
    terminalMode: "none",
    interpretation: "intruder",
    guideMemory: createGuideMemory(),
    guideFieldPrimed: false,
    visitorFlowUnlocked: false,
    placedItems: Object.fromEntries(room.items.map((item) => [item.id, null])),
    unlockedDoorIds: [],
    escortUnlocked: false,
    escortReleased: false,
    escortDistractedMs: 0,
    alertWarningMs: 0,
    alertCountdownMs: null,
    triggeredIds: [],
    residentStates: Object.fromEntries(
      room.residents.map((resident) => [
        resident.id,
        {
          mode: "idle",
          position: { ...resident.position },
        } satisfies ResidentRuntime,
      ]),
    ),
    message: room.hint,
  };
}

function getFilledSlotIds(
  placedItems: Record<string, string | null>,
): string[] {
  return Object.values(placedItems).filter(
    (slotId): slotId is string => slotId !== null,
  );
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

    this.updateResidents(deltaMs);

    const interpretation = advanceInterpretation(
      snapshot,
      this.runtime.guideMemory,
      deltaMs,
    );
    this.runtime.guideMemory = interpretation.guideMemory;
    if (interpretation.tag === "guidedVisitor") {
      this.runtime.visitorFlowUnlocked = true;
    }

    this.runtime.interpretation =
      this.runtime.terminalMode === "maintenanceRequest"
        ? "maintenanceCandidate"
        : this.runtime.visitorFlowUnlocked
          ? "guidedVisitor"
          : interpretation.tag;

    if (
      !this.runtime.escortReleased &&
      this.getRoom().id === "room-3" &&
      this.runtime.escortUnlocked &&
      this.runtime.interpretation === "guidedVisitor"
    ) {
      this.runtime.escortReleased = true;
      this.runtime.escortDistractedMs = 0;
      this.runtime.message = "当前通道已切回普通访客模式。护送机改回独立巡查。";
    }

    const droneStates = this.getDroneStates(snapshot);

    if (Object.values(droneStates).includes("Alert")) {
      const warningStates = this.updateAlertWarning(droneStates, deltaMs);
      if (warningStates) {
        return warningStates;
      }
    } else {
      if (this.runtime.alertWarningMs > 0) {
        this.runtime.message = this.getDefaultMessage();
      }
      this.runtime.alertWarningMs = 0;
      if (!this.runtime.message) {
        this.runtime.message = this.getDefaultMessage();
      }
    }

    if (!this.runtime.message) {
      this.runtime.message = this.getDefaultMessage();
    }

    return droneStates;
  }

  placeItem(itemId: string, slotId: string | null): TerminalMode {
    const room = this.getRoom();
    if (!room.items.some((entry) => entry.id === itemId)) {
      return this.runtime.terminalMode;
    }

    this.runtime.placedItems[itemId] = slotId;
    this.runtime.terminalMode = this.resolveCurrentTerminalMode();

    if (room.id === "room-3" && slotId === "service-tray") {
      this.unlockDoor("maintenance-gate");
    }

    if (room.id === "room-3" && slotId === "inspection-pad") {
      this.runtime.terminalMode = "none";
      this.runtime.escortDistractedMs = ESCORT_DISTRACT_MS;
      this.runtime.message =
        "护送机被检修台吸引。站到中段示意区里按住 Space 停留两秒，即可恢复普通通道权限。";
      return this.runtime.terminalMode;
    }

    if (this.runtime.terminalMode === "faultReport") {
      this.runtime.message = "异常槽触发故障上报。";
      this.triggerAlert();
    } else if (this.runtime.terminalMode === "maintenanceRequest") {
      this.runtime.message = "服务终端已登记维修请求。";
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
        "引导面板已激活。现在站到感应区里按住 Space 停留两秒示意，然后在巡逻机范围内慢行。";
    }
  }

  clearItemPlacement(itemId: string): void {
    this.runtime.placedItems[itemId] = null;
    this.runtime.terminalMode = this.resolveCurrentTerminalMode();
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
        this.runtime.escortUnlocked &&
        !this.runtime.escortReleased &&
        this.runtime.escortDistractedMs <= 0,
      residentServiceActive: this.hasResidentWaitingAtService(),
      movementMode: approach?.movementMode,
      isInDroneRange: approach?.isInDroneRange,
      filledSlotIds: getFilledSlotIds(this.runtime.placedItems),
      requiredSlotIds: this.getRoom().terminal?.slots.map((slot) => slot.id) ?? [],
    };

    if (this.runtime.unlockedDoorIds.includes(door.id)) {
      return canDoorOpen(
        {
          ...door.rule,
          requiresSlowMovement: false,
          requiresSlowInDroneRange: false,
        },
        context,
      );
    }

    return canDoorOpen(door.rule, context);
  }

  private unlockDoor(doorId: string): void {
    if (!this.runtime.unlockedDoorIds.includes(doorId)) {
      this.runtime.unlockedDoorIds.push(doorId);
    }
  }

  private resolveCurrentTerminalMode(): TerminalMode {
    const room = this.getRoom();
    if (!room.terminal) {
      return "none";
    }

    const placedModes = room.items
      .map((item) => {
        const slotId = this.runtime.placedItems[item.id];
        return resolveTerminalMode(room.terminal!.recipes, slotId, item.itemType);
      })
      .filter((mode) => mode !== "none");

    if (placedModes.includes("faultReport")) {
      return "faultReport";
    }

    if (placedModes.includes("maintenanceRequest")) {
      return "maintenanceRequest";
    }

    return "none";
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
      this.runtime.message = "观察室：设施已经按它熟悉的流程把你一路送到了这里。";
      return false;
    }

    this.enterRoom(this.roomIndex + 1);
    return true;
  }

  resetRoom(): void {
    this.enterRoom(this.roomIndex);
  }

  private enterRoom(roomIndex: number): void {
    this.roomIndex = roomIndex;
    this.runtime = createRuntime(ROOMS[this.roomIndex]);
    this.paused = false;
  }

  private triggerAlert(): void {
    if (this.runtime.alertCountdownMs !== null) {
      return;
    }
    this.runtime.alertWarningMs = 0;
    this.runtime.alertCountdownMs = ALERT_RESET_MS;
      this.runtime.message = "当前区域已转入高警戒。";
  }

  private updateResidents(deltaMs: number): void {
    const room = this.getRoom();
    if (room.residents.length === 0) {
      return;
    }

    const serviceShouldBeActive =
      this.runtime.terminalMode === "maintenanceRequest" &&
      this.runtime.alertCountdownMs === null;

    for (const resident of room.residents) {
      const runtimeState = this.runtime.residentStates[resident.id];
      if (!runtimeState) {
        continue;
      }

      const target = serviceShouldBeActive
        ? resident.servicePoint
        : resident.position;
      const nextPosition = moveTowards(
        runtimeState.position,
        target,
        resident.speed,
        deltaMs,
      );

      runtimeState.position = nextPosition;

      if (samePoint(nextPosition, target)) {
        runtimeState.mode = serviceShouldBeActive
          ? "waitingAtService"
          : "idle";
      } else if (serviceShouldBeActive) {
        runtimeState.mode = "answeringService";
      } else {
        runtimeState.mode = "idle";
      }
    }

    if (room.id !== "room-2") {
      return;
    }

    const waiting = this.hasResidentWaitingAtService();

    if (waiting && this.runtime.terminalMode === "maintenanceRequest") {
      this.runtime.message =
        "居民已到服务等候点。门侧确认完成，维修通道已准备放行。";
      return;
    }

    if (
      serviceShouldBeActive &&
      Object.values(this.runtime.residentStates).some(
        (resident) => resident.mode === "answeringService",
      )
    ) {
      this.runtime.message = "居民正在响应服务请求，等它到达门侧等候点。";
    }
  }

  private hasResidentWaitingAtService(): boolean {
    return Object.values(this.runtime.residentStates).some(
      (resident) => resident.mode === "waitingAtService",
    );
  }

  private updateAlertWarning(
    droneStates: Record<string, DroneState>,
    deltaMs: number,
  ): Record<string, DroneState> | null {
    if (this.runtime.alertWarningMs === 0) {
      this.runtime.alertWarningMs = ALERT_WARNING_MS;
    } else {
      this.runtime.alertWarningMs = Math.max(
        0,
        this.runtime.alertWarningMs - deltaMs,
      );
    }

    if (this.runtime.alertWarningMs === 0) {
      this.triggerAlert();
      return null;
    }

    this.runtime.message = "巡逻机正在锁定你，立刻慢行或脱离范围。";

    return Object.fromEntries(
      Object.entries(droneStates).map(([id, state]) => [
        id,
        state === "Alert" ? "Warn" : state,
      ]),
    ) as Record<string, DroneState>;
  }

  private getDefaultMessage(): string {
    if (
      this.getRoom().id === "room-2" &&
      this.runtime.terminalMode === "maintenanceRequest" &&
      this.hasResidentWaitingAtService()
    ) {
      return "居民已在门侧确认服务。保持慢行，沿维修通道通过。";
    }
    if (this.runtime.terminalMode === "maintenanceRequest") {
      return "服务终端已登记维修请求。";
    }
    if (this.runtime.guideFieldPrimed) {
      return "引导面板已激活。现在站到感应区里按住 Space 停留两秒示意，然后在巡逻机范围内慢行。";
    }
    return this.getRoom().hint;
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
        escortActive:
          this.runtime.escortUnlocked && !this.runtime.escortReleased,
        escortDistracted: this.runtime.escortDistractedMs > 0,
      };
      states[drone.id] = evaluateDroneState(drone.rule, context);
    }

    return states;
  }
}

function moveTowards(
  from: Vec2,
  to: Vec2,
  speed: number,
  deltaMs: number,
): Vec2 {
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  if (distance === 0) {
    return { ...to };
  }

  const step = (speed * deltaMs) / 1000;
  if (step >= distance) {
    return { ...to };
  }

  const ratio = step / distance;
  return {
    x: from.x + (to.x - from.x) * ratio,
    y: from.y + (to.y - from.y) * ratio,
  };
}

function samePoint(a: Vec2, b: Vec2): boolean {
  return Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5;
}
