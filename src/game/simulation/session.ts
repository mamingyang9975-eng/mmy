import { ROOMS } from "../content/rooms";
import {
  advanceInterpretation,
  canDoorOpen,
  createGuideMemory,
  createInterpretationScores,
  evaluateDroneState,
  resolveInterpretationTag,
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
  StaffRuntime,
  TerminalMode,
  Vec2,
} from "./types";

const ALERT_RESET_MS = 5000;
const ALERT_WARNING_MS = 1000;
const ESCORT_DISTRACT_MS = 3200;
const ESCORT_REROUTE_MS = 4200;
const RECEPTION_CONFIRM_MS = 5000;

function createRuntime(room: RoomDefinition): RoomRuntime {
  return {
    terminalMode: "none",
    interpretation: "intruder",
    interpretationScores: createInterpretationScores(),
    guideMemory: createGuideMemory(),
    guideFieldPrimed: false,
    visitorFlowUnlocked: false,
    placedItems: Object.fromEntries(room.items.map((item) => [item.id, null])),
    unlockedDoorIds: [],
    escortUnlocked: false,
    escortReleased: false,
    escortDistractedMs: 0,
    escortReroutedMs: 0,
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
    staffStates: Object.fromEntries(
      (room.staff ?? []).map((staff) => [
        staff.id,
        {
          mode: "idleAtDesk",
          position: { ...staff.position },
          stateMs: staff.idleMs,
          hasConfirmedCurrentCycle: false,
        } satisfies StaffRuntime,
      ]),
    ),
    receptionConfirmedMs: 0,
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

  updateIntent(
    snapshot: PlayerIntentSnapshot,
    deltaMs: number,
  ): Record<string, DroneState> {
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

    this.runtime.escortDistractedMs = Math.max(
      0,
      this.runtime.escortDistractedMs - deltaMs,
    );
    this.runtime.escortReroutedMs = Math.max(
      0,
      this.runtime.escortReroutedMs - deltaMs,
    );
    this.runtime.receptionConfirmedMs = Math.max(
      0,
      this.runtime.receptionConfirmedMs - deltaMs,
    );

    this.updateResidents(deltaMs);
    this.updateStaff(snapshot, deltaMs);

    const interpretation = advanceInterpretation(
      snapshot,
      this.runtime.interpretationScores,
      this.runtime.interpretation,
      this.runtime.guideMemory,
      deltaMs,
    );
    this.runtime.guideMemory = interpretation.guideMemory;
    this.runtime.interpretationScores = interpretation.scores;
    this.applyVisitorRegistration();
    this.applyReceptionConfirmation();
    if (
      resolveInterpretationTag(
        this.runtime.interpretationScores,
        this.runtime.interpretation,
      ) === "guidedVisitor" &&
      this.getRoom().id !== "room-1"
    ) {
      this.runtime.visitorFlowUnlocked = true;
    }

    this.runtime.interpretation =
      this.runtime.terminalMode === "maintenanceRequest"
        ? "maintenanceCandidate"
        : resolveInterpretationTag(
            this.runtime.interpretationScores,
            this.runtime.interpretation,
          );

    if (this.getRoom().id === "room-1") {
      if (this.runtime.visitorFlowUnlocked) {
        this.runtime.interpretationScores.guidedVisitor = Math.max(
          this.runtime.interpretationScores.guidedVisitor,
          8,
        );
        this.runtime.interpretationScores.intruder = 0;
        this.runtime.interpretation = "guidedVisitor";
      } else {
        this.runtime.interpretationScores.guidedVisitor = 0;
        this.runtime.interpretationScores.intruder = Math.max(
          this.runtime.interpretationScores.intruder,
          4,
        );
        this.runtime.interpretation = "intruder";
      }
    }

    if (
      !this.runtime.escortReleased &&
      this.getRoom().id === "room-4" &&
      this.runtime.escortUnlocked &&
      this.runtime.interpretation === "guidedVisitor"
    ) {
      this.runtime.escortReleased = true;
      this.runtime.escortReroutedMs = 0;
      this.runtime.message =
        "本地工单已结束，系统开始把你重新归类为被引导访客，护送机也会停止贴身跟随。";
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

    if (room.id === "room-3" && slotId === "inspection-pad") {
      this.runtime.escortDistractedMs = ESCORT_DISTRACT_MS;
      this.runtime.message =
        "检修台吸走了护送机的注意力。趁它偏离路线时，继续保持维修身份，穿过作业出口。";
      return this.runtime.terminalMode;
    }

    if (this.runtime.terminalMode === "faultReport") {
      this.runtime.message =
        room.id === "room-2"
          ? "异常上报把住户和扫描机的注意力都拉向服务门。你还没被当成维修人员，但已经制造出更快的确认窗口。"
          : "异常槽触发故障上报。";
    } else if (this.runtime.terminalMode === "maintenanceRequest") {
      this.runtime.message =
        room.id === "room-3"
          ? "系统已登记你的维修工单。现在第一道门认你了，但护送流程也会开始跟上来。"
          : room.id === "room-4"
            ? "系统已登记你的维修工单。它会帮你通过第一道门，但也会把你牢牢拴在维修流程里。"
            : "服务终端已登记维修请求。";
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
        "引导面板已激活。现在站到感应区里按住空格停留两秒示意，然后在扫描机视野内慢行。";
      return;
    }

    if (consoleDef.action === "registerVisitor") {
      this.runtime.visitorFlowUnlocked = true;
      this.runtime.interpretation = "guidedVisitor";
      this.runtime.interpretationScores = {
        intruder: 0,
        guidedVisitor: 8,
        maintenanceCandidate: 0,
      };
      this.runtime.message =
        "登记面板已录入访客身份。你现在会被系统识别为访客，可以从访客门通过。";
      return;
    }

    if (consoleDef.action === "rerouteEscort") {
      this.runtime.escortReroutedMs = ESCORT_REROUTE_MS;
      this.runtime.terminalMode = "none";
      this.runtime.message =
        "广播台把护送机改派到复核位，本地维修工单也被转出。趁这个窗口去示意区，把自己切回访客流程。";
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
      scores: this.runtime.interpretationScores,
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
      receptionConfirmedActive: this.runtime.receptionConfirmedMs > 0,
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

    return [door.rule, ...(door.alternateRules ?? [])].some((rule) =>
      canDoorOpen(rule, context),
    );
  }

  markTrigger(triggerId: string): void {
    if (this.runtime.triggeredIds.includes(triggerId)) {
      return;
    }

    this.runtime.triggeredIds.push(triggerId);

    if (triggerId === "escort-trigger") {
      this.runtime.escortUnlocked = true;
      this.runtime.message =
        this.getRoom().id === "room-3"
          ? "护送流程已接入。维修身份会继续帮你穿过设施，但出口现在会拒绝带着护送的对象。"
          : "护送流程已接入。维修身份会一路给你开门，但想离开这一层，你得想办法让系统改口。";
    }
  }

  goToNextRoom(): boolean {
    if (this.roomIndex >= ROOMS.length - 1) {
      this.complete = true;
      this.paused = true;
      this.runtime.message =
        "观察室：你不是躲开了系统，而是一路牵着它的解释，走过了整个设施。";
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

  private triggerAlert(): void {
    if (this.runtime.alertCountdownMs !== null) {
      return;
    }
    this.runtime.alertWarningMs = 0;
    this.runtime.alertCountdownMs = ALERT_RESET_MS;
    this.runtime.message = "当前区域已转入高警戒。";
  }

  private applyVisitorRegistration(): void {
    if (!this.runtime.visitorFlowUnlocked) {
      return;
    }

    this.runtime.interpretationScores.guidedVisitor += 2.8;
    this.runtime.interpretationScores.intruder = Math.max(
      0,
      this.runtime.interpretationScores.intruder - 0.9,
    );
  }

  private applyReceptionConfirmation(): void {
    if (this.runtime.receptionConfirmedMs <= 0) {
      return;
    }

    this.runtime.interpretationScores.guidedVisitor += 4;
    this.runtime.interpretationScores.intruder = Math.max(
      0,
      this.runtime.interpretationScores.intruder - 2,
    );
  }

  private updateResidents(deltaMs: number): void {
    const room = this.getRoom();
    if (room.residents.length === 0) {
      return;
    }

    const serviceShouldBeActive =
      (this.runtime.terminalMode === "maintenanceRequest" ||
        (room.id === "room-2" && this.runtime.terminalMode === "faultReport")) &&
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
        "住户已到服务等待点。门侧确认完成，维修通道已准备放行。";
      return;
    }

    if (waiting && this.runtime.terminalMode === "faultReport") {
      this.runtime.message =
        "故障上报把住户提前叫到了门侧。现在换成正确托盘，系统会更快把你误认成被呼叫来的维修人员。";
      return;
    }

    if (
      serviceShouldBeActive &&
      Object.values(this.runtime.residentStates).some(
        (resident) => resident.mode === "answeringService",
      )
    ) {
      this.runtime.message =
        this.runtime.terminalMode === "faultReport"
          ? "住户正在响应异常上报。你已经制造出流程噪音，但还没拿到真正的维修身份。"
          : "住户正在响应服务请求，等他到达门侧等待点。";
    }
  }

  private updateStaff(
    snapshot: PlayerIntentSnapshot,
    deltaMs: number,
  ): void {
    const room = this.getRoom();
    if (!room.staff?.length) {
      return;
    }

    for (const staff of room.staff) {
      const runtimeState = this.runtime.staffStates[staff.id];
      if (!runtimeState) {
        continue;
      }

      if (staff.role !== "receptionist") {
        continue;
      }

      if (runtimeState.mode === "walkingToTerminal") {
        const nextPosition = moveTowards(
          runtimeState.position,
          staff.terminalPoint,
          staff.speed,
          deltaMs,
        );
        runtimeState.position = nextPosition;
        if (samePoint(nextPosition, staff.terminalPoint)) {
          runtimeState.mode = "checkingQueue";
          runtimeState.stateMs = staff.checkMs;
          runtimeState.hasConfirmedCurrentCycle = false;
        }
        continue;
      }

      if (runtimeState.mode === "returningToDesk") {
        const nextPosition = moveTowards(
          runtimeState.position,
          staff.deskPoint,
          staff.speed,
          deltaMs,
        );
        runtimeState.position = nextPosition;
        if (samePoint(nextPosition, staff.deskPoint)) {
          runtimeState.mode = "idleAtDesk";
          runtimeState.stateMs = staff.idleMs;
          runtimeState.hasConfirmedCurrentCycle = false;
        }
        continue;
      }

      runtimeState.stateMs = Math.max(0, runtimeState.stateMs - deltaMs);

      if (
        runtimeState.mode === "checkingQueue" &&
        !runtimeState.hasConfirmedCurrentCycle &&
        snapshot.activeWaitingZoneId === staff.waitZoneId &&
        snapshot.movementMode === "slow" &&
        snapshot.speed < 24
      ) {
        runtimeState.hasConfirmedCurrentCycle = true;
        this.runtime.receptionConfirmedMs = RECEPTION_CONFIRM_MS;
        this.runtime.message =
          "前台完成了接待确认。趁记录还热，穿过内部门。";
      }

      if (runtimeState.stateMs > 0) {
        continue;
      }

      if (runtimeState.mode === "idleAtDesk") {
        runtimeState.mode = "walkingToTerminal";
        continue;
      }

      if (runtimeState.mode === "checkingQueue") {
        runtimeState.mode = "returningToDesk";
      }
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

    this.runtime.message = "扫描机正在锁定你，立刻松开 Shift 慢行，或脱离它的判断范围。";

    return Object.fromEntries(
      Object.entries(droneStates).map(([id, state]) => [
        id,
        state === "Alert" ? "Warn" : state,
      ]),
    ) as Record<string, DroneState>;
  }

  private getDefaultMessage(): string {
    const room = this.getRoom();

    if (room.id === "room-1") {
      return this.runtime.visitorFlowUnlocked
        ? "登记完成，你已被系统识别为访客。从访客门通过。"
        : "先去登记面板完成访客登记，再从访客门通过。";
    }

    if (room.id === "room-1b") {
      return this.runtime.receptionConfirmedMs > 0
        ? "前台刚完成接待确认。保持稳定，从内部门通过。"
        : "登记只说明你来过。去候位区站定，等前台把你接进流程。";
    }

    if (
      room.id === "room-2" &&
      this.runtime.terminalMode === "maintenanceRequest" &&
      this.hasResidentWaitingAtService()
    ) {
      return "住户已在门侧确认服务。保持慢行，沿维修通道通过。";
    }

    if (room.id === "room-2" && this.runtime.terminalMode === "faultReport") {
      return "异常上报正在扰动服务门一带。它没直接放行，但会让正确的误读来得更快。";
    }

    if (
      room.id === "room-3" &&
      this.runtime.escortUnlocked &&
      this.runtime.escortDistractedMs <= 0
    ) {
      return "你仍被系统归在维修流程里。第一道门认你，但作业出口会拒绝带着护送的对象。";
    }

    if (
      room.id === "room-4" &&
      this.runtime.escortUnlocked &&
      !this.runtime.escortReleased &&
      this.runtime.terminalMode === "maintenanceRequest"
    ) {
      return "你仍被系统当成维修人员。先在广播屏处卸下本地工单，再去示意区切回访客。";
    }

    if (
      room.id === "room-4" &&
      this.runtime.escortReroutedMs > 0 &&
      this.runtime.terminalMode === "none"
    ) {
      return "护送机已被短暂改派。现在去示意区按住空格，把自己切回访客引导流程。";
    }

    if (this.runtime.terminalMode === "maintenanceRequest") {
      return "服务终端已登记维修请求。";
    }

    if (this.runtime.guideFieldPrimed) {
      return "引导面板已激活。现在站到感应区里按住空格停留两秒示意，然后在扫描机视野内慢行。";
    }

    const { guidedVisitor, maintenanceCandidate, intruder } =
      this.runtime.interpretationScores;
    if (maintenanceCandidate >= guidedVisitor && maintenanceCandidate >= intruder) {
      return "系统正在把你往维修人员那边解释，但还在观察你是否真的熟悉流程。";
    }
    if (guidedVisitor >= intruder) {
      return "系统更倾向把你当作被引导的访客。保持缓慢、稳定、像是知道自己该去哪里。";
    }
    return "你的动作还像未经授权的闯入。试着让路线、停留和物品摆放都更像一种合理流程。";
  }

  private getDroneStates(
    snapshot: PlayerIntentSnapshot,
  ): Record<string, DroneState> {
    const room = this.getRoom();
    const states: Record<string, DroneState> = {};

    for (const drone of room.drones) {
      const context: DroneContext = {
        interpretation: this.runtime.interpretation,
        scores: this.runtime.interpretationScores,
        movementMode: snapshot.movementMode,
        speed: snapshot.speed,
        playerVisible: snapshot.visibleDroneIds.includes(drone.id),
        isOnTrustedRoute: snapshot.isOnTrustedRoute,
        terminalMode: this.runtime.terminalMode,
        escortActive:
          this.runtime.escortUnlocked && !this.runtime.escortReleased,
        escortDistracted: this.runtime.escortDistractedMs > 0,
        escortRerouted: this.runtime.escortReroutedMs > 0,
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
