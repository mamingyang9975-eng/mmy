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
    snapshot.signalEnabled &&
    snapshot.movementMode === "slow"
  ) {
    remainingMs = GUIDE_MEMORY_MS;
  }

  if (
    remainingMs > 0 &&
    snapshot.isInGuideRange &&
    snapshot.movementMode === "slow"
  ) {
    return {
      tag: "guidedVisitor",
      guideMemory: { remainingMs },
    };
  }

  if (
    snapshot.isInSignalZone &&
    snapshot.isIndicating &&
    snapshot.signalEnabled &&
    snapshot.movementMode === "slow"
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
  if (!context.playerVisible) {
    return "Observe";
  }

  if (context.terminalMode === "faultReport") {
    return "Alert";
  }

  if (rule.kind === "escort" && context.escortActive) {
    if (context.escortDistracted) {
      return "Observe";
    }
    if (context.terminalMode === "maintenanceRequest") {
      return "Escort";
    }
    if (context.interpretation === "guidedVisitor") {
      return "Observe";
    }
    return "Escort";
  }

  if (context.interpretation === "maintenanceCandidate") {
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

  if (
    rule.requiresSlowInDroneRange &&
    (context.movementMode !== "slow" || !context.isInDroneRange)
  ) {
    return false;
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
  return mode === "slow" ? 64 : 124;
}
