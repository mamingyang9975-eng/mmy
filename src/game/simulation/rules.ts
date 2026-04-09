import type {
  DoorContext,
  DoorRule,
  DroneContext,
  DroneRule,
  DroneState,
  GuideMemory,
  InterpretationResult,
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

export function advanceInterpretation(
  snapshot: PlayerIntentSnapshot,
  previous: GuideMemory,
  deltaMs: number,
): InterpretationResult {
  if (snapshot.terminalMode === "maintenanceRequest") {
    return {
      tag: "maintenanceCandidate",
      guideMemory: {
        remainingMs: Math.max(0, previous.remainingMs - deltaMs),
      },
    };
  }

  let remainingMs = Math.max(0, previous.remainingMs - deltaMs);

  if (
    snapshot.isInSignalZone &&
    snapshot.isIndicating &&
    snapshot.signalEnabled
  ) {
    remainingMs = GUIDE_MEMORY_MS;
  }

  if (remainingMs > 0) {
    return {
      tag: "guidedVisitor",
      guideMemory: { remainingMs },
    };
  }

  if (
    snapshot.isInSignalZone &&
    snapshot.isIndicating &&
    snapshot.signalEnabled
  ) {
    return {
      tag: "guidedVisitor",
      guideMemory: { remainingMs },
    };
  }

  return {
    tag: "intruder",
    guideMemory: { remainingMs },
  };
}

export function evaluateDroneState(
  rule: DroneRule,
  context: DroneContext,
): DroneState {
  const requiresSlowGuide =
    rule.kind === "scanner" &&
    rule.requiresSlowGuide &&
    context.interpretation === "maintenanceCandidate";

  if (!context.playerVisible) {
    return "Observe";
  }

  if (context.terminalMode === "faultReport") {
    return "Alert";
  }

  if (rule.kind === "escort") {
    if (
      !context.escortActive ||
      context.escortDistracted ||
      context.interpretation === "guidedVisitor"
    ) {
      return "Observe";
    }
    return "Escort";
  }

  if (
    context.interpretation === "maintenanceCandidate" &&
    (!requiresSlowGuide || context.movementMode === "slow")
  ) {
    return "Guide";
  }

  if (context.interpretation === "guidedVisitor") {
    return "Guide";
  }

  if (
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
