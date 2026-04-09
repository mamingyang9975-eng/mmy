export type InterpretationTag =
  | "intruder"
  | "guidedVisitor"
  | "maintenanceCandidate";

export type MovementMode = "normal" | "slow";

export type TerminalMode = "none" | "maintenanceRequest" | "faultReport";

export type DroneState = "Observe" | "Guide" | "Warn" | "Alert" | "Escort";

export interface Vec2 {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PathPoint extends Vec2 {}

export interface GuidePath {
  id: string;
  color: "blue" | "amber";
  points: PathPoint[];
  tolerance: number;
  activeWhen: "guided" | "maintenance";
}

export interface SignalZone {
  id: string;
  rect: Rect;
}

export interface ResidentDefinition {
  id: string;
  label: string;
  position: Vec2;
  servicePoint: Vec2;
  speed: number;
}

export interface ConsoleDefinition {
  id: string;
  rect: Rect;
  label: string;
  prompt: string;
  action: "primeGuidance";
}

export interface ItemSpawn {
  id: string;
  itemType: "battery";
  label: string;
  position: Vec2;
}

export interface ItemSlot {
  id: string;
  rect: Rect;
  label: string;
}

export interface TerminalRecipe {
  slotId: string;
  resultingMode: TerminalMode;
  acceptsItemType: ItemSpawn["itemType"];
}

export interface DoorRule {
  id: string;
  accepts: InterpretationTag[];
  requiresTerminalMode?: TerminalMode[];
  deniesEscort?: boolean;
  requiresSlowMovement?: boolean;
  requiresSlowInDroneRange?: boolean;
  requiresFilledSlotsExcluding?: string[];
  requiresResidentService?: boolean;
}

export interface DoorDefinition {
  id: string;
  rect: Rect;
  label: string;
  rule: DoorRule;
  exitToNextRoom?: boolean;
}

export interface DroneRule {
  id: string;
  visionRadius: number;
  kind: "scanner" | "escort";
  escortSpawn?: Vec2;
  requiresSlowGuide?: boolean;
}

export interface DronePatrol {
  radius: number;
  speed: number;
  lingerMs?: number;
}

export interface DroneDefinition {
  id: string;
  label: string;
  position: Vec2;
  rule: DroneRule;
  patrol?: DronePatrol;
}

export interface TerminalDefinition {
  id: string;
  label: string;
  body: Rect;
  slots: ItemSlot[];
  recipes: TerminalRecipe[];
}

export interface TriggerDefinition {
  id: string;
  rect: Rect;
  action: "spawnEscort";
}

export interface RoomDefinition {
  id: string;
  name: string;
  shortName: string;
  hint: string;
  signage: string[];
  wallRects: Rect[];
  playerSpawn: Vec2;
  drones: DroneDefinition[];
  residents: ResidentDefinition[];
  doors: DoorDefinition[];
  terminal?: TerminalDefinition;
  consoles?: ConsoleDefinition[];
  signalRequiresActivation?: boolean;
  items: ItemSpawn[];
  signalZones: SignalZone[];
  guidePaths: GuidePath[];
  triggers?: TriggerDefinition[];
}

export interface PlayerIntentSnapshot {
  movementMode: MovementMode;
  speed: number;
  isIndicating: boolean;
  isInSignalZone: boolean;
  isInGuideRange: boolean;
  isOnTrustedRoute: boolean;
  signalEnabled: boolean;
  carryingItemType: ItemSpawn["itemType"] | null;
  terminalMode: TerminalMode;
  visibleDroneIds: string[];
}

export interface DoorContext {
  interpretation: InterpretationTag;
  terminalMode: TerminalMode;
  escortActive: boolean;
  residentServiceActive?: boolean;
  movementMode?: MovementMode;
  isInDroneRange?: boolean;
  filledSlotIds?: string[];
  requiredSlotIds?: string[];
}

export interface DroneContext {
  interpretation: InterpretationTag;
  movementMode: MovementMode;
  speed: number;
  playerVisible: boolean;
  isOnTrustedRoute: boolean;
  terminalMode: TerminalMode;
  escortActive: boolean;
  escortDistracted: boolean;
}

export interface GuideMemory {
  remainingMs: number;
}

export type ResidentMode = "idle" | "answeringService" | "waitingAtService";

export interface ResidentRuntime {
  mode: ResidentMode;
  position: Vec2;
}

export interface InterpretationResult {
  tag: InterpretationTag;
  guideMemory: GuideMemory;
}

export interface RoomRuntime {
  terminalMode: TerminalMode;
  interpretation: InterpretationTag;
  guideMemory: GuideMemory;
  guideFieldPrimed: boolean;
  visitorFlowUnlocked: boolean;
  placedItems: Record<string, string | null>;
  unlockedDoorIds: string[];
  escortUnlocked: boolean;
  escortReleased: boolean;
  escortDistractedMs: number;
  alertWarningMs: number;
  alertCountdownMs: number | null;
  triggeredIds: string[];
  residentStates: Record<string, ResidentRuntime>;
  message: string | null;
}

export interface SessionSnapshot {
  roomIndex: number;
  room: RoomDefinition;
  runtime: RoomRuntime;
  isPaused: boolean;
  isComplete: boolean;
}
