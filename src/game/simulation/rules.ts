import type {
  DoorContext,
  DoorRule,
  DroneContext,
  DroneRule,
  DroneState,
  GuideMemory,
  InterpretationResult,
  InterpretationScores,
  InterpretationTag,
  ItemSpawn,
  PlayerIntentSnapshot,
  TerminalMode,
  TerminalRecipe,
} from "./types";

const GUIDE_MEMORY_MS = 3600;
const FAST_SPEED_THRESHOLD = 90;
export const SLOW_SPEED_LIMIT = 56;
export const NORMAL_SPEED_LIMIT = 84;

export function createGuideMemory(): GuideMemory {
  return { remainingMs: 0 };
}

export function createInterpretationScores(): InterpretationScores {
  return {
    intruder: 0,
    guidedVisitor: 0,
    maintenanceCandidate: 0,
  };
}

export function resolveInterpretationTag(
  scores: InterpretationScores,
): InterpretationTag {
  if (
    scores.maintenanceCandidate > scores.guidedVisitor &&
    scores.maintenanceCandidate >= scores.intruder
  ) {
    return "maintenanceCandidate";
  }

  if (scores.guidedVisitor > scores.intruder) {
    return "guidedVisitor";
  }

  return "intruder";
}

export function advanceInterpretation(
  snapshot: PlayerIntentSnapshot,
  previous: GuideMemory,
  deltaMs: number,
): InterpretationResult {
  let remainingMs = Math.max(0, previous.remainingMs - deltaMs);
  const scores = createInterpretationScores();
  const justCompletedSignal =
    snapshot.isInSignalZone &&
    snapshot.isIndicating &&
    snapshot.signalEnabled;

  if (justCompletedSignal) {
    remainingMs = GUIDE_MEMORY_MS;
  }

  if (snapshot.movementMode === "slow") {
    scores.guidedVisitor += 1;
  } else {
    scores.intruder += 1;
  }

  if (snapshot.speed >= FAST_SPEED_THRESHOLD) {
    scores.intruder += 4;
  } else if (snapshot.speed > 0) {
    scores.guidedVisitor += 1;
  }

  if (!snapshot.isOnTrustedRoute && snapshot.movementMode === "normal") {
    scores.intruder += 2;
  }

  if (
    snapshot.isInSignalZone &&
    snapshot.isIndicating &&
    !snapshot.signalEnabled
  ) {
    scores.intruder += 2;
  }

  if (snapshot.isInGuideRange) {
    scores.guidedVisitor += 2;
  }

  if (snapshot.isInSignalZone && snapshot.signalEnabled) {
    scores.guidedVisitor += 1;
  }

  if (justCompletedSignal) {
    scores.guidedVisitor += 5;
  }

  if (remainingMs > 0) {
    scores.guidedVisitor += 4;
  }

  if (snapshot.carryingItemType === "battery") {
    scores.maintenanceCandidate += 2;
    if (snapshot.terminalMode === "none") {
      scores.intruder += 1;
    }
  }

  if (snapshot.terminalMode === "maintenanceRequest") {
    scores.maintenanceCandidate += 14;
    scores.intruder = Math.max(0, scores.intruder - 2);
  }

  if (snapshot.terminalMode === "faultReport") {
    scores.intruder += 5;
  }

  const tag = resolveInterpretationTag(scores);

  return {
    tag,
    scores,
    guideMemory: { remainingMs },
  };
}

export function evaluateDroneState(
  rule: DroneRule,
  context: DroneContext,
): DroneState {
  const maintenanceConfidence = context.scores.maintenanceCandidate;
  const visitorConfidence = context.scores.guidedVisitor;
  const intruderPressure = context.scores.intruder;
  const requiresSlowGuide =
    rule.kind === "scanner" &&
    rule.requiresSlowGuide &&
    maintenanceConfidence >= visitorConfidence;

  if (!context.playerVisible) {
    return "Observe";
  }

  if (context.terminalMode === "faultReport") {
    return intruderPressure >= 5 ? "Alert" : "Warn";
  }

  if (rule.kind === "escort") {
    if (
      !context.escortActive ||
      context.escortDistracted ||
      context.escortRerouted ||
      visitorConfidence >= maintenanceConfidence
    ) {
      return "Observe";
    }
    return "Escort";
  }

  if (
    maintenanceConfidence >= 5 &&
    (!requiresSlowGuide || context.movementMode === "slow")
  ) {
    return "Guide";
  }

  if (visitorConfidence >= 5 && intruderPressure <= visitorConfidence + 1) {
    return "Guide";
  }

  if (
    intruderPressure >= 6 ||
    context.speed >= FAST_SPEED_THRESHOLD ||
    (context.movementMode === "normal" && !context.isOnTrustedRoute)
  ) {
    return "Alert";
  }

  return "Observe";
}

export function canDoorOpen(rule: DoorRule, context: DoorContext): boolean {
  if (!rule.accepts.includes(context.interpretation)) {
    return false;
  }

  if (
    rule.minScores &&
    Object.entries(rule.minScores).some(
      ([key, value]) =>
        value !== undefined &&
        context.scores[key as keyof InterpretationScores] < value,
    )
  ) {
    return false;
  }

  if (
    rule.maxScores &&
    Object.entries(rule.maxScores).some(
      ([key, value]) =>
        value !== undefined &&
        context.scores[key as keyof InterpretationScores] > value,
    )
  ) {
    return false;
  }

  if (
    rule.requiresTerminalMode &&
    !rule.requiresTerminalMode.includes(context.terminalMode)
  ) {
    return false;
  }

  if (rule.deniesEscort && context.escortActive) {
    return false;
  }

  if (rule.requiresResidentService && !context.residentServiceActive) {
    return false;
  }

  if (rule.requiresSlowMovement && context.movementMode !== "slow") {
    return false;
  }

  if (
    rule.requiresSlowInDroneRange &&
    (context.movementMode !== "slow" || !context.isInDroneRange)
  ) {
    return false;
  }

  if (rule.requiresFilledSlotsExcluding) {
    const filledSlots = new Set(context.filledSlotIds ?? []);
    const requiredSlots = (context.requiredSlotIds ?? []).filter(
      (slotId) => !rule.requiresFilledSlotsExcluding?.includes(slotId),
    );

    if (requiredSlots.some((slotId) => !filledSlots.has(slotId))) {
      return false;
    }
  }

  return true;
}

export function resolveTerminalMode(
  recipes: TerminalRecipe[],
  slotId: string | null,
  itemType: ItemSpawn["itemType"] | null,
): TerminalMode {
  if (!slotId || !itemType) {
    return "none";
  }

  const recipe = recipes.find(
    (entry) => entry.slotId === slotId && entry.acceptsItemType === itemType,
  );

  return recipe?.resultingMode ?? "none";
}

export function getSpeedLimit(mode: PlayerIntentSnapshot["movementMode"]): number {
  return mode === "slow" ? SLOW_SPEED_LIMIT : NORMAL_SPEED_LIMIT;
}
