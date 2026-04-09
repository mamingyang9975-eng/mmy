export type InterpretationTag =
  | "intruder"
  | "guidedVisitor"
  | "maintenanceCandidate";

export interface InterpretationScores {
  intruder: number;
  guidedVisitor: number;
  maintenanceCandidate: number;
}

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

export interface RoomDimensions {
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

export interface WaitingZone {
  id: string;
  rect: Rect;
  label: string;
}

export interface ResidentDefinition {
  id: string;
  label: string;
  position: Vec2;
  servicePoint: Vec2;
  speed: number;
}

export type StaffRole = "receptionist" | "porter" | "archivist" | "clerk";

export type StaffMode =
  | "idleAtDesk"
  | "walkingToTerminal"
  | "checkingQueue"
  | "returningToDesk"
  | "walkingRoute"
  | "loading";

export interface StaffDefinition {
  id: string;
  label: string;
  role: StaffRole;
  position: Vec2;
  deskPoint: Vec2;
  terminalPoint: Vec2;
  speed: number;
  idleMs: number;
  checkMs: number;
  waitZoneId: string;
  routePoints?: Vec2[];
  pauseMs?: number;
  influenceRadius?: number;
}

export interface ConsoleDefinition {
  id: string;
  rect: Rect;
  label: string;
  prompt: string;
  action:
    | "primeGuidance"
    | "registerVisitor"
    | "rerouteEscort"
    | "releaseSubject";
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
  minScores?: Partial<InterpretationScores>;
  maxScores?: Partial<InterpretationScores>;
  requiresTerminalMode?: TerminalMode[];
  deniesEscort?: boolean;
  requiresSlowMovement?: boolean;
  requiresSlowInDroneRange?: boolean;
  requiresFilledSlotsExcluding?: string[];
  requiresResidentService?: boolean;
  requiresReceptionConfirmed?: boolean;
  requiresOfficeClearance?: boolean;
}

export interface DoorDefinition {
  id: string;
  rect: Rect;
  label: string;
  rule: DoorRule;
  alternateRules?: DoorRule[];
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
  dimensions?: RoomDimensions;
  wallRects: Rect[];
  playerSpawn: Vec2;
  drones: DroneDefinition[];
  residents: ResidentDefinition[];
  staff?: StaffDefinition[];
  doors: DoorDefinition[];
  terminal?: TerminalDefinition;
  consoles?: ConsoleDefinition[];
  signalRequiresActivation?: boolean;
  items: ItemSpawn[];
  signalZones: SignalZone[];
  waitingZones?: WaitingZone[];
  guidePaths: GuidePath[];
  triggers?: TriggerDefinition[];
}

export interface PlayerIntentSnapshot {
  playerPosition?: Vec2;
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
  activeWaitingZoneId?: string | null;
}

export interface DoorContext {
  interpretation: InterpretationTag;
  scores: InterpretationScores;
  terminalMode: TerminalMode;
  escortActive: boolean;
  residentServiceActive?: boolean;
  movementMode?: MovementMode;
  isInDroneRange?: boolean;
  filledSlotIds?: string[];
  requiredSlotIds?: string[];
  receptionConfirmedActive?: boolean;
  officeClearanceActive?: boolean;
}

export interface DroneContext {
  interpretation: InterpretationTag;
  scores: InterpretationScores;
  movementMode: MovementMode;
  speed: number;
  playerVisible: boolean;
  isOnTrustedRoute: boolean;
  terminalMode: TerminalMode;
  escortActive: boolean;
  escortDistracted: boolean;
  escortRerouted: boolean;
}

export interface GuideMemory {
  remainingMs: number;
}

export type ResidentMode = "idle" | "answeringService" | "waitingAtService";

export interface ResidentRuntime {
  mode: ResidentMode;
  position: Vec2;
}

export interface StaffRuntime {
  mode: StaffMode;
  position: Vec2;
  stateMs: number;
  hasConfirmedCurrentCycle: boolean;
  routeIndex: number;
}

export interface InterpretationResult {
  tag: InterpretationTag;
  scores: InterpretationScores;
  guideMemory: GuideMemory;
}

export interface PhoneThreadSummary {
  sender: string;
  messages: string[];
  footer: string;
}

export interface CompletionRecord {
  label: string;
  value: string;
  detail: string;
}

export interface CompletionSummary {
  title: string;
  paragraphs: string[];
  phone: PhoneThreadSummary;
  records: CompletionRecord[];
}

export interface RoomRuntime {
  terminalMode: TerminalMode;
  interpretation: InterpretationTag;
  interpretationScores: InterpretationScores;
  guideMemory: GuideMemory;
  guideFieldPrimed: boolean;
  visitorFlowUnlocked: boolean;
  placedItems: Record<string, string | null>;
  unlockedDoorIds: string[];
  escortUnlocked: boolean;
  escortReleased: boolean;
  escortDistractedMs: number;
  escortReroutedMs: number;
  alertWarningMs: number;
  alertCountdownMs: number | null;
  triggeredIds: string[];
  residentStates: Record<string, ResidentRuntime>;
  staffStates: Record<string, StaffRuntime>;
  receptionConfirmedMs: number;
  porterFlowMs: number;
  archiveReviewMs: number;
  officeClearanceMs: number;
  subjectReleased: boolean;
  message: string | null;
}

export interface SessionSnapshot {
  roomIndex: number;
  room: RoomDefinition;
  runtime: RoomRuntime;
  isPaused: boolean;
  isComplete: boolean;
  completion: CompletionSummary | null;
}
