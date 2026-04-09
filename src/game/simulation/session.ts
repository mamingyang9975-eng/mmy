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
  StaffDefinition,
  StaffRuntime,
  TerminalMode,
  Vec2,
} from "./types";

const ALERT_RESET_MS = 5000;
const ALERT_WARNING_MS = 1000;
const ESCORT_DISTRACT_MS = 3200;
const ESCORT_REROUTE_MS = 4200;
const RECEPTION_CONFIRM_MS = 5000;
const PORTER_FLOW_MS = 2600;
const ARCHIVE_REVIEW_MS = 3200;
const OFFICE_CLEARANCE_MS = 4500;

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
          mode: staff.role === "porter" ? "walkingRoute" : "idleAtDesk",
          position: { ...staff.position },
          stateMs: staff.role === "porter" ? 0 : staff.idleMs,
          hasConfirmedCurrentCycle: false,
          routeIndex: 0,
        } satisfies StaffRuntime,
      ]),
    ),
    receptionConfirmedMs: 0,
    porterFlowMs: 0,
    archiveReviewMs: 0,
    officeClearanceMs: 0,
    subjectReleased: false,
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
    this.runtime.message = this.getDefaultMessage();
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
    this.runtime.porterFlowMs = Math.max(0, this.runtime.porterFlowMs - deltaMs);
    this.runtime.archiveReviewMs = Math.max(
      0,
      this.runtime.archiveReviewMs - deltaMs,
    );
    this.runtime.officeClearanceMs = Math.max(
      0,
      this.runtime.officeClearanceMs - deltaMs,
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
    this.applyPorterFlow();
    this.applyArchiveReview();
    this.applyOfficeClearance();
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
        "工单撤销后，你被重新写回访客流程，护送也松开了。";
    }

    const droneStates = this.getDroneStates(snapshot);

    if (Object.values(droneStates).includes("Alert")) {
      const warningStates = this.updateAlertWarning(snapshot, droneStates, deltaMs);
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
        "检修台让护送机偏离了路线。";
      return this.runtime.terminalMode;
    }

    if (this.runtime.terminalMode === "faultReport") {
      this.runtime.message =
        room.id === "room-2"
          ? "故障上报把注意力拉向了服务门。"
          : "终端挂上了故障上报。";
    } else if (this.runtime.terminalMode === "maintenanceRequest") {
      this.runtime.message =
        room.id === "room-3"
          ? "维修工单会替你开前门，也会引来护送。"
          : room.id === "room-4"
            ? "维修工单会替你开前门，也会把你锁在维修读法里。"
            : "服务终端挂上了维修工单。";
    } else {
      this.runtime.message = this.getDefaultMessage();
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
      this.runtime.message = "引导区已经可用。";
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
      this.runtime.message = "访客记录已经写入系统。";
      return;
    }

    if (consoleDef.action === "rerouteEscort") {
      this.runtime.escortReroutedMs = ESCORT_REROUTE_MS;
      this.runtime.terminalMode = "none";
      this.runtime.message = "广播改派了护送，工单也被撤走了。";
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
      officeClearanceActive: this.runtime.officeClearanceMs > 0,
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
          ? "护送接入后，作业出口开始卡你。"
          : "护送接入了，它会一路盯着你。";
    }
  }

  goToNextRoom(): boolean {
    if (this.roomIndex >= ROOMS.length - 1) {
      this.complete = true;
      this.paused = true;
      this.runtime.message =
        "观察室：你不是躲开了系统，而是一路牵着它的判断走出了整座设施。";
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
    this.runtime.message = this.getDefaultMessage();
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

  private triggerAlert(message?: string): void {
    if (this.runtime.alertCountdownMs !== null) {
      return;
    }
    this.runtime.alertWarningMs = 0;
    this.runtime.alertCountdownMs = ALERT_RESET_MS;
    this.runtime.message = message ?? "当前区域已转入高警戒。";
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

  private applyPorterFlow(): void {
    if (this.runtime.porterFlowMs <= 0) {
      return;
    }

    this.runtime.interpretationScores.maintenanceCandidate += 2.6;
    this.runtime.interpretationScores.intruder = Math.max(
      0,
      this.runtime.interpretationScores.intruder - 0.8,
    );
  }

  private applyArchiveReview(): void {
    if (this.runtime.archiveReviewMs <= 0) {
      return;
    }

    this.runtime.interpretationScores.guidedVisitor += 3.4;
    this.runtime.interpretationScores.intruder = Math.max(
      0,
      this.runtime.interpretationScores.intruder - 1.4,
    );
  }

  private applyOfficeClearance(): void {
    if (this.runtime.officeClearanceMs <= 0) {
      return;
    }

    this.runtime.interpretationScores.guidedVisitor += 2.4;
    this.runtime.interpretationScores.intruder = Math.max(
      0,
      this.runtime.interpretationScores.intruder - 1.2,
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
      this.runtime.message = "住户已经到门边，服务门会认这次响应。";
      return;
    }

    if (waiting && this.runtime.terminalMode === "faultReport") {
      this.runtime.message = "故障上报先把住户叫到了门边。";
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
          ? "住户正在响应异常，但你还没真正拿到维修读法。"
          : "住户正在朝服务门移动。";
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

      if (staff.role === "receptionist") {
        this.updateReceptionist(staff, runtimeState, snapshot, deltaMs);
        continue;
      }

      if (staff.role === "porter") {
        this.updatePorter(staff, runtimeState, snapshot, deltaMs);
        continue;
      }

      if (staff.role === "archivist") {
        this.updateArchivist(staff, runtimeState, snapshot, deltaMs);
        continue;
      }

      if (staff.role === "clerk") {
        this.updateClerk(staff, runtimeState, snapshot, deltaMs);
      }
    }
  }

  private updateReceptionist(
    staff: StaffDefinition,
    runtimeState: StaffRuntime,
    snapshot: PlayerIntentSnapshot,
    deltaMs: number,
  ): void {
    if (!staff || staff.role !== "receptionist") {
      return;
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
      return;
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
      return;
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
      this.runtime.message = "前台把你写进了这轮接待。";
    }

    if (runtimeState.stateMs > 0) {
      return;
    }

    if (runtimeState.mode === "idleAtDesk") {
      runtimeState.mode = "walkingToTerminal";
      return;
    }

    if (runtimeState.mode === "checkingQueue") {
      runtimeState.mode = "returningToDesk";
    }
  }

  private updatePorter(
    staff: StaffDefinition,
    runtimeState: StaffRuntime,
    snapshot: PlayerIntentSnapshot,
    deltaMs: number,
  ): void {
    if (!staff || staff.role !== "porter" || !staff.routePoints?.length) {
      return;
    }

    if (runtimeState.mode === "loading") {
      runtimeState.stateMs = Math.max(0, runtimeState.stateMs - deltaMs);
      this.tryRefreshPorterFlow(staff, runtimeState, snapshot);
      if (runtimeState.stateMs === 0) {
        runtimeState.mode = "walkingRoute";
      }
      return;
    }

    const nextIndex =
      (runtimeState.routeIndex + 1) % staff.routePoints.length;
    const target = staff.routePoints[nextIndex];
    const nextPosition = moveTowards(
      runtimeState.position,
      target,
      staff.speed,
      deltaMs,
    );
    runtimeState.position = nextPosition;
    this.tryRefreshPorterFlow(staff, runtimeState, snapshot);

    if (samePoint(nextPosition, target)) {
      runtimeState.routeIndex = nextIndex;
      runtimeState.mode = "loading";
      runtimeState.stateMs = staff.pauseMs ?? 1200;
    }
  }

  private tryRefreshPorterFlow(
    staff: StaffDefinition,
    runtimeState: StaffRuntime,
    snapshot: PlayerIntentSnapshot,
  ): void {
    if (
      !staff ||
      staff.role !== "porter" ||
      !snapshot.playerPosition ||
      snapshot.movementMode !== "slow" ||
      snapshot.speed > 70 ||
      snapshot.carryingItemType !== "battery"
    ) {
      return;
    }

    const radius = staff.influenceRadius ?? 26;
    if (distanceBetween(snapshot.playerPosition, runtimeState.position) > radius) {
      return;
    }

    this.runtime.porterFlowMs = PORTER_FLOW_MS;
    if (
      this.getRoom().id === "room-2" &&
      this.runtime.terminalMode === "none"
    ) {
      this.runtime.message = "后勤节奏正在替你说话。";
    }
  }

  private updateArchivist(
    staff: StaffDefinition,
    runtimeState: StaffRuntime,
    snapshot: PlayerIntentSnapshot,
    deltaMs: number,
  ): void {
    if (!staff || staff.role !== "archivist" || !staff.routePoints?.length) {
      return;
    }

    if (runtimeState.mode === "loading") {
      runtimeState.stateMs = Math.max(0, runtimeState.stateMs - deltaMs);
      this.tryRefreshArchiveReview(staff, runtimeState, snapshot);
      if (runtimeState.stateMs === 0) {
        runtimeState.mode = "walkingRoute";
      }
      return;
    }

    const nextIndex =
      (runtimeState.routeIndex + 1) % staff.routePoints.length;
    const target = staff.routePoints[nextIndex];
    const nextPosition = moveTowards(
      runtimeState.position,
      target,
      staff.speed,
      deltaMs,
    );
    runtimeState.position = nextPosition;
    this.tryRefreshArchiveReview(staff, runtimeState, snapshot);

    if (samePoint(nextPosition, target)) {
      runtimeState.routeIndex = nextIndex;
      runtimeState.mode = "loading";
      runtimeState.stateMs = staff.pauseMs ?? 1200;
    }
  }

  private tryRefreshArchiveReview(
    staff: StaffDefinition,
    runtimeState: StaffRuntime,
    snapshot: PlayerIntentSnapshot,
  ): void {
    if (
      !staff ||
      staff.role !== "archivist" ||
      !snapshot.playerPosition ||
      !snapshot.isInSignalZone ||
      snapshot.movementMode !== "slow" ||
      snapshot.speed > 26
    ) {
      return;
    }

    const radius = staff.influenceRadius ?? 32;
    if (distanceBetween(snapshot.playerPosition, runtimeState.position) > radius) {
      return;
    }

    this.runtime.archiveReviewMs = ARCHIVE_REVIEW_MS;
    if (
      this.getRoom().id === "room-4" &&
      this.runtime.terminalMode === "none"
    ) {
      this.runtime.message = "档案员正在把你写回访客队列。";
    }
  }

  private updateClerk(
    staff: StaffDefinition,
    runtimeState: StaffRuntime,
    snapshot: PlayerIntentSnapshot,
    deltaMs: number,
  ): void {
    if (!staff || staff.role !== "clerk" || !staff.routePoints?.length) {
      return;
    }

    if (runtimeState.mode === "loading") {
      runtimeState.stateMs = Math.max(0, runtimeState.stateMs - deltaMs);
      this.tryGrantOfficeClearance(staff, runtimeState, snapshot);
      if (runtimeState.stateMs === 0) {
        runtimeState.mode = "walkingRoute";
      }
      return;
    }

    const nextIndex =
      (runtimeState.routeIndex + 1) % staff.routePoints.length;
    const target = staff.routePoints[nextIndex];
    const nextPosition = moveTowards(
      runtimeState.position,
      target,
      staff.speed,
      deltaMs,
    );
    runtimeState.position = nextPosition;
    this.tryGrantOfficeClearance(staff, runtimeState, snapshot);

    if (samePoint(nextPosition, target)) {
      runtimeState.routeIndex = nextIndex;
      runtimeState.mode = "loading";
      runtimeState.stateMs = staff.pauseMs ?? 1400;
    }
  }

  private tryGrantOfficeClearance(
    staff: StaffDefinition,
    runtimeState: StaffRuntime,
    snapshot: PlayerIntentSnapshot,
  ): void {
    if (
      !staff ||
      staff.role !== "clerk" ||
      snapshot.activeWaitingZoneId !== staff.waitZoneId ||
      snapshot.movementMode !== "slow" ||
      snapshot.speed > 18
    ) {
      return;
    }

    const radius = staff.influenceRadius ?? 32;
    if (
      !snapshot.playerPosition ||
      distanceBetween(snapshot.playerPosition, runtimeState.position) > radius
    ) {
      return;
    }

    this.runtime.officeClearanceMs = OFFICE_CLEARANCE_MS;
    if (this.getRoom().id === "room-5") {
      this.runtime.message = "夜班文员把你记进了值班交接。";
    }
  }

  private hasResidentWaitingAtService(): boolean {
    return Object.values(this.runtime.residentStates).some(
      (resident) => resident.mode === "waitingAtService",
    );
  }

  private updateAlertWarning(
    snapshot: PlayerIntentSnapshot,
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
      this.triggerAlert(this.getLockdownMessage(snapshot));
      return null;
    }

    this.runtime.message = this.getAlertWarningMessage(snapshot);

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
        ? "系统里已经有你的访客记录。"
        : "这一区先比对登记。";
    }

    if (room.id === "room-1b") {
      return this.runtime.receptionConfirmedMs > 0
        ? "接待确认还在生效。"
        : "前台确认之前，内部门不认你。";
    }

    if (room.id === "room-2" && this.runtime.porterFlowMs > 0) {
      return this.runtime.terminalMode === "maintenanceRequest"
        ? "后勤节奏和工单都在替你背书。"
        : "后勤节奏正在替你背书。";
    }

    if (
      room.id === "room-2" &&
      this.runtime.terminalMode === "maintenanceRequest" &&
      this.hasResidentWaitingAtService()
    ) {
      return "住户确认后，服务门会认这张工单。";
    }

    if (room.id === "room-2" && this.runtime.terminalMode === "faultReport") {
      return "故障上报把注意力拉向了服务门。";
    }

    if (
      room.id === "room-3" &&
      this.runtime.escortUnlocked &&
      this.runtime.escortDistractedMs <= 0
    ) {
      return "维修读法还在，但护送会卡住作业出口。";
    }

    if (
      room.id === "room-4" &&
      this.runtime.archiveReviewMs > 0 &&
      this.runtime.terminalMode === "none"
    ) {
      return "档案员正在复核你的记录。保持慢行并停在示意区，让系统把你重新写成访客。";
    }

    if (room.id === "room-5") {
      return this.runtime.officeClearanceMs > 0
        ? "值班许可已经写入。保持慢行，从值班出口离开这一层。"
        : "去交接区站定，等夜班文员把你记进值班流程。";
    }

    if (
      room.id === "room-4" &&
      this.runtime.escortUnlocked &&
      !this.runtime.escortReleased &&
      this.runtime.terminalMode === "maintenanceRequest"
    ) {
      return "维修工单还在，出口不会把你认成访客。";
    }

    if (
      room.id === "room-4" &&
      this.runtime.escortReroutedMs > 0 &&
      this.runtime.terminalMode === "none"
    ) {
      return "护送被暂时支开了，系统正在重新读你。";
    }

    if (this.runtime.terminalMode === "maintenanceRequest") {
      return "维修工单正在替你说话。";
    }

    if (this.runtime.guideFieldPrimed) {
      return "引导区会帮你被读成访客。";
    }

    const { guidedVisitor, maintenanceCandidate, intruder } =
      this.runtime.interpretationScores;
    if (maintenanceCandidate >= guidedVisitor && maintenanceCandidate >= intruder) {
      return "系统更偏向维修读法。";
    }
    if (guidedVisitor >= intruder) {
      return "系统更偏向访客读法。";
    }
    return "系统还把你往闯入那边读。";
  }

  private getAlertWarningMessage(snapshot: PlayerIntentSnapshot): string {
    const reasons = this.getSuspicionReasons(snapshot);
    if (reasons.length === 0) {
      return "扫描机起疑了。你的举动不像正常流程。";
    }
    if (reasons.length === 1) {
      return `扫描机起疑了：${reasons[0]}暴露了你。`;
    }
    const lead = reasons.slice(0, -1).join("、");
    const tail = reasons[reasons.length - 1];
    return `扫描机起疑了：${lead}和${tail}叠在了一起。`;
  }

  private getLockdownMessage(snapshot: PlayerIntentSnapshot): string {
    const reasons = this.getSuspicionReasons(snapshot);
    if (reasons.length === 0) {
      return "区域已转入高警戒。";
    }
    return `区域已锁定：${reasons[0]}让系统升级了警戒。`;
  }

  private getSuspicionReasons(snapshot: PlayerIntentSnapshot): string[] {
    const reasons: string[] = [];

    if (snapshot.speed >= 90) {
      reasons.push("快跑");
    } else if (snapshot.movementMode === "normal") {
      reasons.push("步态太急");
    }

    if (!snapshot.isOnTrustedRoute && snapshot.movementMode === "normal") {
      reasons.push("偏离路线");
    }

    if (
      snapshot.isInSignalZone &&
      snapshot.isIndicating &&
      !snapshot.signalEnabled
    ) {
      reasons.push("在错误的位置示意");
    }

    if (snapshot.terminalMode === "faultReport") {
      reasons.push("故障上报把注意力也拉了过来");
    }

    return reasons;
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

function distanceBetween(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
