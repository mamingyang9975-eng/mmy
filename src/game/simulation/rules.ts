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
const SCORE_DECAY_PER_SECOND = 1.2;
const SCORE_CLAMP_MAX = 24;
const INTERPRETATION_LOCK_THRESHOLD = 5;
const INTERPRETATION_SWITCH_MARGIN = 2.5;
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
  previousTag?: InterpretationTag,
): InterpretationTag {
  const ranked = (
    Object.entries(scores) as Array<[InterpretationTag, number]>
  ).sort((left, right) => right[1] - left[1]);
  const [bestTag, bestScore] = ranked[0];
  const [, secondScore = 0] = ranked[1] ?? [];

  if (previousTag) {
    const previousScore = scores[previousTag];
    if (
      previousScore >= INTERPRETATION_LOCK_THRESHOLD &&
      bestTag !== previousTag &&
      bestScore < previousScore + INTERPRETATION_SWITCH_MARGIN
    ) {
      return previousTag;
    }
  }

  if (bestScore === secondScore && previousTag) {
    return previousTag;
  }

  return bestTag;
}

export function advanceInterpretation(
  snapshot: PlayerIntentSnapshot,
  previousScores: InterpretationScores,
  previousTag: InterpretationTag,
  previous: GuideMemory,
  deltaMs: number,
): InterpretationResult {
  let remainingMs = Math.max(0, previous.remainingMs - deltaMs);
  const decay = (deltaMs / 1000) * SCORE_DECAY_PER_SECOND;
  const scores: InterpretationScores = {
    intruder: clampScore(previousScores.intruder - decay),
    guidedVisitor: clampScore(previousScores.guidedVisitor - decay),
    maintenanceCandidate: clampScore(previousScores.maintenanceCandidate - decay),
  };
  const justCompletedSignal =
    snapshot.isInSignalZone &&
    snapshot.isIndicating &&
    snapshot.signalEnabled;

  if (justCompletedSignal) {
    remainingMs = GUIDE_MEMORY_MS;
  }

  if (snapshot.movementMode === "slow") {
    scores.guidedVisitor = clampScore(scores.guidedVisitor + 0.7);
  } else {
    scores.intruder = clampScore(scores.intruder + 0.9);
  }

  if (snapshot.speed >= FAST_SPEED_THRESHOLD) {
    scores.intruder = clampScore(scores.intruder + 3.2);
  } else if (snapshot.speed > 0) {
    scores.guidedVisitor = clampScore(scores.guidedVisitor + 0.45);
  }

  if (!snapshot.isOnTrustedRoute && snapshot.movementMode === "normal") {
    scores.intruder = clampScore(scores.intruder + 1.6);
  }

  if (
    snapshot.isInSignalZone &&
    snapshot.isIndicating &&
    !snapshot.signalEnabled
  ) {
    scores.intruder = clampScore(scores.intruder + 1.6);
  }

  if (snapshot.isInGuideRange) {
    scores.guidedVisitor = clampScore(scores.guidedVisitor + 1.1);
  }

  if (snapshot.isInSignalZone && snapshot.signalEnabled) {
    scores.guidedVisitor = clampScore(scores.guidedVisitor + 0.6);
  }

  if (justCompletedSignal) {
    scores.guidedVisitor = clampScore(scores.guidedVisitor + 4.2);
  }

  if (remainingMs > 0) {
    scores.guidedVisitor = clampScore(scores.guidedVisitor + 1.8);
  }

  if (snapshot.carryingItemType === "battery") {
    scores.maintenanceCandidate = clampScore(scores.maintenanceCandidate + 1.2);
    if (snapshot.terminalMode === "none") {
      scores.intruder = clampScore(scores.intruder + 0.5);
    }
  }

  if (snapshot.terminalMode === "maintenanceRequest") {
    scores.maintenanceCandidate = clampScore(scores.maintenanceCandidate + 3.8);
    scores.intruder = clampScore(scores.intruder - 0.9);
  }

  if (snapshot.terminalMode === "faultReport") {
    scores.intruder = clampScore(scores.intruder + 1.2);
  }

  const tag = resolveInterpretationTag(scores, previousTag);

  return {
    tag,
    scores,
    guideMemory: { remainingMs },
  };
}

function clampScore(value: number): number {
  return Math.min(SCORE_CLAMP_MAX, Math.max(0, value));
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

  if (
    rule.requiresReceptionConfirmed &&
    !context.receptionConfirmedActive
  ) {
    return false;
  }

  if (
    rule.requiresOfficeClearance &&
    !context.officeClearanceActive
  ) {
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
