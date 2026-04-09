import Phaser from "phaser";
import { ROOMS } from "../../game/content/rooms";
import {
  distance,
  distanceToPolyline,
  distanceToRect,
  rectCenter,
  rectContains,
} from "../../game/simulation/geometry";
import { canAdvanceThroughDoor } from "../../game/simulation/exits";
import {
  createPatrolTarget,
  hasReachedTarget,
  moveTowardTarget,
} from "../../game/simulation/patrol";
import { getSpeedLimit, NORMAL_SPEED_LIMIT } from "../../game/simulation/rules";
import { GameSession } from "../../game/simulation/session";
import type {
  ConsoleDefinition,
  DoorDefinition,
  DoorRule,
  DroneDefinition,
  DroneState,
  InterpretationScores,
  ItemSlot,
  Rect,
  ResidentDefinition,
  RoomDefinition,
  RoomRuntime,
  SessionSnapshot,
  StaffDefinition,
  TerminalMode,
  WaitingZone,
} from "../../game/simulation/types";
import { getUiController } from "../../ui/controllerStore";

const DEFAULT_ROOM_WIDTH = 384;
const PRELUDE_WIDTH = 640;
const DEFAULT_ROOM_HEIGHT = 216;
const CAMERA_ZOOM = 3;
const INTERACT_RANGE = 20;
const EXIT_GRACE_MS = 220;
const INDICATE_HOLD_MS = 2000;
const MIN_SCANNER_TURN_RADIANS = Math.PI / 3;
const SCANNER_TURN_PICK_ATTEMPTS = 16;
const PRELUDE_SLOW_SPEED = 68;
const PRELUDE_GATE_PORTAL_RECT: Rect = { x: 472, y: 50, width: 108, height: 132 };
const PRELUDE_GATE_BLOCKER_RECT: Rect = { x: 510, y: 78, width: 28, height: 76 };
const PRELUDE_GATE_ART_WIDTH = 152;
const PRELUDE_GATE_ART_HEIGHT = 156;
const PRELUDE_GATE_TEXTURE_SCALE = 4;
const PRELUDE_SCENE_TEXTURE_KEY = "prelude-scene-art";
const PRELUDE_SCENE_TEXTURE_SCALE = 3;
const FACILITY_SCENE_TEXTURE_PREFIX = "facility-scene-";
const FACILITY_SCENE_TEXTURE_SCALE = 3;
const PRELUDE_GATE_ENTRY_ZONE: Rect = {
  x: PRELUDE_GATE_BLOCKER_RECT.x + PRELUDE_GATE_BLOCKER_RECT.width - 8,
  y: PRELUDE_GATE_BLOCKER_RECT.y - 10,
  width: 16,
  height: PRELUDE_GATE_BLOCKER_RECT.height + 20,
};

type ScenePhase = "prelude" | "facility";

type KeyMap = {
  up: Phaser.Input.Keyboard.Key;
  down: Phaser.Input.Keyboard.Key;
  left: Phaser.Input.Keyboard.Key;
  right: Phaser.Input.Keyboard.Key;
  upAlt: Phaser.Input.Keyboard.Key;
  downAlt: Phaser.Input.Keyboard.Key;
  leftAlt: Phaser.Input.Keyboard.Key;
  rightAlt: Phaser.Input.Keyboard.Key;
  shift: Phaser.Input.Keyboard.Key;
  interact: Phaser.Input.Keyboard.Key;
  indicate: Phaser.Input.Keyboard.Key;
  reset: Phaser.Input.Keyboard.Key;
  pause: Phaser.Input.Keyboard.Key;
};

interface RenderedDoor {
  def: DoorDefinition;
  shape: Phaser.GameObjects.Rectangle;
  body: Phaser.Physics.Arcade.StaticBody;
  label: Phaser.GameObjects.Text;
  open: boolean;
  exitGraceMs: number;
}

interface PreludeGateVisuals {
  blocker: Phaser.GameObjects.Rectangle;
  body: Phaser.Physics.Arcade.StaticBody;
  art: Phaser.GameObjects.Image;
}

interface RenderedDrone {
  def: DroneDefinition;
  shadow: Phaser.GameObjects.Ellipse;
  sprite: Phaser.GameObjects.Image;
  light: Phaser.GameObjects.Arc;
  range: Phaser.GameObjects.Arc;
  label: Phaser.GameObjects.Text;
  state: DroneState;
}

interface RenderedItem {
  id: string;
  shadow: Phaser.GameObjects.Ellipse;
  sprite: Phaser.GameObjects.Image;
  label: Phaser.GameObjects.Text;
  slotId: string | null;
}

interface RenderedSlot {
  slot: ItemSlot;
  shape: Phaser.GameObjects.Rectangle;
  label: Phaser.GameObjects.Text;
}

interface RenderedConsole {
  def: ConsoleDefinition;
  shape: Phaser.GameObjects.Rectangle;
  label: Phaser.GameObjects.Text;
}

interface RenderedResident {
  def: ResidentDefinition;
  marker: Phaser.GameObjects.Arc;
  shadow: Phaser.GameObjects.Ellipse;
  sprite: Phaser.GameObjects.Image;
  label: Phaser.GameObjects.Text;
  serviceHalo: Phaser.GameObjects.Arc;
}

interface RenderedStaff {
  def: StaffDefinition;
  marker: Phaser.GameObjects.Arc;
  shadow: Phaser.GameObjects.Ellipse;
  sprite: Phaser.GameObjects.Image;
  label: Phaser.GameObjects.Text;
  statusHalo: Phaser.GameObjects.Arc;
}

interface RenderedSignalZone {
  id: string;
  rect: Rect;
  shape: Phaser.GameObjects.Rectangle;
  overlay: Phaser.GameObjects.Graphics;
  reticle: Phaser.GameObjects.Graphics;
}

interface RenderedWaitingZone {
  zone: WaitingZone;
  shape: Phaser.GameObjects.Rectangle;
  label: Phaser.GameObjects.Text;
}

interface ScannerPatrolRuntime {
  lingerMs: number;
  segmentAngleRadians: number;
  target: { x: number; y: number };
}

type PlayerFacing = "left" | "right" | "up" | "down";

type FacilityScenePalette = {
  ceilingTop: string;
  ceilingBottom: string;
  floorTop: string;
  floorBottom: string;
  panel: number;
  trim: number;
  accent: number;
  accentSoft: number;
  warm: number;
  utility: number;
};

const PLAYER_COLORS = {
  skin: 0xd4b18c,
  hair: 0x1a212c,
  outerwear: 0x325364,
  outerwearShade: 0x223947,
  innerwear: 0x8ab7c4,
  trousers: 0x263241,
  shoes: 0x0f141c,
  accent: 0x66dfff,
} as const;

export class GameScene extends Phaser.Scene {
  private session = new GameSession();
  private ui = getUiController();
  private keys!: KeyMap;
  private player!: Phaser.Physics.Arcade.Image;
  private playerShadow!: Phaser.GameObjects.Ellipse;
  private playerVisual!: Phaser.GameObjects.Graphics;
  private playerFacing: PlayerFacing = "right";
  private playerStridePhase = 0;
  private playerBobOffset = 0;
  private backdrop!: Phaser.GameObjects.Graphics;
  private backdropDetail!: Phaser.GameObjects.Graphics;
  private indicateRing!: Phaser.GameObjects.Arc;
  private guideGraphics!: Phaser.GameObjects.Graphics;
  private roomTitle!: Phaser.GameObjects.Text;
  private roomObjects: Phaser.GameObjects.GameObject[] = [];
  private preludeObjects: Phaser.GameObjects.GameObject[] = [];
  private wallBodies: Phaser.GameObjects.Rectangle[] = [];
  private wallColliders: Phaser.Physics.Arcade.Collider[] = [];
  private preludeColliders: Phaser.Physics.Arcade.Collider[] = [];
  private doorObjects = new Map<string, RenderedDoor>();
  private droneObjects = new Map<string, RenderedDrone>();
  private itemObjects = new Map<string, RenderedItem>();
  private slotObjects = new Map<string, RenderedSlot>();
  private consoleObjects = new Map<string, RenderedConsole>();
  private residentObjects = new Map<string, RenderedResident>();
  private staffObjects = new Map<string, RenderedStaff>();
  private signalZoneObjects = new Map<string, RenderedSignalZone>();
  private waitingZoneObjects = new Map<string, RenderedWaitingZone>();
  private scannerPatrolStates = new Map<string, ScannerPatrolRuntime>();
  private roomRef = this.session.getSnapshot().runtime;
  private currentRoom = ROOMS[0];
  private phase: ScenePhase = "prelude";
  private preludeActive = false;
  private preludeHint =
    "先靠近同伴按 E 交接，再从右侧外门进去。";
  private preludeCompanionSpoken = false;
  private preludeGateUnlocked = false;
  private preludeCompanionPrompt: Phaser.GameObjects.Text | null = null;
  private preludeGate: PreludeGateVisuals | null = null;
  private carriedItemId: string | null = null;
  private indicateChargeMs = 0;
  private indicateZoneId: string | null = null;

  constructor() {
    super("game");
  }

  create(): void {
    this.physics.world.setBounds(0, 0, PRELUDE_WIDTH, DEFAULT_ROOM_HEIGHT);
    this.cameras.main.setBackgroundColor(0x0f1319);
    this.cameras.main.setBounds(0, 0, PRELUDE_WIDTH, DEFAULT_ROOM_HEIGHT);
    this.cameras.main.setZoom(CAMERA_ZOOM);
    this.cameras.main.roundPixels = true;

    this.keys = this.createKeys();
    this.createBackdrop();
    this.createPlayer();
    this.cameras.main.startFollow(this.player, true, 0.18, 0.18);
    this.createForeground();

    this.ui.bindCommands({
      start: () => this.handleStart(),
      resume: () => this.handleResume(),
      restart: () => this.handleRestart(),
    });

    this.loadPrelude();
    this.ui.showIntro();
    this.syncHud();
  }

  update(_: number, delta: number): void {
    if (Phaser.Input.Keyboard.JustDown(this.keys.pause)) {
      this.handlePauseToggle();
    }

    if (Phaser.Input.Keyboard.JustDown(this.keys.reset)) {
      if (this.phase === "prelude") {
        this.loadPrelude();
      } else {
        this.session.resetRoom();
        this.loadRoom();
      }
      this.syncHud();
      return;
    }

    if (this.phase === "prelude") {
      this.updatePrelude(delta);
      return;
    }

    const snapshot = this.session.getSnapshot();
    const room = snapshot.room;
    const runtime = snapshot.runtime;
    const controlsLocked =
      snapshot.isPaused || snapshot.isComplete || runtime.alertCountdownMs !== null;

    const movementMode = this.getMovementMode();
    const velocity = this.getInputVelocity();
    const speedLimit = getSpeedLimit(movementMode);
    const body = this.player.body as Phaser.Physics.Arcade.Body;

    if (controlsLocked) {
      body.setVelocity(0, 0);
      this.indicateChargeMs = 0;
      this.indicateZoneId = null;
    } else {
      body.setVelocity(velocity.x * speedLimit, velocity.y * speedLimit);
    }

    this.updateScannerMotion(controlsLocked ? 0 : delta);

    const playerPos = { x: this.player.x, y: this.player.y };
    const activeSignalZone = room.signalZones.find((zone) =>
      rectContains(zone.rect, playerPos),
    );
    const activeWaitingZone = room.waitingZones?.find((zone) =>
      rectContains(zone.rect, playerPos),
    );
    const droneVisibility = room.drones
      .filter((drone) => this.isDroneVisible(drone))
      .map((drone) => drone.id);
    const isInSignalZone = activeSignalZone !== undefined;
    const isOnMaintenancePath = this.getActiveGuidePaths(room, runtime)
      .some((path) => distanceToPolyline(playerPos, path.points) <= path.tolerance);
    const signalEnabled =
      !room.signalRequiresActivation || runtime.guideFieldPrimed;
    const isInGuideRange =
      runtime.guideMemory.remainingMs > 0 && droneVisibility.length > 0;
    const isOnTrustedRoute = isOnMaintenancePath || isInGuideRange;

    const canChargeIndication =
      !controlsLocked &&
      this.keys.indicate.isDown &&
      isInSignalZone &&
      signalEnabled &&
      body.velocity.length() < 10;

    if (!canChargeIndication) {
      this.indicateChargeMs = 0;
      this.indicateZoneId = null;
    } else {
      if (this.indicateZoneId !== activeSignalZone?.id) {
        this.indicateChargeMs = 0;
        this.indicateZoneId = activeSignalZone?.id ?? null;
      }
      this.indicateChargeMs = Math.min(
        INDICATE_HOLD_MS,
        this.indicateChargeMs + delta,
      );
    }

    const indicateProgress = this.indicateChargeMs / INDICATE_HOLD_MS;
    const isIndicating = indicateProgress >= 1;
    this.renderIndicateRing(indicateProgress);

    const droneStates = this.session.updateIntent(
      {
        playerPosition: playerPos,
        movementMode,
        speed: body.velocity.length(),
        isIndicating,
        isInSignalZone,
        isInGuideRange,
        isOnTrustedRoute,
        signalEnabled,
        carryingItemType: this.carriedItemId ? "battery" : null,
        terminalMode: runtime.terminalMode,
        visibleDroneIds: droneVisibility,
        activeWaitingZoneId: activeWaitingZone?.id ?? null,
      },
      delta,
    );

    this.updateEscortMotion(delta);
    this.syncDoorStates(delta);
    if (this.processExits()) {
      return;
    }
    this.syncDroneStates(droneStates);
    this.syncConsoles();
    this.syncSignalZones(
      activeSignalZone?.id ?? null,
      indicateProgress,
      signalEnabled,
      runtime.guideMemory.remainingMs > 0,
    );
    this.syncGuidePaths();
    this.syncResidents();
    this.syncStaff();
    this.syncWaitingZones(
      activeWaitingZone?.id ?? null,
      runtime.receptionConfirmedMs > 0,
    );
    this.syncItems();
    this.syncPlayerShadow(delta);
    this.processInteractions();
    this.processTriggers();
    const latestSnapshot = this.session.getSnapshot();
    if (latestSnapshot.runtime !== this.roomRef || latestSnapshot.room.id !== this.currentRoom.id) {
      this.loadRoom();
    }

    this.syncHud();

    if (latestSnapshot.isComplete) {
      body.setVelocity(0, 0);
      this.ui.showCompletion();
    }
  }

  private handleStart(): void {
    this.preludeActive = true;
    this.ui.hideModal();
    this.syncHud();
  }

  private handleResume(): void {
    if (this.phase === "prelude") {
      this.preludeActive = true;
    } else {
      this.session.setPaused(false);
    }
    this.ui.hideModal();
    this.syncHud();
  }

  private handleRestart(): void {
    this.session = new GameSession();
    this.phase = "prelude";
    this.preludeActive = false;
    this.carriedItemId = null;
    this.indicateChargeMs = 0;
    this.loadPrelude();
    this.ui.showIntro();
    this.syncHud();
  }

  private handlePauseToggle(): void {
    if (this.phase === "prelude") {
      if (!this.preludeActive) {
        this.handleResume();
        return;
      }

      this.preludeActive = false;
      this.ui.showPause();
      this.syncHud();
      return;
    }

    const snapshot = this.session.getSnapshot();
    if (snapshot.isComplete) {
      return;
    }

    if (snapshot.isPaused) {
      this.handleResume();
      return;
    }

    this.session.setPaused(true);
    this.ui.showPause();
    this.syncHud();
  }

  private createKeys(): KeyMap {
    const keys = this.input.keyboard?.addKeys({
      up: Phaser.Input.Keyboard.KeyCodes.W,
      down: Phaser.Input.Keyboard.KeyCodes.S,
      left: Phaser.Input.Keyboard.KeyCodes.A,
      right: Phaser.Input.Keyboard.KeyCodes.D,
      upAlt: Phaser.Input.Keyboard.KeyCodes.UP,
      downAlt: Phaser.Input.Keyboard.KeyCodes.DOWN,
      leftAlt: Phaser.Input.Keyboard.KeyCodes.LEFT,
      rightAlt: Phaser.Input.Keyboard.KeyCodes.RIGHT,
      shift: Phaser.Input.Keyboard.KeyCodes.SHIFT,
      interact: Phaser.Input.Keyboard.KeyCodes.E,
      indicate: Phaser.Input.Keyboard.KeyCodes.SPACE,
      reset: Phaser.Input.Keyboard.KeyCodes.R,
      pause: Phaser.Input.Keyboard.KeyCodes.ESC,
    }) as KeyMap | undefined;

    if (!keys) {
      throw new Error("键盘输入不可用。");
    }

    this.input.keyboard?.addCapture([
      Phaser.Input.Keyboard.KeyCodes.SPACE,
      Phaser.Input.Keyboard.KeyCodes.UP,
      Phaser.Input.Keyboard.KeyCodes.DOWN,
      Phaser.Input.Keyboard.KeyCodes.LEFT,
      Phaser.Input.Keyboard.KeyCodes.RIGHT,
    ]);

    return keys;
  }

  private createBackdrop(): void {
    this.backdrop = this.add.graphics();
    this.backdrop.setDepth(0);
    this.backdropDetail = this.add.graphics();
    this.backdropDetail.setDepth(0.5);
  }

  private drawBackdrop(mode: ScenePhase, width: number, height: number): void {
    this.backdrop.clear();
    this.backdropDetail.clear();

    if (mode === "prelude") {
      this.backdrop.fillGradientStyle(0x152435, 0x152435, 0x0a1118, 0x0a1118, 1);
      this.backdrop.fillRect(0, 0, width, height);
      this.backdrop.fillStyle(0x47667b, 0.16);
      this.backdrop.fillEllipse(width * 0.16, height * 0.16, 180, 88);
      this.backdrop.fillStyle(0xf3b65b, 0.08);
      this.backdrop.fillEllipse(width * 0.76, height * 0.24, 220, 110);
      this.drawPreludeTownscape(width, height);
      this.backdrop.fillStyle(0x0f1721, 0.78);
      this.backdrop.fillRect(0, height - 70, width, 70);
      this.backdrop.fillStyle(0x111c27, 0.92);
      this.backdrop.fillRect(0, height - 30, width, 30);
      this.backdrop.fillStyle(0x0d141d, 0.95);
      this.backdrop.fillRoundedRect(width - 136, 26, 112, height - 52, 12);
      this.backdrop.lineStyle(2, 0x34475a, 0.65);
      this.backdrop.strokeRoundedRect(width - 136, 26, 112, height - 52, 12);
      this.backdrop.lineStyle(1, 0x28394c, 0.22);
      for (let x = 0; x <= width; x += 32) {
        this.backdrop.lineBetween(x, height - 70, x + 16, height);
      }

      this.backdropDetail.fillStyle(0x1b2a39, 0.85);
      this.backdropDetail.fillRect(0, 26, width, 10);
      this.backdropDetail.fillStyle(0x6be2ff, 0.16);
      this.backdropDetail.fillRect(34, height - 44, 86, 2);
      this.backdropDetail.fillStyle(0xf3b65b, 0.18);
      this.backdropDetail.fillRect(width - 114, 46, 64, 2);
      this.backdropDetail.lineStyle(1, 0x2d4257, 0.45);
      this.backdropDetail.lineBetween(38, height - 54, width - 172, height - 54);
      this.backdropDetail.lineBetween(38, height - 50, width - 172, height - 50);
      this.backdropDetail.strokeRoundedRect(42, height - 124, 86, 46, 8);
      this.backdropDetail.strokeRoundedRect(174, height - 138, 68, 58, 8);
      this.backdropDetail.strokeCircle(width - 58, height - 28, 3);
      return;
    }

    this.backdrop.fillGradientStyle(0x121a25, 0x121a25, 0x090c11, 0x090c11, 1);
    this.backdrop.fillRect(0, 0, width, height);
    this.backdrop.fillStyle(0x1c3b57, 0.12);
    this.backdrop.fillEllipse(width * 0.22, height * 0.18, 154, 92);
    this.backdrop.fillStyle(0xf0b35c, 0.07);
    this.backdrop.fillEllipse(width * 0.8, height * 0.72, 176, 118);
    this.backdrop.fillStyle(0x0f1621, 0.9);
    this.backdrop.fillRoundedRect(8, 8, width - 16, height - 16, 14);
    this.backdrop.fillStyle(0x141d29, 0.72);
    this.backdrop.fillRoundedRect(18, 16, 162, 54, 12);
    this.backdrop.lineStyle(2, 0x253448, 0.92);
    this.backdrop.strokeRoundedRect(8, 8, width - 16, height - 16, 14);
    this.backdrop.lineStyle(1, 0x324863, 0.24);
    this.backdrop.strokeRoundedRect(18, 16, 162, 54, 12);
    this.backdrop.lineStyle(1, 0x18212c, 0.88);
    for (let x = 0; x <= width; x += 24) {
      this.backdrop.lineBetween(x, 0, x, height);
    }
    for (let y = 0; y <= height; y += 24) {
      this.backdrop.lineBetween(0, y, width, y);
    }
    this.backdrop.lineStyle(2, 0x122031, 0.64);
    this.backdrop.lineBetween(20, 30, width - 20, 30);
    this.backdrop.lineBetween(20, height - 26, width - 20, height - 26);
    this.backdrop.lineStyle(1, 0x27435e, 0.2);
    this.backdrop.lineBetween(18, 22, width - 18, 22);
    this.backdrop.lineBetween(18, height - 22, width - 18, height - 22);

    this.backdrop.fillStyle(0x101823, 0.72);
    this.backdrop.fillRoundedRect(20, height - 36, 58, 14, 4);
    this.backdrop.fillRoundedRect(width - 92, 20, 54, 14, 4);
    this.backdrop.fillStyle(0x6be2ff, 0.12);
    this.backdrop.fillRect(24, height - 31, 50, 1);
    this.backdrop.fillStyle(0xf0b35c, 0.1);
    this.backdrop.fillRect(width - 88, 25, 46, 1);

    this.backdropDetail.lineStyle(1, 0x304559, 0.34);
    this.backdropDetail.strokeRoundedRect(26, 146, 46, 16, 4);
    this.backdropDetail.strokeRoundedRect(width - 84, 122, 42, 18, 4);
    this.backdropDetail.lineStyle(1, 0x46627e, 0.18);
    for (let x = 30; x <= 64; x += 6) {
      this.backdropDetail.lineBetween(x, 150, x, 158);
    }
    for (let x = width - 80; x <= width - 48; x += 6) {
      this.backdropDetail.lineBetween(x, 126, x, 136);
    }
    this.backdropDetail.lineStyle(1, 0x345067, 0.28);
    this.backdropDetail.lineBetween(20, 72, 112, 72);
    this.backdropDetail.lineBetween(width - 112, height - 44, width - 34, height - 44);
    this.backdropDetail.strokeCircle(28, 30, 2);
    this.backdropDetail.strokeCircle(width - 28, height - 28, 2);
  }

  private drawPreludeTownscape(width: number, height: number): void {
    const skylineBaseY = height - 92;
    const roadY = skylineBaseY - 5;
    const farBuildings = [
      { x: 14, width: 20, height: 16, beacon: false },
      { x: 38, width: 28, height: 24, beacon: false },
      { x: 72, width: 16, height: 14, beacon: false },
      { x: 92, width: 30, height: 30, beacon: false },
      { x: 128, width: 24, height: 18, beacon: false },
      { x: 156, width: 34, height: 34, beacon: true },
      { x: 194, width: 18, height: 16, beacon: false },
      { x: 216, width: 28, height: 22, beacon: false },
      { x: 248, width: 42, height: 38, beacon: false },
      { x: 296, width: 20, height: 18, beacon: false },
      { x: 320, width: 30, height: 28, beacon: false },
      { x: 354, width: 24, height: 20, beacon: false },
      { x: 382, width: 36, height: 34, beacon: false },
      { x: 424, width: 22, height: 22, beacon: false },
      { x: 452, width: 30, height: 30, beacon: false },
      { x: 486, width: 16, height: 44, beacon: true },
    ] as const;
    const nearBuildings = [
      { x: 24, width: 42, height: 28, sign: false },
      { x: 72, width: 34, height: 24, sign: true },
      { x: 112, width: 48, height: 42, sign: false },
      { x: 168, width: 38, height: 30, sign: false },
      { x: 212, width: 54, height: 46, sign: true },
      { x: 272, width: 46, height: 34, sign: false },
      { x: 326, width: 38, height: 26, sign: false },
      { x: 370, width: 52, height: 40, sign: true },
      { x: 430, width: 44, height: 30, sign: false },
      { x: 482, width: 18, height: 54, sign: false },
    ] as const;
    const paintWindows = (
      x: number,
      y: number,
      buildingWidth: number,
      buildingHeight: number,
      color: number,
      alpha: number,
      spacingX: number,
      spacingY: number,
      insetX: number,
      insetY: number,
    ): void => {
      this.backdropDetail.fillStyle(color, alpha);
      for (let windowY = y + insetY; windowY <= y + buildingHeight - insetY - 2; windowY += spacingY) {
        for (
          let windowX = x + insetX;
          windowX <= x + buildingWidth - insetX - 2;
          windowX += spacingX
        ) {
          if (((windowX + windowY + x) / 2) % 3 < 1) {
            continue;
          }
          this.backdropDetail.fillRect(windowX, windowY, 2, 2);
        }
      }
    };

    this.backdrop.fillStyle(0x31546a, 0.08);
    this.backdrop.fillEllipse(width * 0.46, skylineBaseY - 16, 320, 48);
    this.backdrop.fillStyle(0x182938, 0.32);
    this.backdrop.fillRect(0, roadY - 3, width - 148, 8);

    this.backdrop.fillStyle(0x162534, 0.66);
    for (const building of farBuildings) {
      const y = skylineBaseY - building.height;
      this.backdrop.fillRect(building.x, y, building.width, building.height);
      this.backdrop.fillRect(building.x + 2, y - 3, Math.max(6, building.width - 8), 3);
      if (building.beacon) {
        this.backdrop.fillRect(building.x + Math.floor(building.width / 2), y - 8, 1, 5);
      }
      paintWindows(
        building.x,
        y,
        building.width,
        building.height,
        0xf3c270,
        0.16,
        6,
        7,
        3,
        5,
      );
    }

    this.backdrop.fillStyle(0x0e1a25, 0.82);
    for (const building of nearBuildings) {
      const y = skylineBaseY - building.height;
      this.backdrop.fillRoundedRect(building.x, y, building.width, building.height, 3);
      this.backdrop.fillRect(building.x + 3, y - 4, Math.max(8, building.width - 10), 4);
      this.backdrop.fillRect(building.x + building.width - 8, y + 6, 3, building.height - 12);
      if (building.sign) {
        this.backdropDetail.fillStyle(0x6be2ff, 0.18);
        this.backdropDetail.fillRect(building.x + 6, y + 8, 8, 2);
      }
      paintWindows(
        building.x,
        y,
        building.width,
        building.height,
        0xf3b65b,
        0.24,
        7,
        8,
        4,
        6,
      );
      paintWindows(
        building.x + 1,
        y + 1,
        building.width - 2,
        building.height - 2,
        0x8ddcff,
        0.08,
        9,
        11,
        5,
        8,
      );
    }

    this.backdrop.fillStyle(0x101a24, 0.74);
    this.backdrop.fillRect(0, skylineBaseY + 2, width - 152, 10);
    this.backdropDetail.lineStyle(1, 0x34556f, 0.24);
    this.backdropDetail.lineBetween(0, roadY, width - 150, roadY);
    this.backdropDetail.lineBetween(0, roadY + 3, width - 150, roadY + 3);
    this.backdropDetail.fillStyle(0x6be2ff, 0.18);
    for (let x = 22; x <= width - 176; x += 48) {
      this.backdropDetail.fillRect(x, roadY - 1, 8, 1);
    }
    this.backdropDetail.fillStyle(0xf3b65b, 0.28);
    for (let x = 34; x <= width - 188; x += 40) {
      this.backdropDetail.fillRect(x, roadY + 2, 4, 1);
    }
    this.backdropDetail.fillStyle(0xff8f78, 0.34);
    this.backdropDetail.fillCircle(173, skylineBaseY - 42, 1.2);
    this.backdropDetail.fillCircle(494, skylineBaseY - 52, 1.2);
  }

  private createPreludeSceneTexture(): void {
    if (this.textures.exists(PRELUDE_SCENE_TEXTURE_KEY)) {
      this.textures.remove(PRELUDE_SCENE_TEXTURE_KEY);
    }

    const canvasWidth = PRELUDE_WIDTH * PRELUDE_SCENE_TEXTURE_SCALE;
    const canvasHeight = DEFAULT_ROOM_HEIGHT * PRELUDE_SCENE_TEXTURE_SCALE;
    const texture = this.textures.createCanvas(
      PRELUDE_SCENE_TEXTURE_KEY,
      canvasWidth,
      canvasHeight,
    );
    if (!texture) {
      throw new Error(`无法创建前奏场景纹理：${PRELUDE_SCENE_TEXTURE_KEY}`);
    }

    const ctx = texture.context;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);
    ctx.imageSmoothingEnabled = true;
    ctx.scale(PRELUDE_SCENE_TEXTURE_SCALE, PRELUDE_SCENE_TEXTURE_SCALE);
    this.drawPreludeSceneTexture(ctx, PRELUDE_WIDTH, DEFAULT_ROOM_HEIGHT);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    texture.refresh();
  }

  private drawPreludeSceneTexture(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
  ): void {
    const drawEllipse = (
      centerX: number,
      centerY: number,
      radiusX: number,
      radiusY: number,
      fillStyle: string | CanvasGradient,
    ): void => {
      ctx.beginPath();
      ctx.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, Math.PI * 2);
      ctx.fillStyle = fillStyle;
      ctx.fill();
    };
    const drawWindows = (
      x: number,
      y: number,
      buildingWidth: number,
      buildingHeight: number,
      color: number,
      alpha: number,
      stepX: number,
      stepY: number,
      insetX: number,
      insetY: number,
    ): void => {
      ctx.fillStyle = this.colorToRgba(color, alpha);
      for (let windowY = y + insetY; windowY <= y + buildingHeight - insetY - 2; windowY += stepY) {
        for (
          let windowX = x + insetX;
          windowX <= x + buildingWidth - insetX - 2;
          windowX += stepX
        ) {
          if (((windowX + windowY + x) / 2) % 4 < 1.2) {
            continue;
          }
          ctx.fillRect(windowX, windowY, 2, 2);
        }
      }
    };

    const sky = ctx.createLinearGradient(0, 0, 0, height);
    sky.addColorStop(0, "#0b1218");
    sky.addColorStop(0.42, "#132536");
    sky.addColorStop(1, "#1c3348");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, height);

    drawEllipse(width * 0.68, 38, 118, 46, this.colorToRgba(0xf2ae58, 0.08));
    drawEllipse(width * 0.22, 34, 92, 28, this.colorToRgba(0x5a8fbe, 0.08));
    drawEllipse(width * 0.48, 66, 156, 24, this.colorToRgba(0x6eb6d3, 0.04));

    ctx.fillStyle = this.colorToRgba(0x1f3346, 0.62);
    ctx.fillRect(0, 20, width, 8);
    ctx.fillStyle = this.colorToRgba(0x5ecbff, 0.06);
    ctx.fillRect(0, 24, width, 1);

    const farBuildings = [
      { x: 4, width: 18, height: 18 },
      { x: 24, width: 32, height: 14 },
      { x: 62, width: 42, height: 10 },
      { x: 110, width: 28, height: 16 },
      { x: 144, width: 36, height: 13 },
      { x: 188, width: 22, height: 24 },
      { x: 214, width: 38, height: 14 },
      { x: 260, width: 24, height: 20 },
      { x: 290, width: 34, height: 30 },
      { x: 332, width: 18, height: 16 },
      { x: 356, width: 28, height: 24 },
      { x: 390, width: 22, height: 18 },
      { x: 418, width: 32, height: 22 },
    ] as const;
    const nearBuildings = [
      { x: 18, width: 44, height: 24, sign: false },
      { x: 68, width: 34, height: 18, sign: true },
      { x: 108, width: 50, height: 30, sign: false },
      { x: 164, width: 36, height: 20, sign: false },
      { x: 206, width: 54, height: 34, sign: true },
      { x: 266, width: 44, height: 26, sign: false },
      { x: 318, width: 38, height: 22, sign: false },
      { x: 362, width: 54, height: 30, sign: true },
      { x: 422, width: 34, height: 18, sign: false },
    ] as const;
    const skylineBaseY = 118;

    ctx.fillStyle = this.colorToRgba(0x13212e, 0.74);
    for (const building of farBuildings) {
      const y = skylineBaseY - building.height - 8;
      ctx.fillRect(building.x, y, building.width, building.height);
      ctx.fillRect(building.x + 2, y - 3, Math.max(6, building.width - 8), 3);
      drawWindows(building.x, y, building.width, building.height, 0xf4bb6a, 0.14, 6, 6, 3, 5);
    }

    ctx.fillStyle = this.colorToRgba(0x0d1721, 0.9);
    for (const building of nearBuildings) {
      const y = skylineBaseY - building.height;
      this.fillRoundedRectCanvas(ctx, building.x, y, building.width, building.height, 2, this.colorToRgba(0x101b25, 0.94));
      ctx.fillRect(building.x + 3, y - 3, Math.max(8, building.width - 10), 3);
      ctx.fillRect(building.x + building.width - 7, y + 6, 3, building.height - 12);
      if (building.sign) {
        this.fillRoundedRectCanvas(
          ctx,
          building.x + 6,
          y + 8,
          10,
          2,
          1,
          this.colorToRgba(0x63d8ff, 0.2),
        );
      }
      drawWindows(building.x, y, building.width, building.height, 0xf4bb6a, 0.18, 7, 8, 4, 6);
    }

    const facade = ctx.createLinearGradient(0, 44, 0, height);
    facade.addColorStop(0, "#182634");
    facade.addColorStop(0.6, "#101820");
    facade.addColorStop(1, "#0c1117");
    this.fillRoundedRectCanvas(ctx, 412, 34, 204, 160, 22, facade);
    this.strokeRoundedRectCanvas(ctx, 412, 34, 204, 160, 22, this.colorToRgba(0x32485d, 0.64), 2);

    const wallInset = ctx.createLinearGradient(412, 44, 616, 186);
    wallInset.addColorStop(0, "#0f1720");
    wallInset.addColorStop(1, "#091018");
    this.fillRoundedRectCanvas(ctx, 430, 58, 162, 118, 18, wallInset);
    this.strokeRoundedRectCanvas(ctx, 430, 58, 162, 118, 18, this.colorToRgba(0x223446, 0.46), 1.5);

    ctx.fillStyle = this.colorToRgba(0x4c657b, 0.26);
    for (const x of [416, 430, 446]) {
      ctx.fillRect(x, 40, 4, 116);
    }
    ctx.fillStyle = this.colorToRgba(0xf0b35c, 0.18);
    ctx.fillRect(462, 52, 96, 2);
    ctx.fillStyle = this.colorToRgba(0x70dbb5, 0.08);
    ctx.fillRect(446, 72, 132, 1);

    const entryGlow = ctx.createRadialGradient(532, 96, 8, 532, 96, 58);
    entryGlow.addColorStop(0, this.colorToRgba(0x8ff0a4, 0.16));
    entryGlow.addColorStop(1, this.colorToRgba(0x8ff0a4, 0));
    ctx.fillStyle = entryGlow;
    ctx.fillRect(470, 46, 126, 104);

    ctx.beginPath();
    ctx.moveTo(0, 124);
    ctx.lineTo(width, 124);
    ctx.lineTo(width, height);
    ctx.lineTo(0, height);
    ctx.closePath();
    const ground = ctx.createLinearGradient(0, 124, 0, height);
    ground.addColorStop(0, "#22374a");
    ground.addColorStop(0.55, "#162230");
    ground.addColorStop(1, "#0b1117");
    ctx.fillStyle = ground;
    ctx.fill();

    ctx.fillStyle = this.colorToRgba(0x0b1117, 0.68);
    ctx.fillRect(0, 178, width, 38);
    ctx.fillStyle = this.colorToRgba(0x40617d, 0.14);
    ctx.fillRect(0, 126, width, 2);
    const pavement = ctx.createLinearGradient(0, 130, 0, 184);
    pavement.addColorStop(0, "#1b2a38");
    pavement.addColorStop(0.42, "#172330");
    pavement.addColorStop(1, "#101821");
    this.fillRoundedRectCanvas(ctx, 18, 128, width - 54, 48, 8, pavement);
    this.strokeRoundedRectCanvas(
      ctx,
      18,
      128,
      width - 54,
      48,
      8,
      this.colorToRgba(0x4e6378, 0.18),
      1,
    );
    this.fillRoundedRectCanvas(ctx, 28, 134, width - 80, 34, 6, this.colorToRgba(0x101821, 0.28));
    ctx.fillStyle = this.colorToRgba(0xb8c6d2, 0.05);
    ctx.fillRect(24, 132, width - 70, 1);
    ctx.fillStyle = this.colorToRgba(0x0a1016, 0.36);
    ctx.fillRect(0, 168, width, 3);
    ctx.fillStyle = this.colorToRgba(0x30475d, 0.22);
    ctx.fillRect(0, 170, width, 1);
    ctx.fillStyle = this.colorToRgba(0x162432, 0.68);
    this.fillRoundedRectCanvas(ctx, 24, 122, 128, 42, 8, this.colorToRgba(0x1a2835, 0.76));

    const asphaltPatches = [
      { x: 42, y: 144, width: 56, height: 14 },
      { x: 128, y: 138, width: 86, height: 10 },
      { x: 276, y: 146, width: 74, height: 12 },
      { x: 404, y: 140, width: 68, height: 11 },
      { x: 516, y: 146, width: 52, height: 10 },
    ] as const;
    for (const patch of asphaltPatches) {
      this.fillRoundedRectCanvas(
        ctx,
        patch.x,
        patch.y,
        patch.width,
        patch.height,
        4,
        this.colorToRgba(0x0e161f, 0.24),
      );
    }

    ctx.strokeStyle = this.colorToRgba(0x7aaecf, 0.08);
    ctx.lineWidth = 1;
    const surfaceStreaks = [
      [34, 158, 122, 153],
      [154, 154, 240, 151],
      [282, 158, 370, 154],
      [430, 152, 520, 149],
      [548, 158, 602, 155],
    ] as const;
    for (const [x1, y1, x2, y2] of surfaceStreaks) {
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }

    ctx.fillStyle = this.colorToRgba(0xffffff, 0.025);
    const aggregateDots = [
      [58, 150],
      [74, 146],
      [96, 154],
      [188, 142],
      [206, 148],
      [232, 154],
      [324, 150],
      [346, 144],
      [442, 150],
      [468, 144],
      [494, 152],
      [566, 148],
      [590, 152],
    ] as const;
    for (const [dotX, dotY] of aggregateDots) {
      ctx.fillRect(dotX, dotY, 2, 2);
    }

    const puddles = [
      { x: 34, y: 151, width: 44, height: 4 },
      { x: 104, y: 138, width: 82, height: 6 },
      { x: 248, y: 150, width: 66, height: 5 },
      { x: 430, y: 141, width: 74, height: 6 },
    ] as const;
    for (const puddle of puddles) {
      const reflection = ctx.createLinearGradient(puddle.x, puddle.y, puddle.x, puddle.y + puddle.height);
      reflection.addColorStop(0, this.colorToRgba(0x76d6ff, 0.14));
      reflection.addColorStop(1, this.colorToRgba(0x76d6ff, 0));
      this.fillRoundedRectCanvas(
        ctx,
        puddle.x,
        puddle.y,
        puddle.width,
        puddle.height,
        3,
        reflection,
      );
    }

    ctx.fillStyle = this.colorToRgba(0x0a1118, 0.4);
    ctx.fillRect(0, 118, width, 12);
    ctx.fillStyle = this.colorToRgba(0xffffff, 0.02);
    ctx.fillRect(0, 120, width, 1);
  }

  private getFacilitySceneTextureKey(roomId: string): string {
    return `${FACILITY_SCENE_TEXTURE_PREFIX}${roomId}`;
  }

  private getFacilityScenePalette(roomId: string): FacilityScenePalette {
    switch (roomId) {
      case "room-1":
        return {
          ceilingTop: "#15202c",
          ceilingBottom: "#091018",
          floorTop: "#17212c",
          floorBottom: "#0b1117",
          panel: 0x223243,
          trim: 0x4e6378,
          accent: 0x6fdcff,
          accentSoft: 0x315f73,
          warm: 0xf0b86b,
          utility: 0x8ef4e6,
        };
      case "room-1b":
        return {
          ceilingTop: "#171f2a",
          ceilingBottom: "#0b1016",
          floorTop: "#19212c",
          floorBottom: "#0d1218",
          panel: 0x243141,
          trim: 0x50667a,
          accent: 0x83dfff,
          accentSoft: 0x355e73,
          warm: 0xf3c070,
          utility: 0x9ff5ff,
        };
      case "room-2":
        return {
          ceilingTop: "#162028",
          ceilingBottom: "#0a0f14",
          floorTop: "#161d25",
          floorBottom: "#0b1015",
          panel: 0x25313d,
          trim: 0x55677b,
          accent: 0x8ce09f,
          accentSoft: 0x355f49,
          warm: 0xe8bb66,
          utility: 0x7fe6ff,
        };
      case "room-3":
        return {
          ceilingTop: "#181f29",
          ceilingBottom: "#0b1016",
          floorTop: "#171e28",
          floorBottom: "#0c1118",
          panel: 0x27313d,
          trim: 0x59697d,
          accent: 0xf0c96f,
          accentSoft: 0x6c5b2f,
          warm: 0xe4a55d,
          utility: 0x6cd9ff,
        };
      case "room-4":
        return {
          ceilingTop: "#151f2a",
          ceilingBottom: "#090f16",
          floorTop: "#151d27",
          floorBottom: "#0a1016",
          panel: 0x22303d,
          trim: 0x53677c,
          accent: 0x63d8ff,
          accentSoft: 0x31596d,
          warm: 0xf1b562,
          utility: 0x9dffcf,
        };
      default:
        return {
          ceilingTop: "#151e28",
          ceilingBottom: "#090f16",
          floorTop: "#161f28",
          floorBottom: "#0a1016",
          panel: 0x22303d,
          trim: 0x4f6479,
          accent: 0x6fdcff,
          accentSoft: 0x335c72,
          warm: 0xe8b76b,
          utility: 0x98f0e3,
        };
    }
  }

  private ensureFacilitySceneTexture(
    room: RoomDefinition,
    dimensions: { width: number; height: number },
  ): string {
    const key = this.getFacilitySceneTextureKey(room.id);
    if (this.textures.exists(key)) {
      this.textures.remove(key);
    }

    const canvasWidth = Math.max(1, Math.round(dimensions.width * FACILITY_SCENE_TEXTURE_SCALE));
    const canvasHeight = Math.max(1, Math.round(dimensions.height * FACILITY_SCENE_TEXTURE_SCALE));
    const texture = this.textures.createCanvas(key, canvasWidth, canvasHeight);
    if (!texture) {
      throw new Error(`无法创建房间场景纹理：${key}`);
    }

    const ctx = texture.context;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);
    ctx.imageSmoothingEnabled = true;
    ctx.scale(FACILITY_SCENE_TEXTURE_SCALE, FACILITY_SCENE_TEXTURE_SCALE);
    this.drawFacilitySceneTexture(ctx, room, dimensions.width, dimensions.height);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    texture.refresh();
    return key;
  }

  private drawFacilitySceneTexture(
    ctx: CanvasRenderingContext2D,
    room: RoomDefinition,
    width: number,
    height: number,
  ): void {
    const palette = this.getFacilityScenePalette(room.id);
    const corridorY =
      room.doors.length > 0
        ? room.doors.reduce((sum, door) => sum + door.rect.y + door.rect.height / 2, 0) /
          room.doors.length
        : height * 0.5;
    const corridorTop = Math.max(42, corridorY - 22);
    const corridorHeight = Math.min(46, height - corridorTop - 30);
    const corridorWidth = width - 34;
    const corridorX = 17;

    const drawEllipse = (
      centerX: number,
      centerY: number,
      radiusX: number,
      radiusY: number,
      fillStyle: string | CanvasGradient,
    ): void => {
      ctx.beginPath();
      ctx.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, Math.PI * 2);
      ctx.fillStyle = fillStyle;
      ctx.fill();
    };

    const drawWorkPad = (
      rect: Rect,
      accent: number,
      fillAlpha: number,
      borderAlpha: number,
      inset: number,
    ): void => {
      const padX = rect.x - inset;
      const padY = rect.y - inset;
      const padWidth = rect.width + inset * 2;
      const padHeight = rect.height + inset * 2;
      this.fillRoundedRectCanvas(
        ctx,
        padX,
        padY,
        padWidth,
        padHeight,
        8,
        this.colorToRgba(palette.panel, fillAlpha),
      );
      this.strokeRoundedRectCanvas(
        ctx,
        padX,
        padY,
        padWidth,
        padHeight,
        8,
        this.colorToRgba(palette.trim, borderAlpha),
        1,
      );
      ctx.fillStyle = this.colorToRgba(accent, 0.08);
      ctx.fillRect(padX + 8, padY + 8, Math.max(12, padWidth - 16), 2);
    };

    const ceiling = ctx.createLinearGradient(0, 0, 0, height);
    ceiling.addColorStop(0, palette.ceilingTop);
    ceiling.addColorStop(0.6, palette.floorTop);
    ceiling.addColorStop(1, palette.ceilingBottom);
    ctx.fillStyle = ceiling;
    ctx.fillRect(0, 0, width, height);

    drawEllipse(width * 0.22, 40, 92, 38, this.colorToRgba(palette.accentSoft, 0.11));
    drawEllipse(width * 0.78, height - 34, 116, 52, this.colorToRgba(palette.warm, 0.07));
    drawEllipse(width * 0.54, corridorY - 18, 180, 24, this.colorToRgba(palette.utility, 0.03));

    const shell = ctx.createLinearGradient(0, 8, 0, height - 8);
    shell.addColorStop(0, "#0f1720");
    shell.addColorStop(1, "#0a1016");
    this.fillRoundedRectCanvas(ctx, 6, 6, width - 12, height - 12, 16, shell);
    this.strokeRoundedRectCanvas(
      ctx,
      6,
      6,
      width - 12,
      height - 12,
      16,
      this.colorToRgba(palette.trim, 0.52),
      1.5,
    );

    const chamber = ctx.createLinearGradient(0, 16, 0, height - 16);
    chamber.addColorStop(0, palette.floorTop);
    chamber.addColorStop(1, palette.floorBottom);
    this.fillRoundedRectCanvas(ctx, 14, 14, width - 28, height - 28, 12, chamber);
    this.strokeRoundedRectCanvas(
      ctx,
      14,
      14,
      width - 28,
      height - 28,
      12,
      this.colorToRgba(palette.trim, 0.22),
      1,
    );

    ctx.fillStyle = this.colorToRgba(palette.panel, 0.34);
    ctx.fillRect(18, 24, width - 36, 6);
    ctx.fillRect(18, height - 30, width - 36, 6);
    ctx.fillStyle = this.colorToRgba(palette.accent, 0.08);
    ctx.fillRect(24, 28, Math.min(140, width - 120), 1);
    ctx.fillStyle = this.colorToRgba(palette.warm, 0.08);
    ctx.fillRect(Math.max(28, width - 124), 26, 76, 1);

    const corridor = ctx.createLinearGradient(0, corridorTop, 0, corridorTop + corridorHeight);
    corridor.addColorStop(0, this.colorToRgba(0x233344, 0.56));
    corridor.addColorStop(0.48, this.colorToRgba(0x15202b, 0.72));
    corridor.addColorStop(1, this.colorToRgba(0x0f1620, 0.72));
    this.fillRoundedRectCanvas(ctx, corridorX, corridorTop, corridorWidth, corridorHeight, 10, corridor);
    this.strokeRoundedRectCanvas(
      ctx,
      corridorX,
      corridorTop,
      corridorWidth,
      corridorHeight,
      10,
      this.colorToRgba(palette.trim, 0.18),
      1,
    );
    this.fillRoundedRectCanvas(
      ctx,
      corridorX + 14,
      corridorTop + 8,
      corridorWidth - 28,
      corridorHeight - 16,
      7,
      this.colorToRgba(0x0b1118, 0.2),
    );
    ctx.fillStyle = this.colorToRgba(palette.accent, 0.08);
    ctx.fillRect(corridorX + 16, corridorTop + 6, corridorWidth - 32, 1);
    ctx.fillStyle = this.colorToRgba(palette.warm, 0.05);
    ctx.fillRect(corridorX + 18, corridorTop + corridorHeight - 7, corridorWidth - 36, 1);

    const drawPlateField = (startY: number, endY: number): void => {
      let row = 0;
      for (let y = startY; y < endY; y += 32) {
        const offset = row % 2 === 0 ? 18 : 52;
        for (let x = offset; x < width - 28; x += 108) {
          const maxWidth = width - x - 22;
          const plateWidth = Math.min(maxWidth, 56 + ((row + Math.floor(x / 18)) % 3) * 16);
          const plateHeight = Math.min(endY - y - 4, 18 + ((row + Math.floor(x / 30)) % 2) * 6);
          if (plateWidth < 24 || plateHeight < 12) {
            continue;
          }
          this.fillRoundedRectCanvas(
            ctx,
            x,
            y,
            plateWidth,
            plateHeight,
            5,
            this.colorToRgba(palette.panel, 0.16),
          );
          this.strokeRoundedRectCanvas(
            ctx,
            x,
            y,
            plateWidth,
            plateHeight,
            5,
            this.colorToRgba(palette.trim, 0.12),
            1,
          );
          if ((row + Math.floor(x / 20)) % 2 === 0) {
            ctx.fillStyle = this.colorToRgba(palette.accent, 0.05);
            ctx.fillRect(x + 8, y + 6, Math.max(10, plateWidth - 16), 1);
          }
        }
        row += 1;
      }
    };

    drawPlateField(26, corridorTop - 8);
    drawPlateField(corridorTop + corridorHeight + 10, height - 30);

    ctx.strokeStyle = this.colorToRgba(0xb9c8d6, 0.045);
    ctx.lineWidth = 1;
    for (let x = 28; x <= width - 60; x += 88) {
      const y = corridorTop + 11 + ((Math.floor(x / 22) % 3) - 1) * 4;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + 26, y + 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x + 12, y + corridorHeight - 10);
      ctx.lineTo(x + 36, y + corridorHeight - 12);
      ctx.stroke();
    }

    const vents = [
      { x: 26, y: height - 48, width: 42, height: 14 },
      { x: width - 84, y: 120, width: 42, height: 16 },
    ] as const;
    for (const vent of vents) {
      this.strokeRoundedRectCanvas(
        ctx,
        vent.x,
        vent.y,
        vent.width,
        vent.height,
        4,
        this.colorToRgba(palette.trim, 0.22),
        1,
      );
      ctx.strokeStyle = this.colorToRgba(palette.trim, 0.18);
      ctx.lineWidth = 1;
      for (let x = vent.x + 8; x <= vent.x + vent.width - 8; x += 6) {
        ctx.beginPath();
        ctx.moveTo(x, vent.y + 4);
        ctx.lineTo(x, vent.y + vent.height - 4);
        ctx.stroke();
      }
    }

    for (const rect of room.wallRects) {
      const vertical = rect.height >= rect.width;
      const frameX = vertical ? rect.x - 8 : rect.x;
      const frameY = vertical ? rect.y : rect.y - 8;
      const frameWidth = vertical ? rect.width + 16 : rect.width;
      const frameHeight = vertical ? rect.height : rect.height + 16;
      const bulkhead = ctx.createLinearGradient(frameX, frameY, frameX + frameWidth, frameY + frameHeight);
      bulkhead.addColorStop(0, this.colorToRgba(0x111922, 0.42));
      bulkhead.addColorStop(1, this.colorToRgba(0x0b1016, 0.7));
      this.fillRoundedRectCanvas(ctx, frameX, frameY, frameWidth, frameHeight, 8, bulkhead);
      this.strokeRoundedRectCanvas(
        ctx,
        frameX,
        frameY,
        frameWidth,
        frameHeight,
        8,
        this.colorToRgba(palette.trim, 0.18),
        1,
      );
      ctx.fillStyle = this.colorToRgba(palette.accent, 0.05);
      if (vertical) {
        ctx.fillRect(frameX + 4, frameY + 10, 1, frameHeight - 20);
        ctx.fillRect(frameX + frameWidth - 5, frameY + 10, 1, frameHeight - 20);
      } else {
        ctx.fillRect(frameX + 10, frameY + 4, frameWidth - 20, 1);
        ctx.fillRect(frameX + 10, frameY + frameHeight - 5, frameWidth - 20, 1);
      }
    }

    for (const door of room.doors) {
      const bayX = door.rect.x - 12;
      const bayY = door.rect.y - 14;
      const bayWidth = door.rect.width + 24;
      const bayHeight = door.rect.height + 28;
      const bay = ctx.createLinearGradient(0, bayY, 0, bayY + bayHeight);
      bay.addColorStop(0, this.colorToRgba(palette.panel, 0.3));
      bay.addColorStop(1, this.colorToRgba(0x0b1016, 0.16));
      this.fillRoundedRectCanvas(ctx, bayX, bayY, bayWidth, bayHeight, 8, bay);
      this.strokeRoundedRectCanvas(
        ctx,
        bayX,
        bayY,
        bayWidth,
        bayHeight,
        8,
        this.colorToRgba(palette.trim, 0.22),
        1,
      );
      drawEllipse(
        door.rect.x + door.rect.width / 2,
        door.rect.y + door.rect.height / 2,
        door.rect.width * 1.6,
        16,
        this.colorToRgba(palette.accentSoft, 0.1),
      );
      ctx.fillStyle = this.colorToRgba(palette.warm, 0.18);
      ctx.fillRect(door.rect.x + 4, door.rect.y + 8, Math.max(10, door.rect.width - 8), 2);
      ctx.strokeStyle = this.colorToRgba(palette.warm, 0.14);
      ctx.lineWidth = 1;
      for (let y = door.rect.y + 10; y <= door.rect.y + door.rect.height - 8; y += 6) {
        ctx.beginPath();
        ctx.moveTo(door.rect.x - 2, y);
        ctx.lineTo(door.rect.x + 3, y + 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(door.rect.x + door.rect.width - 3, y + 2);
        ctx.lineTo(door.rect.x + door.rect.width + 2, y);
        ctx.stroke();
      }
    }

    if (room.terminal) {
      drawWorkPad(room.terminal.body, palette.accent, 0.24, 0.24, 10);
      const conduitX = room.terminal.body.x + room.terminal.body.width + 10;
      ctx.strokeStyle = this.colorToRgba(palette.trim, 0.2);
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(room.terminal.body.x + room.terminal.body.width, room.terminal.body.y + 16);
      ctx.lineTo(conduitX, room.terminal.body.y + 16);
      ctx.lineTo(conduitX, room.terminal.body.y + room.terminal.body.height - 10);
      ctx.stroke();
      ctx.strokeStyle = this.colorToRgba(palette.utility, 0.12);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(room.terminal.body.x + 10, room.terminal.body.y + room.terminal.body.height + 10);
      ctx.lineTo(room.terminal.body.x + room.terminal.body.width - 10, room.terminal.body.y + room.terminal.body.height + 10);
      ctx.stroke();

      for (const slot of room.terminal.slots) {
        const slotAccent =
          slot.id === "fault-slot"
            ? 0xef5d63
            : slot.id === "service-tray"
              ? palette.warm
              : palette.accent;
        this.strokeRoundedRectCanvas(
          ctx,
          slot.rect.x - 3,
          slot.rect.y - 3,
          slot.rect.width + 6,
          slot.rect.height + 6,
          4,
          this.colorToRgba(slotAccent, 0.18),
          1,
        );
        ctx.fillStyle = this.colorToRgba(slotAccent, 0.08);
        ctx.fillRect(slot.rect.x + 2, slot.rect.y + slot.rect.height + 4, slot.rect.width - 4, 1);
      }
    }

    for (const consoleDef of room.consoles ?? []) {
      drawWorkPad(consoleDef.rect, palette.utility, 0.22, 0.2, 8);
      ctx.strokeStyle = this.colorToRgba(palette.utility, 0.12);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(consoleDef.rect.x + consoleDef.rect.width / 2, consoleDef.rect.y - 8);
      ctx.lineTo(consoleDef.rect.x + consoleDef.rect.width / 2, consoleDef.rect.y + consoleDef.rect.height + 8);
      ctx.stroke();
    }

    for (const waitingZone of room.waitingZones ?? []) {
      drawWorkPad(waitingZone.rect, palette.accent, 0.14, 0.16, 8);
      ctx.strokeStyle = this.colorToRgba(palette.accent, 0.16);
      ctx.lineWidth = 1;
      for (let x = waitingZone.rect.x + 8; x <= waitingZone.rect.x + waitingZone.rect.width - 10; x += 10) {
        ctx.beginPath();
        ctx.moveTo(x, waitingZone.rect.y + waitingZone.rect.height / 2);
        ctx.lineTo(x + 4, waitingZone.rect.y + waitingZone.rect.height / 2);
        ctx.stroke();
      }
    }

    for (const zone of room.signalZones) {
      drawWorkPad(zone.rect, palette.utility, 0.16, 0.18, 10);
      ctx.strokeStyle = this.colorToRgba(palette.utility, 0.18);
      ctx.lineWidth = 1;
      for (let x = zone.rect.x + 8; x <= zone.rect.x + zone.rect.width - 8; x += 8) {
        ctx.beginPath();
        ctx.moveTo(x, zone.rect.y + 6);
        ctx.lineTo(x, zone.rect.y + zone.rect.height - 6);
        ctx.stroke();
      }
    }

    for (const resident of room.residents) {
      drawEllipse(
        resident.servicePoint.x,
        resident.servicePoint.y,
        20,
        12,
        this.colorToRgba(palette.warm, 0.08),
      );
      ctx.strokeStyle = this.colorToRgba(palette.warm, 0.18);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(resident.servicePoint.x, resident.servicePoint.y, 11, 0, Math.PI * 2);
      ctx.stroke();
    }

    for (const staff of room.staff ?? []) {
      drawEllipse(
        staff.deskPoint.x,
        staff.deskPoint.y,
        18,
        10,
        this.colorToRgba(palette.accentSoft, 0.08),
      );
      ctx.strokeStyle = this.colorToRgba(palette.trim, 0.16);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(staff.deskPoint.x - 18, staff.deskPoint.y + 12);
      ctx.lineTo(staff.deskPoint.x + 18, staff.deskPoint.y + 12);
      ctx.stroke();
    }

    for (const item of room.items) {
      this.fillRoundedRectCanvas(
        ctx,
        item.position.x - 10,
        item.position.y + 4,
        22,
        8,
        4,
        this.colorToRgba(0x101821, 0.32),
      );
    }
  }

  private createPlayer(): void {
    this.playerShadow = this.add.ellipse(36, 187, 16, 6, 0x04070b, 0.26);
    this.playerShadow.setDepth(19.4);
    this.player = this.physics.add.image(36, 180, "player-chip");
    this.player.setDisplaySize(12, 16);
    this.player.setDepth(19.8);
    this.player.setAlpha(0.001);
    this.player.setDrag(900, 900);
    this.player.setMaxVelocity(NORMAL_SPEED_LIMIT, NORMAL_SPEED_LIMIT);
    this.player.setCollideWorldBounds(true);
    const body = this.player.body as Phaser.Physics.Arcade.Body;
    body.setSize(8, 10);
    body.setOffset(4, 11);

    this.playerVisual = this.add.graphics();
    this.playerVisual.setDepth(20);
    this.syncPlayerShadow(0);

    this.indicateRing = this.add.circle(0, 0, 10);
    this.indicateRing.setDepth(19);
    this.indicateRing.setStrokeStyle(2, 0x85ecff, 0.9);
    this.indicateRing.setVisible(false);
  }

  private createForeground(): void {
    this.guideGraphics = this.add.graphics();
    this.guideGraphics.setDepth(2);
    this.roomTitle = this.add.text(12, 12, "", {
      fontFamily: "Avenir Next, PingFang SC, Noto Sans SC, sans-serif",
      fontSize: "14px",
      fontStyle: "600",
      color: "#eef4ff",
      stroke: "#091018",
      strokeThickness: 2,
      resolution: CAMERA_ZOOM,
    });
    this.roomTitle.setDepth(10);
    this.roomTitle.setScrollFactor(0);
    this.roomTitle.setShadow(0, 2, "#04070b", 1, false, true);
  }

  private setWorldFrame(width: number, height: number, mode: ScenePhase): void {
    this.physics.world.setBounds(0, 0, width, height);
    this.cameras.main.setBounds(0, 0, width, height);
    this.drawBackdrop(mode, width, height);
  }

  private loadPrelude(): void {
    this.clearRoomObjects();
    this.clearPreludeObjects();
    this.phase = "prelude";
    this.preludeActive = false;
    this.preludeCompanionSpoken = false;
    this.preludeGateUnlocked = false;
    this.preludeHint =
      "先和同伴交接，再进外门。";
    this.carriedItemId = null;
    this.indicateChargeMs = 0;
    this.indicateZoneId = null;

    this.setWorldFrame(PRELUDE_WIDTH, DEFAULT_ROOM_HEIGHT, "prelude");
    this.player.setPosition(64, 166);
    this.player.setVelocity(0, 0);
    this.syncPlayerShadow(0);
    this.roomTitle.setText("设施外 / 入口坡道");
    this.createPreludeSceneTexture();
    const sceneArt = this.add.image(
      PRELUDE_WIDTH / 2,
      DEFAULT_ROOM_HEIGHT / 2,
      PRELUDE_SCENE_TEXTURE_KEY,
    );
    sceneArt.setDisplaySize(PRELUDE_WIDTH, DEFAULT_ROOM_HEIGHT);
    sceneArt.setDepth(1.8);

    const companionShadow = this.add.ellipse(132, 173, 18, 6, 0x05070b, 0.28);
    companionShadow.setDepth(10.5);
    const companionSprite = this.add.image(132, 164, "companion-chip");
    companionSprite.setDisplaySize(12, 16);
    companionSprite.setDepth(11);
    const companionMarker = this.add.circle(132, 149, 2.5, 0xf6d08e, 0.9);
    companionMarker.setDepth(11.1);
    const companionLabel = this.add.text(116, 178, "同伴", {
      fontFamily: "Avenir Next, PingFang SC, Noto Sans SC, sans-serif",
      fontSize: "8px",
      color: "#f4d7b2",
      resolution: CAMERA_ZOOM,
    });
    companionLabel.setDepth(11.2);
    this.decorateLabel(companionLabel);
    const companionPrompt = this.add.text(74, 124, "按 E 交接", {
      fontFamily: "Avenir Next, PingFang SC, Noto Sans SC, sans-serif",
      fontSize: "9px",
      color: "#f8e8d2",
      resolution: CAMERA_ZOOM,
      wordWrap: { width: 100 },
    });
    companionPrompt.setDepth(11.3);
    this.decorateLabel(companionPrompt);
    this.preludeCompanionPrompt = companionPrompt;
    const brief = this.add.text(24, 28, "进去前，先从同伴手里接过最后一件东西。", {
      fontFamily: "Avenir Next, PingFang SC, Noto Sans SC, sans-serif",
      fontSize: "10px",
      color: "#d6e4f1",
      resolution: CAMERA_ZOOM,
      wordWrap: { width: 180 },
    });
    brief.setDepth(4.1);
    this.decorateLabel(brief);

    const facilitySign = this.add.text(468, 50, "低歧义设施", {
      fontFamily: "Avenir Next, PingFang SC, Noto Sans SC, sans-serif",
      fontSize: "12px",
      fontStyle: "600",
      color: "#d6e4f1",
      resolution: CAMERA_ZOOM,
    });
    facilitySign.setDepth(4);
    this.decorateLabel(facilitySign);

    this.preludeObjects.push(
      sceneArt,
      companionShadow,
      companionSprite,
      companionMarker,
      companionLabel,
      companionPrompt,
      brief,
      facilitySign,
    );
    this.createPreludeGate();
  }

  private createPreludeGate(): void {
    this.ensurePreludeGateTextures();
    const portal = PRELUDE_GATE_PORTAL_RECT;
    const blockerRect = PRELUDE_GATE_BLOCKER_RECT;
    const art = this.add.image(
      portal.x + portal.width / 2 + 1,
      portal.y + portal.height / 2 + 1,
      this.preludeGateUnlocked ? "prelude-gate-open" : "prelude-gate-locked",
    );
    art.setDisplaySize(PRELUDE_GATE_ART_WIDTH, PRELUDE_GATE_ART_HEIGHT);
    art.setDepth(7.05);

    const blocker = this.add.rectangle(
      blockerRect.x + blockerRect.width / 2,
      blockerRect.y + blockerRect.height / 2,
      blockerRect.width,
      blockerRect.height,
      0xffffff,
      0.001,
    );
    blocker.setDepth(6.95);
    this.physics.add.existing(blocker, true);
    const blockerBody = blocker.body as Phaser.Physics.Arcade.StaticBody;
    this.preludeColliders.push(this.physics.add.collider(this.player, blocker));

    this.preludeObjects.push(art, blocker);
    this.preludeGate = {
      blocker,
      body: blockerBody,
      art,
    };
  }

  private ensurePreludeGateTextures(): void {
    this.createPreludeGateTexture("prelude-gate-locked", false);
    this.createPreludeGateTexture("prelude-gate-open", true);
  }

  private createPreludeGateTexture(key: string, unlocked: boolean): void {
    if (this.textures.exists(key)) {
      this.textures.remove(key);
    }

    const canvasWidth = PRELUDE_GATE_ART_WIDTH * PRELUDE_GATE_TEXTURE_SCALE;
    const canvasHeight = PRELUDE_GATE_ART_HEIGHT * PRELUDE_GATE_TEXTURE_SCALE;
    const texture = this.textures.createCanvas(key, canvasWidth, canvasHeight);
    if (!texture) {
      throw new Error(`无法创建前奏门禁纹理：${key}`);
    }
    const ctx = texture.context;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);
    ctx.imageSmoothingEnabled = true;
    ctx.scale(PRELUDE_GATE_TEXTURE_SCALE, PRELUDE_GATE_TEXTURE_SCALE);
    this.drawPreludeGateTexture(
      ctx,
      PRELUDE_GATE_ART_WIDTH,
      PRELUDE_GATE_ART_HEIGHT,
      unlocked,
    );
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    texture.refresh();
  }

  private drawPreludeGateTexture(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    unlocked: boolean,
  ): void {
    const accent = unlocked ? 0x8ff0a4 : 0xf0c562;
    const accentSoft = unlocked ? 0x67d68d : 0xc39a49;
    const glow = ctx.createRadialGradient(width * 0.5, 34, 8, width * 0.5, 34, 66);
    glow.addColorStop(0, this.colorToRgba(accent, unlocked ? 0.16 : 0.1));
    glow.addColorStop(1, this.colorToRgba(accent, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(12, 0, width - 24, 84);

    const shadow = ctx.createLinearGradient(0, 0, 0, height);
    shadow.addColorStop(0, this.colorToRgba(0x04070b, 0));
    shadow.addColorStop(1, this.colorToRgba(0x04070b, 0.34));
    this.fillRoundedRectCanvas(ctx, 20, 10, 114, 132, 20, shadow);
    this.fillRoundedRectCanvas(ctx, 14, 6, 124, 138, 24, this.colorToRgba(0x04070b, 0.24));

    const shell = ctx.createLinearGradient(18, 8, 136, 146);
    shell.addColorStop(0, "#243647");
    shell.addColorStop(0.4, "#111b24");
    shell.addColorStop(1, "#0b1218");
    this.fillRoundedRectCanvas(ctx, 18, 8, 116, 132, 22, shell);
    this.strokeRoundedRectCanvas(ctx, 18, 8, 116, 132, 22, this.colorToRgba(0x435e76, 0.78), 3);

    const innerFrame = ctx.createLinearGradient(24, 18, 128, 138);
    innerFrame.addColorStop(0, "#101821");
    innerFrame.addColorStop(1, "#16222d");
    this.fillRoundedRectCanvas(ctx, 28, 18, 96, 112, 16, innerFrame);
    this.strokeRoundedRectCanvas(ctx, 28, 18, 96, 112, 16, this.colorToRgba(0x2d4154, 0.6), 2);

    const lintel = ctx.createLinearGradient(0, 18, 0, 32);
    lintel.addColorStop(0, "#3a4c5d");
    lintel.addColorStop(1, "#121c25");
    this.fillRoundedRectCanvas(ctx, 40, 16, 72, 12, 6, lintel);
    this.fillRoundedRectCanvas(
      ctx,
      44,
      19,
      64,
      2,
      1,
      this.colorToRgba(accent, unlocked ? 0.36 : 0.22),
    );

    const cavity = ctx.createLinearGradient(0, 28, 0, 126);
    cavity.addColorStop(0, "#0a1118");
    cavity.addColorStop(1, "#101922");
    this.fillRoundedRectCanvas(ctx, 44, 30, 42, 82, 9, cavity);
    this.strokeRoundedRectCanvas(ctx, 44, 30, 42, 82, 9, this.colorToRgba(0x293c4d, 0.54), 1.5);

    const doorSkin = ctx.createLinearGradient(48, 30, 84, 112);
    doorSkin.addColorStop(0, "#344a5b");
    doorSkin.addColorStop(0.45, "#1e2e3b");
    doorSkin.addColorStop(1, "#101922");
    this.fillRoundedRectCanvas(ctx, 48, 32, 34, 78, 7, doorSkin);
    this.strokeRoundedRectCanvas(ctx, 48, 32, 34, 78, 7, this.colorToRgba(0x60798c, 0.46), 1.5);
    this.fillRoundedRectCanvas(ctx, 51, 36, 4, 70, 4, this.colorToRgba(0xe7f8ff, 0.06));
    this.fillRoundedRectCanvas(ctx, 75, 38, 2, 64, 2, this.colorToRgba(0x0a1118, 0.42));

    const slitGlow = ctx.createLinearGradient(0, 38, 0, 104);
    slitGlow.addColorStop(0, this.colorToRgba(accent, unlocked ? 0.78 : 0.32));
    slitGlow.addColorStop(0.5, this.colorToRgba(accentSoft, unlocked ? 0.54 : 0.18));
    slitGlow.addColorStop(1, this.colorToRgba(accent, unlocked ? 0.66 : 0.24));
    this.fillRoundedRectCanvas(ctx, 60, 38, 10, 66, 5, slitGlow);
    this.fillRoundedRectCanvas(ctx, 63, 41, 4, 60, 3, this.colorToRgba(0xf4fffd, unlocked ? 0.22 : 0.12));
    this.strokeRoundedRectCanvas(ctx, 59, 37, 12, 68, 6, this.colorToRgba(accent, unlocked ? 0.56 : 0.28), 1);

    const reader = ctx.createLinearGradient(90, 34, 114, 92);
    reader.addColorStop(0, "#283643");
    reader.addColorStop(1, "#141f28");
    this.fillRoundedRectCanvas(ctx, 90, 42, 18, 54, 6, reader);
    this.strokeRoundedRectCanvas(ctx, 90, 42, 18, 54, 6, this.colorToRgba(0x50687b, 0.56), 1.5);
    this.fillRoundedRectCanvas(ctx, 94, 48, 10, 11, 2, "#091018");
    this.strokeRoundedRectCanvas(ctx, 94, 48, 10, 11, 2, this.colorToRgba(0x44637a, 0.42), 1);
    this.fillRoundedRectCanvas(
      ctx,
      95,
      49,
      8,
      3,
      1,
      this.colorToRgba(accent, unlocked ? 0.74 : 0.2),
    );
    this.fillRoundedRectCanvas(ctx, 95, 64, 8, 5, 2, this.colorToRgba(accent, unlocked ? 0.84 : 0.38));
    this.fillRoundedRectCanvas(ctx, 95, 74, 8, 8, 4, this.colorToRgba(0x7edca2, unlocked ? 0.3 : 0.12));
    ctx.fillStyle = this.colorToRgba(0x8ea8bc, 0.24);
    for (let y = 56; y <= 60; y += 2) {
      ctx.fillRect(95, y, 8, 1);
    }

    const statusBar = ctx.createLinearGradient(0, 0, 40, 0);
    statusBar.addColorStop(0, "#101922");
    statusBar.addColorStop(1, "#1f2d39");
    this.fillRoundedRectCanvas(ctx, 44, 22, 38, 10, 4, statusBar);
    this.fillRoundedRectCanvas(
      ctx,
      46,
      24,
      14,
      2,
      1,
      this.colorToRgba(accent, unlocked ? 0.46 : 0.18),
    );
    ctx.fillStyle = this.colorToRgba(0x8ea8bc, 0.4);
    ctx.fillRect(64, 24, 2, 2);
    ctx.fillRect(69, 24, 2, 2);

    this.fillRoundedRectCanvas(ctx, 34, 118, 84, 14, 4, this.colorToRgba(0x1d2a35, 0.94));
    this.strokeRoundedRectCanvas(ctx, 34, 118, 84, 14, 4, this.colorToRgba(0x425a70, 0.42), 1);
    for (let x = 46; x <= 98; x += 10) {
      ctx.strokeStyle = this.colorToRgba(accent, 0.16);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, 132);
      ctx.lineTo(x + 5, 120);
      ctx.stroke();
    }

    ctx.fillStyle = this.colorToRgba(0x6b8192, 0.74);
    for (const point of [
      [38, 24],
      [114, 24],
      [38, 124],
      [114, 124],
      [96, 32],
      [96, 116],
    ] as const) {
      ctx.beginPath();
      ctx.arc(point[0], point[1], 2, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.strokeStyle = this.colorToRgba(0xa9bbca, 0.1);
    ctx.lineWidth = 1;
    for (const streak of [
      [54, 40, 58, 70],
      [66, 58, 72, 92],
      [46, 20, 42, 40],
      [103, 44, 101, 72],
    ] as const) {
      ctx.beginPath();
      ctx.moveTo(streak[0], streak[1]);
      ctx.lineTo(streak[2], streak[3]);
      ctx.stroke();
    }

    ctx.strokeStyle = this.colorToRgba(0x0d141b, 0.24);
    for (let x = 28; x <= 112; x += 14) {
      ctx.beginPath();
      ctx.moveTo(x, 26);
      ctx.lineTo(x - 6, 118);
      ctx.stroke();
    }

    ctx.font = '600 8px "PingFang SC", "Noto Sans SC", sans-serif';
    ctx.textAlign = "center";
    ctx.fillStyle = this.colorToRgba(unlocked ? 0xb5ffc5 : 0xd9d2bf, 0.84);
    ctx.fillText("外部门禁", width / 2, 48);

    ctx.font = '600 6px "Avenir Next", "Noto Sans", sans-serif';
    ctx.fillStyle = this.colorToRgba(accent, unlocked ? 0.64 : 0.24);
    ctx.fillText(unlocked ? "ACCESS GRANTED" : "VERIFYING", width / 2, 58);
  }

  private fillRoundedRectCanvas(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number,
    fillStyle: string | CanvasGradient,
  ): void {
    ctx.beginPath();
    this.traceRoundedRectCanvas(ctx, x, y, width, height, radius);
    ctx.fillStyle = fillStyle;
    ctx.fill();
  }

  private strokeRoundedRectCanvas(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number,
    strokeStyle: string,
    lineWidth: number,
  ): void {
    ctx.beginPath();
    this.traceRoundedRectCanvas(ctx, x, y, width, height, radius);
    ctx.strokeStyle = strokeStyle;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }

  private traceRoundedRectCanvas(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number,
  ): void {
    const clampedRadius = Math.min(radius, width / 2, height / 2);
    ctx.moveTo(x + clampedRadius, y);
    ctx.arcTo(x + width, y, x + width, y + height, clampedRadius);
    ctx.arcTo(x + width, y + height, x, y + height, clampedRadius);
    ctx.arcTo(x, y + height, x, y, clampedRadius);
    ctx.arcTo(x, y, x + width, y, clampedRadius);
    ctx.closePath();
  }

  private colorToRgba(color: number, alpha: number): string {
    const rgb = Phaser.Display.Color.IntegerToRGB(color);
    return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
  }

  private createWallBlock(rect: Rect): Phaser.GameObjects.Rectangle {
    this.addShadowRect(rect, 5.5, 10, 8, 3, 0.42);
    const shape = this.add.rectangle(
      rect.x + rect.width / 2,
      rect.y + rect.height / 2,
      rect.width,
      rect.height,
      0x1d2734,
    );
    shape.setStrokeStyle(2, 0x42526b, 1);
    shape.setDepth(6);
    const core = this.add.rectangle(
      rect.x + rect.width / 2,
      rect.y + rect.height / 2,
      Math.max(4, rect.width - 6),
      Math.max(4, rect.height - 6),
      0x263242,
      0.88,
    );
    core.setDepth(6.05);
    const trim = this.add.graphics();
    trim.setDepth(6.1);
    trim.lineStyle(1, 0x7d8fa5, 0.18);
    if (rect.height >= rect.width) {
      trim.lineBetween(rect.x + 4, rect.y + 8, rect.x + 4, rect.y + rect.height - 8);
      trim.lineBetween(
        rect.x + rect.width - 4,
        rect.y + 8,
        rect.x + rect.width - 4,
        rect.y + rect.height - 8,
      );
    } else {
      trim.lineBetween(rect.x + 8, rect.y + 4, rect.x + rect.width - 8, rect.y + 4);
      trim.lineBetween(
        rect.x + 8,
        rect.y + rect.height - 4,
        rect.x + rect.width - 8,
        rect.y + rect.height - 4,
      );
    }
    const bolts = this.add.graphics();
    bolts.setDepth(6.12);
    bolts.fillStyle(0x8ea0b4, 0.3);
    const boltPoints =
      rect.height >= rect.width
        ? [
            [rect.x + rect.width / 2, rect.y + 10],
            [rect.x + rect.width / 2, rect.y + rect.height - 10],
          ]
        : [
            [rect.x + 10, rect.y + rect.height / 2],
            [rect.x + rect.width - 10, rect.y + rect.height / 2],
          ];
    boltPoints.forEach(([x, y]) => bolts.fillCircle(x, y, 1.2));
    this.roomObjects.push(shape, core, trim, bolts);
    return shape;
  }

  private createDoorBlock(rect: Rect): Phaser.GameObjects.Rectangle {
    this.addShadowRect(rect, 6.55, 10, 10, 3, 0.45);
    const frame = this.add.rectangle(
      rect.x + rect.width / 2,
      rect.y + rect.height / 2,
      rect.width + 6,
      rect.height + 6,
      0x1a212d,
      0.9,
    );
    frame.setStrokeStyle(1, 0x304055, 0.95);
    frame.setDepth(6.85);
    const shape = this.add.rectangle(
      rect.x + rect.width / 2,
      rect.y + rect.height / 2,
      rect.width,
      rect.height,
      0x354251,
    );
    shape.setStrokeStyle(2, 0xefd36a, 0.5);
    shape.setDepth(7);
    const slit = this.add.rectangle(
      rect.x + rect.width / 2,
      rect.y + 8,
      Math.max(6, rect.width - 8),
      2,
      0xefcf69,
      0.28,
    );
    slit.setDepth(7.1);
    const core = this.add.rectangle(
      rect.x + rect.width / 2,
      rect.y + rect.height / 2,
      Math.max(4, rect.width - 8),
      Math.max(10, rect.height - 12),
      0x24303e,
      0.5,
    );
    core.setDepth(7.05);
    const accents = this.add.graphics();
    accents.setDepth(7.12);
    accents.lineStyle(1, 0xefcf69, 0.18);
    for (let y = rect.y + 7; y <= rect.y + rect.height - 7; y += 6) {
      accents.lineBetween(rect.x - 2, y, rect.x + 3, y + 2);
      accents.lineBetween(rect.x + rect.width - 3, y + 2, rect.x + rect.width + 2, y);
    }
    accents.fillStyle(0xefcf69, 0.52);
    accents.fillCircle(rect.x + rect.width - 4, rect.y + 6, 1.6);
    this.roomObjects.push(frame, shape, core, slit, accents);
    return shape;
  }

  private createTerminalBody(rect: Rect): Phaser.GameObjects.Rectangle {
    this.addShadowRect(rect, 4.7, 12, 10, 3, 0.4);
    const body = this.add.rectangle(
      rect.x + rect.width / 2,
      rect.y + rect.height / 2,
      rect.width,
      rect.height,
      0x202733,
    );
    body.setStrokeStyle(2, 0x64748b, 0.95);
    body.setDepth(5);
    const inner = this.add.rectangle(
      rect.x + rect.width / 2,
      rect.y + rect.height / 2,
      Math.max(8, rect.width - 8),
      Math.max(8, rect.height - 8),
      0x273342,
      0.88,
    );
    inner.setDepth(5.05);
    const header = this.add.rectangle(
      rect.x + rect.width / 2,
      rect.y + 10,
      Math.max(12, rect.width - 12),
      8,
      0x33465b,
      0.9,
    );
    header.setDepth(5.1);
    const scan = this.add.graphics();
    scan.setDepth(5.12);
    scan.lineStyle(1, 0xffffff, 0.04);
    for (let y = rect.y + 20; y < rect.y + rect.height - 8; y += 8) {
      scan.lineBetween(rect.x + 7, y, rect.x + rect.width - 7, y);
    }
    const display = this.add.rectangle(
      rect.x + rect.width - 16,
      rect.y + 10,
      12,
      4,
      0x84ecff,
      0.32,
    );
    display.setDepth(5.14);
    const vent = this.add.graphics();
    vent.setDepth(5.13);
    vent.lineStyle(1, 0x90a1b5, 0.16);
    for (let x = rect.x + 10; x < rect.x + rect.width - 10; x += 8) {
      vent.lineBetween(x, rect.y + rect.height - 12, x + 4, rect.y + rect.height - 12);
    }
    const ports = this.add.graphics();
    ports.setDepth(5.15);
    ports.fillStyle(0x5a6a7e, 0.34);
    ports.fillCircle(rect.x + 10, rect.y + rect.height - 10, 1.2);
    ports.fillCircle(rect.x + 16, rect.y + rect.height - 10, 1.2);
    this.roomObjects.push(body, inner, header, scan, display, vent, ports);
    return body;
  }

  private createSlotBlock(rect: Rect, accent: number): Phaser.GameObjects.Rectangle {
    this.addShadowRect(rect, 5.7, 6, 6, 2, 0.34);
    const shape = this.add.rectangle(
      rect.x + rect.width / 2,
      rect.y + rect.height / 2,
      rect.width,
      rect.height,
      0x131b26,
    );
    shape.setStrokeStyle(1.5, accent, 0.95);
    shape.setDepth(6);
    const inner = this.add.rectangle(
      rect.x + rect.width / 2,
      rect.y + rect.height / 2,
      Math.max(4, rect.width - 6),
      Math.max(4, rect.height - 6),
      0x1d2735,
      0.9,
    );
    inner.setDepth(6.05);
    const indicator = this.add.rectangle(
      rect.x + rect.width / 2,
      rect.y + 3,
      Math.max(4, rect.width - 8),
      2,
      accent,
      0.22,
    );
    indicator.setDepth(6.1);
    this.roomObjects.push(shape, inner, indicator);
    return shape;
  }

  private createConsoleBlock(rect: Rect): Phaser.GameObjects.Rectangle {
    this.addShadowRect(rect, 5.8, 8, 8, 2, 0.36);
    const shape = this.add.rectangle(
      rect.x + rect.width / 2,
      rect.y + rect.height / 2,
      rect.width,
      rect.height,
      0x423224,
    );
    shape.setStrokeStyle(1.5, 0xf3b65b, 0.95);
    shape.setDepth(6);
    const inner = this.add.rectangle(
      rect.x + rect.width / 2,
      rect.y + rect.height / 2,
      Math.max(4, rect.width - 6),
      Math.max(4, rect.height - 6),
      0x281c12,
      0.95,
    );
    inner.setDepth(6.05);
    const diode = this.add.circle(
      rect.x + rect.width / 2,
      rect.y + rect.height / 2,
      2,
      0xffd591,
      0.78,
    );
    diode.setDepth(6.1);
    const trim = this.add.graphics();
    trim.setDepth(6.12);
    trim.lineStyle(1, 0xf7c978, 0.2);
    trim.strokeRoundedRect(rect.x + 2, rect.y + 2, rect.width - 4, rect.height - 4, 3);
    trim.lineBetween(rect.x + 4, rect.y + rect.height - 4, rect.x + rect.width - 4, rect.y + rect.height - 4);
    this.roomObjects.push(shape, inner, diode, trim);
    return shape;
  }

  private createResidentServicePoint(point: { x: number; y: number }): void {
    const ring = this.add.circle(point.x, point.y, 12, 0xf1b562, 0.08);
    ring.setStrokeStyle(1.5, 0xf1b562, 0.52);
    ring.setDepth(3.2);
    const crosshair = this.add.graphics();
    crosshair.setDepth(3.25);
    crosshair.lineStyle(1, 0xf6d08e, 0.38);
    crosshair.strokeCircle(point.x, point.y, 6);
    crosshair.lineBetween(point.x - 8, point.y, point.x + 8, point.y);
    crosshair.lineBetween(point.x, point.y - 8, point.x, point.y + 8);
    this.roomObjects.push(ring, crosshair);
  }

  private createWaitingZone(zone: WaitingZone): void {
    const shape = this.add.rectangle(
      zone.rect.x + zone.rect.width / 2,
      zone.rect.y + zone.rect.height / 2,
      zone.rect.width,
      zone.rect.height,
      0x1a3f4f,
      0.16,
    );
    shape.setStrokeStyle(1.5, 0x6ecbe8, 0.6);
    shape.setDepth(3);
    const label = this.add.text(
      zone.rect.x + 2,
      zone.rect.y + zone.rect.height + 4,
      zone.label,
      {
        fontFamily: "Avenir Next, PingFang SC, Noto Sans SC, sans-serif",
        fontSize: "8px",
        color: "#90c4d8",
        resolution: CAMERA_ZOOM,
      },
    );
    label.setDepth(4);
    this.decorateLabel(label);
    this.roomObjects.push(shape, label);
    this.waitingZoneObjects.set(zone.id, { zone, shape, label });
  }

  private createSignalZone(id: string, rect: Rect): void {
    const shape = this.add.rectangle(
      rect.x + rect.width / 2,
      rect.y + rect.height / 2,
      rect.width,
      rect.height,
      0x13445a,
      0.18,
    );
    shape.setStrokeStyle(1.5, 0x6be0ff, 0.8);
    shape.setDepth(3);
    const overlay = this.add.graphics();
    overlay.setDepth(3.1);
    overlay.lineStyle(1, 0x9aecff, 0.18);
    for (let x = rect.x + 4; x < rect.x + rect.width; x += 10) {
      overlay.lineBetween(x, rect.y + rect.height, x + 8, rect.y);
    }
    overlay.lineStyle(2, 0x6be0ff, 0.45);
    overlay.lineBetween(rect.x, rect.y + 6, rect.x + 8, rect.y + 6);
    overlay.lineBetween(rect.x, rect.y + 6, rect.x, rect.y + 14);
    overlay.lineBetween(rect.x + rect.width - 8, rect.y + 6, rect.x + rect.width, rect.y + 6);
    overlay.lineBetween(rect.x + rect.width, rect.y + 6, rect.x + rect.width, rect.y + 14);
    overlay.lineBetween(rect.x, rect.y + rect.height - 6, rect.x + 8, rect.y + rect.height - 6);
    overlay.lineBetween(rect.x, rect.y + rect.height - 6, rect.x, rect.y + rect.height - 14);
    overlay.lineBetween(
      rect.x + rect.width - 8,
      rect.y + rect.height - 6,
      rect.x + rect.width,
      rect.y + rect.height - 6,
    );
    overlay.lineBetween(
      rect.x + rect.width,
      rect.y + rect.height - 6,
      rect.x + rect.width,
      rect.y + rect.height - 14,
    );
    const reticle = this.add.graphics();
    reticle.setDepth(3.15);
    reticle.lineStyle(1, 0x9aecff, 0.3);
    reticle.strokeCircle(rect.x + rect.width / 2, rect.y + rect.height / 2, 4);
    reticle.lineBetween(
      rect.x + rect.width / 2 - 6,
      rect.y + rect.height / 2,
      rect.x + rect.width / 2 + 6,
      rect.y + rect.height / 2,
    );
    this.roomObjects.push(shape, overlay, reticle);
    this.signalZoneObjects.set(id, {
      id,
      rect,
      shape,
      overlay,
      reticle,
    });
  }

  private addShadowRect(
    rect: Rect,
    depth: number,
    inflateX: number,
    inflateY: number,
    offsetY: number,
    alpha: number,
  ): Phaser.GameObjects.Rectangle {
    const shadow = this.add.rectangle(
      rect.x + rect.width / 2,
      rect.y + rect.height / 2 + offsetY,
      rect.width + inflateX,
      rect.height + inflateY,
      0x04070b,
      alpha,
    );
    shadow.setDepth(depth);
    this.roomObjects.push(shadow);
    return shadow;
  }

  private decorateLabel(label: Phaser.GameObjects.Text): void {
    label.setStroke("#081019", 2);
    label.setShadow(0, 1, "#04070b", 1, false, true);
  }

  private loadRoom(): void {
    this.clearRoomObjects();
    this.clearPreludeObjects();
    const snapshot = this.session.getSnapshot();
    this.phase = "facility";
    this.currentRoom = snapshot.room;
    this.roomRef = snapshot.runtime;
    this.carriedItemId = null;
    this.indicateChargeMs = 0;
    this.indicateZoneId = null;
    const dimensions = this.getRoomDimensions(snapshot.room);
    this.setWorldFrame(dimensions.width, dimensions.height, "facility");
    this.player.setPosition(snapshot.room.playerSpawn.x, snapshot.room.playerSpawn.y);
    this.player.setVelocity(0, 0);
    this.syncPlayerShadow(0);
    this.roomTitle.setText(snapshot.room.name);
    const sceneTextureKey = this.ensureFacilitySceneTexture(snapshot.room, dimensions);
    const sceneArt = this.add.image(dimensions.width / 2, dimensions.height / 2, sceneTextureKey);
    sceneArt.setDisplaySize(dimensions.width, dimensions.height);
    sceneArt.setDepth(1.8);
    this.roomObjects.push(sceneArt);

    for (const rect of snapshot.room.wallRects) {
      const shape = this.createWallBlock(rect);
      this.physics.add.existing(shape, true);
      const collider = this.physics.add.collider(this.player, shape);
      this.wallBodies.push(shape);
      this.wallColliders.push(collider);
    }

    for (const door of snapshot.room.doors) {
      const shape = this.createDoorBlock(door.rect);
      this.physics.add.existing(shape, true);
      const body = shape.body as Phaser.Physics.Arcade.StaticBody;
      this.wallColliders.push(this.physics.add.collider(this.player, shape));

      const label = this.add.text(door.rect.x - 6, door.rect.y - 16, door.label, {
        fontFamily: "Avenir Next, PingFang SC, Noto Sans SC, sans-serif",
        fontSize: "9px",
        fontStyle: "600",
        color: "#b8c6d4",
        resolution: CAMERA_ZOOM,
      });
      label.setDepth(8);
      this.decorateLabel(label);

      this.roomObjects.push(label);
      this.doorObjects.set(door.id, {
        def: door,
        shape,
        body,
        label,
        open: false,
        exitGraceMs: 0,
      });
    }

    if (snapshot.room.terminal) {
      const terminal = snapshot.room.terminal;
      this.createTerminalBody(terminal.body);
      const title = this.add.text(terminal.body.x + 6, terminal.body.y + 6, terminal.label, {
        fontFamily: "Avenir Next, PingFang SC, Noto Sans SC, sans-serif",
        fontSize: "9px",
        fontStyle: "600",
        color: "#d5deea",
        resolution: CAMERA_ZOOM,
      });
      title.setDepth(8);
      this.decorateLabel(title);
      this.roomObjects.push(title);

      for (const slot of terminal.slots) {
        const accent =
          slot.id === "fault-slot" ? 0xef5d63 : slot.id === "service-tray" ? 0xf1b562 : 0x63d8ff;
        const slotShape = this.createSlotBlock(slot.rect, accent);
        const label = this.add.text(slot.rect.x - 4, slot.rect.y + slot.rect.height + 4, slot.label, {
          fontFamily: "Avenir Next, PingFang SC, Noto Sans SC, sans-serif",
          fontSize: "8px",
          color: "#9fb1c2",
          resolution: CAMERA_ZOOM,
        });
        label.setDepth(8);
        this.decorateLabel(label);
        this.roomObjects.push(label);
        this.slotObjects.set(slot.id, { slot, shape: slotShape, label });
      }
    }

    if (snapshot.room.consoles) {
      for (const consoleDef of snapshot.room.consoles) {
        const shape = this.createConsoleBlock(consoleDef.rect);
        const label = this.add.text(
          consoleDef.rect.x - 10,
          consoleDef.rect.y + consoleDef.rect.height + 4,
          consoleDef.label,
          {
            fontFamily: "Avenir Next, PingFang SC, Noto Sans SC, sans-serif",
            fontSize: "8px",
            fontStyle: "600",
            color: "#f4c783",
            resolution: CAMERA_ZOOM,
          },
        );
        label.setDepth(8);
        this.decorateLabel(label);
        this.roomObjects.push(label);
        this.consoleObjects.set(consoleDef.id, {
          def: consoleDef,
          shape,
          label,
        });
      }
    }

    for (const item of snapshot.room.items) {
      const shadow = this.add.ellipse(item.position.x, item.position.y + 5, 14, 6, 0x05070b, 0.35);
      shadow.setDepth(11);
      const sprite = this.add.image(item.position.x, item.position.y, "battery-chip");
      sprite.setDepth(12);
      const label = this.add.text(item.position.x - 12, item.position.y + 12, item.label, {
        fontFamily: "Avenir Next, PingFang SC, Noto Sans SC, sans-serif",
        fontSize: "8px",
        color: "#f6deaa",
        resolution: CAMERA_ZOOM,
      });
      label.setDepth(12);
      this.decorateLabel(label);
      this.roomObjects.push(shadow, sprite, label);
      this.itemObjects.set(item.id, {
        id: item.id,
        shadow,
        sprite,
        label,
        slotId: null,
      });
    }

    for (const zone of snapshot.room.waitingZones ?? []) {
      this.createWaitingZone(zone);
    }

    for (const resident of snapshot.room.residents) {
      this.createResidentServicePoint(resident.servicePoint);
      const shadow = this.add.ellipse(
        resident.position.x,
        resident.position.y + 7,
        18,
        6,
        0x05070b,
        0.26,
      );
      shadow.setDepth(10.5);
      const serviceHalo = this.add.circle(
        resident.position.x,
        resident.position.y,
        12,
        0xf2be67,
        0.08,
      );
      serviceHalo.setStrokeStyle(1.5, 0xf2be67, 0.45);
      serviceHalo.setDepth(10.8);
      const sprite = this.add.image(
        resident.position.x,
        resident.position.y,
        "resident-chip",
      );
      sprite.setDisplaySize(12, 16);
      sprite.setDepth(11);
      const marker = this.add.circle(
        resident.position.x,
        resident.position.y - 13,
        2.5,
        0x9cf5ff,
        0.9,
      );
      marker.setDepth(11.1);
      const label = this.add.text(
        resident.position.x - 12,
        resident.position.y + 12,
        resident.label,
        {
          fontFamily: "Avenir Next, PingFang SC, Noto Sans SC, sans-serif",
          fontSize: "8px",
          color: "#cfe6f5",
          resolution: CAMERA_ZOOM,
        },
      );
      label.setDepth(11.2);
      this.decorateLabel(label);
      this.roomObjects.push(shadow, serviceHalo, sprite, marker, label);
      this.residentObjects.set(resident.id, {
        def: resident,
        marker,
        shadow,
        sprite,
        label,
        serviceHalo,
      });
    }

    for (const staff of snapshot.room.staff ?? []) {
      const shadow = this.add.ellipse(
        staff.position.x,
        staff.position.y + 7,
        18,
        6,
        0x05070b,
        0.24,
      );
      shadow.setDepth(10.5);
      const statusHalo = this.add.circle(
        staff.position.x,
        staff.position.y,
        12,
        0x73d4ff,
        0.06,
      );
      statusHalo.setStrokeStyle(1.5, 0x73d4ff, 0.4);
      statusHalo.setDepth(10.8);
      const sprite = this.add.image(staff.position.x, staff.position.y, "staff-chip");
      sprite.setDisplaySize(12, 16);
      sprite.setDepth(11);
      const marker = this.add.circle(
        staff.position.x,
        staff.position.y - 13,
        2.5,
        0xb8fff3,
        0.9,
      );
      marker.setDepth(11.1);
      const label = this.add.text(
        staff.position.x - 12,
        staff.position.y + 12,
        staff.label,
        {
          fontFamily: "Avenir Next, PingFang SC, Noto Sans SC, sans-serif",
          fontSize: "8px",
          color: "#d9f5ff",
          resolution: CAMERA_ZOOM,
        },
      );
      label.setDepth(11.2);
      this.decorateLabel(label);
      this.roomObjects.push(shadow, statusHalo, sprite, marker, label);
      this.staffObjects.set(staff.id, {
        def: staff,
        marker,
        shadow,
        sprite,
        label,
        statusHalo,
      });
    }

    for (const zone of snapshot.room.signalZones) {
      this.createSignalZone(zone.id, zone.rect);
    }

    snapshot.room.signage.forEach((text, index) => {
      const sign = this.add.text(18, 28 + index * 12, text, {
        fontFamily: "Avenir Next, PingFang SC, Noto Sans SC, sans-serif",
        fontSize: "9px",
        color: "#7e93aa",
        resolution: CAMERA_ZOOM,
      });
      sign.setDepth(4);
      this.decorateLabel(sign);
      this.roomObjects.push(sign);
    });

    for (const drone of snapshot.room.drones) {
      const shadow = this.add.ellipse(drone.position.x, drone.position.y + 6, 18, 8, 0x05070b, 0.34);
      shadow.setDepth(13);
      const sprite = this.add.image(drone.position.x, drone.position.y, "drone-chip");
      sprite.setDepth(14);
      const light = this.add.circle(drone.position.x, drone.position.y, 3, 0xffffff, 0.8);
      light.setDepth(15);
      const range = this.add.circle(
        drone.position.x,
        drone.position.y,
        drone.rule.visionRadius,
        0x6b7c93,
        0.05,
      );
      range.setStrokeStyle(1, 0x556474, 0.2);
      range.setDepth(1);
      const label = this.add.text(drone.position.x - 14, drone.position.y + 12, drone.label, {
        fontFamily: "Avenir Next, PingFang SC, Noto Sans SC, sans-serif",
        fontSize: "8px",
        color: "#b0c1d2",
        resolution: CAMERA_ZOOM,
      });
      label.setDepth(15);
      this.decorateLabel(label);
      if (drone.rule.kind === "escort" && !snapshot.runtime.escortUnlocked) {
        shadow.setVisible(false);
        sprite.setVisible(false);
        light.setVisible(false);
        range.setVisible(false);
        label.setVisible(false);
      }
      this.roomObjects.push(range, shadow, sprite, light, label);
      this.droneObjects.set(drone.id, {
        def: drone,
        shadow,
        sprite,
        light,
        range,
        label,
        state: "Observe",
      });
      if (drone.rule.kind === "scanner" && drone.patrol) {
        const angleRadians = Phaser.Math.FloatBetween(0, Math.PI * 2);
        this.scannerPatrolStates.set(drone.id, {
          lingerMs: 0,
          segmentAngleRadians: angleRadians,
          target: createPatrolTarget(drone.position, drone.patrol, angleRadians, 1),
        });
      }
    }

    this.syncDoorStates(0);
    this.syncConsoles();
    this.syncSignalZones(
      null,
      0,
      !snapshot.room.signalRequiresActivation || snapshot.runtime.guideFieldPrimed,
      snapshot.runtime.guideMemory.remainingMs > 0,
    );
    this.syncGuidePaths();
    this.syncResidents();
    this.syncStaff();
    this.syncWaitingZones(null, snapshot.runtime.receptionConfirmedMs > 0);
    this.syncHud();
  }

  private clearRoomObjects(): void {
    for (const collider of this.wallColliders) {
      collider.destroy();
    }
    this.wallColliders = [];
    this.wallBodies = [];
    this.doorObjects.clear();
    this.droneObjects.clear();
    this.scannerPatrolStates.clear();
    this.itemObjects.clear();
    this.slotObjects.clear();
    this.consoleObjects.clear();
    this.residentObjects.clear();
    this.staffObjects.clear();
    this.signalZoneObjects.clear();
    this.waitingZoneObjects.clear();
    for (const object of this.roomObjects) {
      object.destroy();
    }
    this.roomObjects = [];
    this.guideGraphics.clear();
  }

  private clearPreludeObjects(): void {
    for (const collider of this.preludeColliders) {
      collider.destroy();
    }
    this.preludeColliders = [];
    this.preludeGate = null;
    this.preludeCompanionPrompt = null;
    for (const object of this.preludeObjects) {
      object.destroy();
    }
    this.preludeObjects = [];
  }

  private getInputVelocity(): Phaser.Math.Vector2 {
    const velocity = new Phaser.Math.Vector2(0, 0);
    if (this.keys.up.isDown || this.keys.upAlt.isDown) {
      velocity.y -= 1;
    }
    if (this.keys.down.isDown || this.keys.downAlt.isDown) {
      velocity.y += 1;
    }
    if (this.keys.left.isDown || this.keys.leftAlt.isDown) {
      velocity.x -= 1;
    }
    if (this.keys.right.isDown || this.keys.rightAlt.isDown) {
      velocity.x += 1;
    }

    if (velocity.lengthSq() > 1) {
      velocity.normalize();
    }

    return velocity;
  }

  private updatePrelude(delta: number): void {
    const body = this.player.body as Phaser.Physics.Arcade.Body;
    const velocity = this.getInputVelocity();
    const speedLimit = this.isSpeedBoostActive()
      ? NORMAL_SPEED_LIMIT
      : PRELUDE_SLOW_SPEED;

    if (!this.preludeActive) {
      body.setVelocity(0, 0);
    } else {
      body.setVelocity(velocity.x * speedLimit, velocity.y * speedLimit);
    }

    this.syncPlayerShadow(0);
    this.indicateChargeMs = 0;
    this.indicateZoneId = null;
    this.renderIndicateRing(0);
    this.processPreludeInteractions();
    this.syncPrelude();
    if (this.processPreludeExit()) {
      return;
    }
    this.syncHud();
  }

  private processPreludeInteractions(): void {
    if (!this.preludeActive || !Phaser.Input.Keyboard.JustDown(this.keys.interact)) {
      return;
    }

    const companionPoint = { x: 132, y: 164 };
    const playerPos = { x: this.player.x, y: this.player.y };
    if (distance(playerPos, companionPoint) > 28) {
      return;
    }

    this.preludeCompanionSpoken = true;
    this.preludeGateUnlocked = true;
    this.preludeHint =
      "外门开了。从右边进去，先别慌，像来办事的。";
    this.playKeyboardClick("confirm");
  }

  private syncPrelude(): void {
    if (this.preludeCompanionPrompt) {
      this.preludeCompanionPrompt.setText(
        this.preludeCompanionSpoken
          ? "“我会盯着你的退路。进去吧。”"
          : "按 E 交接",
      );
      this.preludeCompanionPrompt.setColor(
        this.preludeCompanionSpoken ? "#bff2cf" : "#f8e8d2",
      );
    }

    if (this.preludeGate) {
      this.preludeGate.art.setTexture(
        this.preludeGateUnlocked ? "prelude-gate-open" : "prelude-gate-locked",
      );
      this.preludeGate.blocker.setFillStyle(
        0xffffff,
        this.preludeGateUnlocked ? 0.001 : 0.001,
      );
      this.preludeGate.body.checkCollision.none = this.preludeGateUnlocked;
    }
  }

  private processPreludeExit(): boolean {
    if (!this.preludeGateUnlocked) {
      return false;
    }

    if (!rectContains(PRELUDE_GATE_ENTRY_ZONE, { x: this.player.x, y: this.player.y })) {
      return false;
    }

    this.enterFacility();
    return true;
  }

  private enterFacility(): void {
    this.phase = "facility";
    this.session.start();
    this.loadRoom();
    this.syncHud();
  }

  private processInteractions(): void {
    if (!Phaser.Input.Keyboard.JustDown(this.keys.interact)) {
      return;
    }

    const snapshot = this.session.getSnapshot();
    if (snapshot.isPaused || snapshot.runtime.alertCountdownMs !== null) {
      return;
    }

    const playerPos = { x: this.player.x, y: this.player.y };

    const nearestConsole = Array.from(this.consoleObjects.values())
      .map((entry) => ({
        console: entry,
        distance: distanceToRect(playerPos, entry.def.rect),
      }))
      .filter((entry) => entry.distance <= INTERACT_RANGE)
      .sort((a, b) => a.distance - b.distance)[0];

    if (nearestConsole) {
      this.session.activateConsole(nearestConsole.console.def.id);
      this.playKeyboardClick("confirm");
      return;
    }

    if (this.carriedItemId) {
      const carriedItemId = this.carriedItemId;
      const nearestSlot = Array.from(this.slotObjects.values())
        .filter(
          (entry) => !this.isSlotOccupiedByOtherItem(entry.slot.id, carriedItemId),
        )
        .map((entry) => ({
          slot: entry.slot,
          distance: distanceToRect(playerPos, entry.slot.rect),
        }))
        .filter((entry) => entry.distance <= INTERACT_RANGE)
        .sort((a, b) => a.distance - b.distance)[0];

      const item = this.itemObjects.get(carriedItemId);
      if (!item) {
        this.carriedItemId = null;
        return;
      }

      if (nearestSlot) {
        item.slotId = nearestSlot.slot.id;
        const center = rectCenter(nearestSlot.slot.rect);
        item.sprite.setPosition(center.x, center.y);
        item.label.setPosition(center.x - 12, center.y + 12);
        this.session.placeItem(carriedItemId, nearestSlot.slot.id);
        this.playKeyboardClick("insert");
      } else {
        item.slotId = null;
        item.sprite.setPosition(this.player.x + 12, this.player.y + 8);
        item.label.setPosition(item.sprite.x - 12, item.sprite.y + 12);
        this.session.clearItemPlacement(carriedItemId);
        this.playKeyboardClick("light");
      }

      this.carriedItemId = null;
      return;
    }

    const nearestItem = Array.from(this.itemObjects.values())
      .filter((item) => !this.carriedItemId || item.id !== this.carriedItemId)
      .map((item) => ({
        item,
        distance: distance(playerPos, { x: item.sprite.x, y: item.sprite.y }),
      }))
      .filter((entry) => entry.distance <= INTERACT_RANGE)
      .sort((a, b) => a.distance - b.distance)[0];

    if (!nearestItem) {
      return;
    }

    this.carriedItemId = nearestItem.item.id;
    if (nearestItem.item.slotId) {
      this.session.clearItemPlacement(nearestItem.item.id);
      nearestItem.item.slotId = null;
    }
    this.playKeyboardClick("light");
  }

  private isSlotOccupiedByOtherItem(slotId: string, itemId: string): boolean {
    return Array.from(this.itemObjects.values()).some(
      (item) => item.id !== itemId && item.slotId === slotId,
    );
  }

  private processTriggers(): void {
    const room = this.currentRoom;
    if (!room.triggers) {
      return;
    }

    const runtime = this.session.getSnapshot().runtime;
    const playerPos = { x: this.player.x, y: this.player.y };

    for (const trigger of room.triggers) {
      if (runtime.triggeredIds.includes(trigger.id)) {
        continue;
      }
      if (rectContains(trigger.rect, playerPos)) {
        this.session.markTrigger(trigger.id);
      }
    }
  }

  private processExits(): boolean {
    const room = this.currentRoom;
    const playerPos = { x: this.player.x, y: this.player.y };

    for (const door of room.doors) {
      const renderedDoor = this.doorObjects.get(door.id);
      const doorReadyToExit =
        (renderedDoor?.open ?? false) || (renderedDoor?.exitGraceMs ?? 0) > 0;
      if (!canAdvanceThroughDoor(door, doorReadyToExit, playerPos)) {
        continue;
      }

      const moved = this.session.goToNextRoom();
      if (moved) {
        this.loadRoom();
      } else {
        this.syncHud();
      }
      return true;
    }

    return false;
  }

  private syncDoorStates(delta: number): void {
    const approach = this.getDoorApproachState();
    for (const door of this.doorObjects.values()) {
      const open = this.session.canOpenDoor(door.def, approach);
      if (door.open !== open) {
        this.playTone(open ? 520 : 220, open ? 0.03 : 0.02);
      }
      door.open = open;
      door.exitGraceMs = open
        ? EXIT_GRACE_MS
        : Math.max(0, door.exitGraceMs - delta);
      door.shape.setFillStyle(open ? 0x356c57 : 0x2f3843, open ? 0.94 : 1);
      door.shape.setStrokeStyle(2.4, open ? 0x9effb6 : 0xf0c562, open ? 1 : 0.64);
      door.body.checkCollision.none = open;
      door.label.setColor(open ? "#b9ffd0" : "#e7c77d");
      door.label.setText(`${door.def.label}\n${open ? "现在能过" : "还没放行"}`);
    }
  }

  private syncDroneStates(states: Record<string, DroneState>): void {
    for (const drone of this.droneObjects.values()) {
      const next = states[drone.def.id] ?? "Observe";
      if (drone.state !== next) {
        this.playTone(
          next === "Alert" ? 180 : next === "Guide" ? 420 : 300,
          next === "Alert" ? 0.05 : 0.025,
        );
      }
      drone.state = next;

      const visible =
        drone.def.rule.kind !== "escort" ||
        this.session.getSnapshot().runtime.escortUnlocked;
      drone.shadow.setVisible(visible);
      drone.sprite.setVisible(visible);
      drone.light.setVisible(visible);
      drone.range.setVisible(visible);
      drone.label.setVisible(visible);

      const colors = this.getDroneColors(next);
      drone.light.setFillStyle(colors.fill, 0.95);
      drone.range.setStrokeStyle(
        next === "Alert" ? 2.4 : next === "Warn" ? 1.8 : 1.2,
        colors.fill,
        visible ? (next === "Alert" ? 0.6 : next === "Warn" ? 0.42 : 0.24) : 0,
      );
      drone.range.setFillStyle(
        colors.fill,
        visible ? (next === "Alert" ? 0.12 : next === "Warn" ? 0.08 : 0.05) : 0,
      );
      drone.label.setText(`${drone.def.label}\n${this.describeDroneState(next)}`);
    }
  }

  private syncConsoles(): void {
    const runtime = this.session.getSnapshot().runtime;
    for (const consoleObject of this.consoleObjects.values()) {
      const active =
        consoleObject.def.action === "registerVisitor"
          ? runtime.visitorFlowUnlocked
          : consoleObject.def.action === "primeGuidance"
            ? runtime.guideFieldPrimed
            : runtime.escortReroutedMs > 0;
      consoleObject.shape.setFillStyle(
        active ? 0x6a4b2d : 0x423224,
        active ? 0.95 : 0.85,
      );
      consoleObject.shape.setStrokeStyle(
        1.5,
        active ? 0xffda9b : 0xf3b65b,
        0.95,
      );
      consoleObject.label.setColor(active ? "#fff1c9" : "#f4c783");
    }
  }

  private syncSignalZones(
    activeZoneId: string | null,
    indicateProgress: number,
    signalEnabled: boolean,
    indicationCompleted: boolean,
  ): void {
    for (const zone of this.signalZoneObjects.values()) {
      const progress = indicationCompleted
        ? 1
        : zone.id === activeZoneId
          ? indicateProgress
          : 0;
      const accent = signalEnabled
        ? this.mixColorHex(0x6be0ff, 0x7df2bc, progress)
        : 0x4f6b7a;
      const fillAlpha = signalEnabled
        ? 0.16 + progress * 0.16
        : 0.08;
      const strokeAlpha = signalEnabled
        ? 0.78 + progress * 0.14
        : 0.24;

      zone.shape.setFillStyle(accent, fillAlpha);
      zone.shape.setStrokeStyle(1.5, accent, strokeAlpha);

      zone.overlay.clear();
      zone.overlay.lineStyle(1, accent, signalEnabled ? 0.18 + progress * 0.18 : 0.08);
      for (let x = zone.rect.x + 4; x < zone.rect.x + zone.rect.width; x += 10) {
        zone.overlay.lineBetween(x, zone.rect.y + zone.rect.height, x + 8, zone.rect.y);
      }
      zone.overlay.lineStyle(2, accent, signalEnabled ? 0.42 + progress * 0.28 : 0.14);
      zone.overlay.lineBetween(zone.rect.x, zone.rect.y + 6, zone.rect.x + 8, zone.rect.y + 6);
      zone.overlay.lineBetween(zone.rect.x, zone.rect.y + 6, zone.rect.x, zone.rect.y + 14);
      zone.overlay.lineBetween(
        zone.rect.x + zone.rect.width - 8,
        zone.rect.y + 6,
        zone.rect.x + zone.rect.width,
        zone.rect.y + 6,
      );
      zone.overlay.lineBetween(
        zone.rect.x + zone.rect.width,
        zone.rect.y + 6,
        zone.rect.x + zone.rect.width,
        zone.rect.y + 14,
      );
      zone.overlay.lineBetween(
        zone.rect.x,
        zone.rect.y + zone.rect.height - 6,
        zone.rect.x + 8,
        zone.rect.y + zone.rect.height - 6,
      );
      zone.overlay.lineBetween(
        zone.rect.x,
        zone.rect.y + zone.rect.height - 6,
        zone.rect.x,
        zone.rect.y + zone.rect.height - 14,
      );
      zone.overlay.lineBetween(
        zone.rect.x + zone.rect.width - 8,
        zone.rect.y + zone.rect.height - 6,
        zone.rect.x + zone.rect.width,
        zone.rect.y + zone.rect.height - 6,
      );
      zone.overlay.lineBetween(
        zone.rect.x + zone.rect.width,
        zone.rect.y + zone.rect.height - 6,
        zone.rect.x + zone.rect.width,
        zone.rect.y + zone.rect.height - 14,
      );

      zone.reticle.clear();
      zone.reticle.lineStyle(1, accent, signalEnabled ? 0.24 + progress * 0.32 : 0.12);
      zone.reticle.strokeCircle(
        zone.rect.x + zone.rect.width / 2,
        zone.rect.y + zone.rect.height / 2,
        4 + progress,
      );
      zone.reticle.lineBetween(
        zone.rect.x + zone.rect.width / 2 - 6,
        zone.rect.y + zone.rect.height / 2,
        zone.rect.x + zone.rect.width / 2 + 6,
        zone.rect.y + zone.rect.height / 2,
      );
      zone.reticle.lineBetween(
        zone.rect.x + zone.rect.width / 2,
        zone.rect.y + zone.rect.height / 2 - 6,
        zone.rect.x + zone.rect.width / 2,
        zone.rect.y + zone.rect.height / 2 + 6,
      );
    }
  }

  private syncGuidePaths(): void {
    this.guideGraphics.clear();
    const runtime = this.session.getSnapshot().runtime;
    for (const path of this.currentRoom.guidePaths) {
      const active =
        (path.activeWhen === "maintenance" &&
          runtime.terminalMode === "maintenanceRequest") ||
        (path.activeWhen === "guided" &&
          (runtime.guideMemory.remainingMs > 0 ||
            runtime.interpretation === "guidedVisitor"));
      const color =
        path.color === "amber"
          ? active
            ? 0xf3b65b
            : 0x6f5b33
          : active
            ? 0x6be2ff
            : 0x284d65;
      const glowWidth = path.color === "blue" ? 11 : 8;
      const coreWidth = path.color === "blue" ? 5 : 4;
      const glowAlpha = active ? 0.2 : 0.08;
      const coreAlpha = active ? 0.95 : 0.4;
      const [first, ...rest] = path.points;

      this.guideGraphics.lineStyle(glowWidth, color, glowAlpha);
      this.guideGraphics.beginPath();
      this.guideGraphics.moveTo(first.x, first.y);
      rest.forEach((point) => this.guideGraphics.lineTo(point.x, point.y));
      this.guideGraphics.strokePath();

      this.guideGraphics.lineStyle(coreWidth, color, coreAlpha);
      this.guideGraphics.beginPath();
      this.guideGraphics.moveTo(first.x, first.y);
      rest.forEach((point) => this.guideGraphics.lineTo(point.x, point.y));
      this.guideGraphics.strokePath();
    }
  }

  private syncItems(): void {
    for (const item of this.itemObjects.values()) {
      if (this.carriedItemId === item.id) {
        item.sprite.setPosition(this.player.x, this.player.y - 14);
        item.shadow.setPosition(this.player.x, this.player.y - 7);
        item.label.setPosition(item.sprite.x - 12, item.sprite.y + 10);
        item.sprite.setAlpha(1);
        item.shadow.setAlpha(0.18);
      } else {
        item.shadow.setPosition(item.sprite.x, item.sprite.y + 5);
        item.shadow.setAlpha(0.35);
        item.sprite.setAlpha(0.95);
      }
    }
  }

  private syncPlayerShadow(delta: number): void {
    this.syncPlayerVisual(delta);

    const body = this.player.body as Phaser.Physics.Arcade.Body;
    const moveRatio = Phaser.Math.Clamp(
      body.velocity.length() / NORMAL_SPEED_LIMIT,
      0,
      1,
    );

    this.playerShadow.setPosition(
      this.player.x,
      this.player.y + 7 + this.playerBobOffset * 0.08,
    );
    this.playerShadow.setScale(
      1 - this.playerBobOffset * 0.028,
      1 - this.playerBobOffset * 0.05,
    );
    this.playerShadow.setAlpha(0.22 + moveRatio * 0.08);
  }

  private syncPlayerVisual(delta: number): void {
    const body = this.player.body as Phaser.Physics.Arcade.Body;
    const { x, y } = body.velocity;
    const speed = body.velocity.length();
    const moveRatio = Phaser.Math.Clamp(speed / NORMAL_SPEED_LIMIT, 0, 1);
    const moving = speed > 4;

    if (moving) {
      this.playerStridePhase = Phaser.Math.Wrap(
        this.playerStridePhase + (delta / 1000) * (6.2 + moveRatio * 5.4),
        0,
        Math.PI * 2,
      );
    } else {
      this.playerStridePhase *= Math.exp(-delta / 60);
    }

    if (Math.abs(x) > 2 || Math.abs(y) > 2) {
      if (Math.abs(x) > Math.abs(y) + 1) {
        this.playerFacing = x > 0 ? "right" : "left";
      } else {
        this.playerFacing = y > 0 ? "down" : "up";
      }
    }

    const stride = moving ? Math.sin(this.playerStridePhase) : 0;
    const lateralLean = Phaser.Math.Clamp(x / NORMAL_SPEED_LIMIT, -1, 1);
    const verticalLean = Phaser.Math.Clamp(y / NORMAL_SPEED_LIMIT, -1, 1);
    this.playerBobOffset = moving ? Math.abs(stride) * 0.9 : 0;

    this.playerVisual.clear();

    const drawX = this.player.x;
    const drawY = this.player.y - this.playerBobOffset * 0.4;

    if (this.playerFacing === "left" || this.playerFacing === "right") {
      this.drawPlayerSidePose(
        drawX,
        drawY,
        this.playerFacing === "right" ? 1 : -1,
        stride,
        moveRatio,
        lateralLean,
      );
      return;
    }

    this.drawPlayerVerticalPose(
      drawX,
      drawY,
      this.playerFacing === "down" ? 1 : -1,
      stride,
      moveRatio,
      lateralLean,
      verticalLean,
    );
  }

  private drawPlayerSidePose(
    x: number,
    y: number,
    facingSign: 1 | -1,
    stride: number,
    moveRatio: number,
    lateralLean: number,
  ): void {
    const g = this.playerVisual;
    const torsoX = x + facingSign * 0.35 + lateralLean * 0.5;
    const torsoY = y - 0.25;
    const headX = x + facingSign * 1.05 + lateralLean * 0.75;
    const headY = y - 5.45 - moveRatio * 0.15;
    const shoulderSwing = stride * 0.7;
    const hipSwing = stride * 0.95;
    const rearSideX = -3.1 * facingSign;
    const frontSideX = 3 * facingSign;
    const rearLegX = x - 1.65 * facingSign + hipSwing * 0.72;
    const frontLegX = x + 1.55 * facingSign - hipSwing * 0.72;
    const rearLegY = y + 3.15 + Math.max(0, stride) * 0.28;
    const frontLegY = y + 3.15 + Math.max(0, -stride) * 0.28;
    const rearFootLift = Math.max(0, -stride) * 0.85;
    const frontFootLift = Math.max(0, stride) * 0.85;
    const rearArmY = y - 0.85 + shoulderSwing * 0.16;
    const frontArmY = y - 0.5 - shoulderSwing * 0.16;
    const satchelX = x + 2.7 * facingSign;

    g.fillStyle(PLAYER_COLORS.trousers, 1);
    g.fillRoundedRect(rearLegX - 1, rearLegY, 2.1, 4.25 - rearFootLift * 0.24, 0.7);
    g.fillRoundedRect(frontLegX - 1, frontLegY, 2.1, 4.25 - frontFootLift * 0.24, 0.7);

    g.fillStyle(PLAYER_COLORS.shoes, 1);
    g.fillRoundedRect(rearLegX - 1.4, y + 7.25 - rearFootLift * 0.18, 2.9, 1.15, 0.45);
    g.fillRoundedRect(frontLegX - 1.4, y + 7.25 - frontFootLift * 0.18, 2.9, 1.15, 0.45);

    g.fillStyle(PLAYER_COLORS.outerwearShade, 0.96);
    g.fillRoundedRect(x + rearSideX - 0.8, rearArmY, 1.9, 4.5, 0.9);

    g.fillStyle(PLAYER_COLORS.hair, 0.5);
    g.fillRoundedRect(satchelX - 0.5, y - 0.2, 1.2, 4.2, 0.5);
    g.fillStyle(PLAYER_COLORS.outerwearShade, 0.92);
    g.fillRoundedRect(satchelX - 0.4, y + 1.5, 2.25, 3.2, 0.8);

    g.fillStyle(PLAYER_COLORS.outerwear, 1);
    g.fillRoundedRect(torsoX - 3.35, torsoY - 3.1, 6.7, 7.2, 1.8);
    g.fillStyle(PLAYER_COLORS.outerwearShade, 0.95);
    g.fillRoundedRect(torsoX - 1, torsoY - 3.1, 1.15, 7.1, 0.5);
    g.fillRoundedRect(torsoX + 1.1, torsoY - 3.1, 1.15, 7.1, 0.5);
    g.fillRect(torsoX - 3.2, torsoY - 3.2, 6.4, 0.95);

    g.fillStyle(PLAYER_COLORS.innerwear, 1);
    g.fillRoundedRect(torsoX - 0.8, torsoY - 2.2, 1.8, 3.8, 0.5);
    g.fillStyle(PLAYER_COLORS.accent, 0.96);
    g.fillRoundedRect(torsoX - 3.1, torsoY - 3.05, 6.2, 0.8, 0.3);

    g.fillStyle(PLAYER_COLORS.outerwear, 1);
    g.fillRoundedRect(x + frontSideX - 0.8, frontArmY, 1.95, 4.55, 0.9);

    g.fillStyle(PLAYER_COLORS.hair, 0.98);
    g.fillEllipse(headX - facingSign * 0.16, headY - 0.95, 6.5, 4.15);

    g.fillStyle(PLAYER_COLORS.skin, 1);
    g.fillCircle(headX, headY, 3.05);
    g.fillRect(headX - 0.9, headY + 2.7, 1.8, 0.9);

    g.fillStyle(PLAYER_COLORS.hair, 1);
    g.fillRoundedRect(headX - 2.7, headY - 3.25, 5.4, 1.65, 0.9);
    g.fillRect(headX - 2.7, headY - 1.85, 0.9, 0.9);
    g.fillRect(headX + 1.8, headY - 1.85, 0.9, 0.9);

  }

  private drawPlayerVerticalPose(
    x: number,
    y: number,
    facingSign: 1 | -1,
    stride: number,
    moveRatio: number,
    lateralLean: number,
    verticalLean: number,
  ): void {
    const g = this.playerVisual;
    const torsoWidth = facingSign > 0 ? 6.9 : 6.1;
    const torsoX = x + lateralLean * 0.6;
    const torsoY = y - 0.1 + verticalLean * 0.2;
    const headX = x + lateralLean * 0.55;
    const headY = y - (facingSign > 0 ? 5.7 : 6.05) - moveRatio * 0.15;
    const legSpread = facingSign > 0 ? 1.75 : 1.45;
    const armSpread = facingSign > 0 ? 3.35 : 2.95;
    const legShift = stride * 0.95;
    const armShift = stride * 0.45;
    const frontLegY = y + 3.2 + Math.max(0, facingSign * stride) * 0.4;
    const rearLegY = y + 3.2 + Math.max(0, -facingSign * stride) * 0.4;
    const satchelX = x + 2.25 + lateralLean * 0.4;
    const satchelAlpha = facingSign > 0 ? 0.88 : 0.42;

    if (facingSign < 0) {
      g.fillStyle(PLAYER_COLORS.outerwearShade, 0.78);
      g.fillRoundedRect(satchelX - 0.45, y + 0.4, 2.05, 3.05, 0.75);
    }

    g.fillStyle(PLAYER_COLORS.outerwearShade, 0.95);
    g.fillRoundedRect(x - armSpread - 0.95, y - 0.95 - armShift * 0.12, 1.95, 4.45, 0.8);
    g.fillRoundedRect(x + armSpread - 0.95, y - 0.95 + armShift * 0.12, 1.95, 4.45, 0.8);

    g.fillStyle(PLAYER_COLORS.trousers, 1);
    g.fillRoundedRect(x - legSpread - 1 + legShift * 0.3, rearLegY, 2.05, 4.35, 0.7);
    g.fillRoundedRect(x + legSpread - 1 - legShift * 0.3, frontLegY, 2.05, 4.35, 0.7);

    g.fillStyle(PLAYER_COLORS.shoes, 1);
    g.fillRoundedRect(x - legSpread - 1.4 + legShift * 0.22, y + 7.3, 2.85, 1.15, 0.45);
    g.fillRoundedRect(x + legSpread - 1.4 - legShift * 0.22, y + 7.3, 2.85, 1.15, 0.45);

    g.fillStyle(PLAYER_COLORS.outerwear, 1);
    g.fillRoundedRect(torsoX - torsoWidth / 2, torsoY - 3.15, torsoWidth, 7.35, 1.9);
    g.fillStyle(PLAYER_COLORS.outerwearShade, 0.92);
    g.fillRoundedRect(torsoX - 1.15, torsoY - 3.1, 1.05, 7.15, 0.5);
    g.fillRoundedRect(torsoX + 0.1, torsoY - 3.1, 1.05, 7.15, 0.5);

    g.fillStyle(PLAYER_COLORS.innerwear, facingSign > 0 ? 1 : 0.9);
    g.fillRoundedRect(torsoX - 0.85, torsoY - 2.15, 1.7, 3.65, 0.45);
    g.fillStyle(PLAYER_COLORS.accent, facingSign > 0 ? 0.96 : 0.72);
    g.fillRoundedRect(torsoX - torsoWidth / 2 + 0.25, torsoY - 3, torsoWidth - 0.5, 0.82, 0.3);

    g.fillStyle(PLAYER_COLORS.outerwearShade, satchelAlpha);
    g.fillRoundedRect(satchelX - 0.4, y + 1.2, 2.15, 3.15, 0.75);
    g.fillStyle(PLAYER_COLORS.hair, 0.5);
    g.fillRoundedRect(satchelX - 0.35, y - 0.3, 1.05, 4, 0.45);

    g.fillStyle(PLAYER_COLORS.hair, 0.98);
    g.fillEllipse(headX, headY - 0.95, 6.8, facingSign > 0 ? 4.45 : 4.85);

    g.fillStyle(PLAYER_COLORS.skin, 1);
    g.fillCircle(headX, headY, 3.08);
    g.fillRect(headX - 0.85, headY + 2.75, 1.7, 0.9);

    g.fillStyle(PLAYER_COLORS.hair, 1);
    g.fillRoundedRect(headX - 2.8, headY - 3.3, 5.55, 1.7, 0.95);
    g.fillRect(headX - 2.8, headY - 1.9, 0.92, 0.92);
    g.fillRect(headX + 1.88, headY - 1.9, 0.92, 0.92);

  }

  private syncHud(): void {
    if (this.phase === "prelude") {
      this.ui.renderHud({
        roomName: "门外准备",
        interpretation: "尚未入场",
        interpretationTone: "neutral",
        tendency: "读法未定",
        tendencyTone: "neutral",
        terminalMode: "无流程标签",
        terminalTone: "neutral",
        carrying: "空手",
        hint: this.preludeHint,
        hintTone: "neutral",
      });
      return;
    }

    const snapshot = this.session.getSnapshot();
    const interpretationTone = this.getInterpretationTone(
      snapshot.runtime.interpretation,
      snapshot.runtime.alertWarningMs > 0 || snapshot.runtime.alertCountdownMs !== null,
    );
    const hintTone = this.getHintTone(snapshot);
    this.ui.renderHud({
      roomName: snapshot.room.shortName,
      interpretation: this.describeInterpretation(snapshot.runtime.interpretation),
      interpretationTone,
      tendency: this.describeTendency(snapshot.runtime.interpretationScores),
      tendencyTone: interpretationTone,
      terminalMode: this.describeTerminal(snapshot.runtime.terminalMode),
      terminalTone:
        snapshot.runtime.terminalMode === "maintenanceRequest"
          ? "maintenance"
          : snapshot.runtime.terminalMode === "faultReport"
            ? "warning"
            : "neutral",
      carrying: this.carriedItemId ? "电池" : "空手",
      hint: snapshot.runtime.message ?? snapshot.room.hint,
      hintTone,
    });
  }

  private getActiveGuidePaths(
    room: RoomDefinition,
    runtime: RoomRuntime,
  ) {
    return room.guidePaths.filter((path) => {
      return (
        (path.activeWhen === "maintenance" &&
          runtime.terminalMode === "maintenanceRequest") ||
        (path.activeWhen === "guided" &&
          (runtime.guideMemory.remainingMs > 0 ||
            runtime.interpretation === "guidedVisitor"))
      );
    });
  }

  private getRoomDimensions(room: RoomDefinition): {
    width: number;
    height: number;
  } {
    return {
      width: room.dimensions?.width ?? DEFAULT_ROOM_WIDTH,
      height: room.dimensions?.height ?? DEFAULT_ROOM_HEIGHT,
    };
  }

  private getDoorApproachState(): {
    movementMode: "normal" | "slow";
    isInDroneRange: boolean;
  } {
    return {
      movementMode: this.getMovementMode(),
      isInDroneRange: this.currentRoom.drones.some((drone) =>
        this.isDroneVisible(drone),
      ),
    };
  }

  private getMovementMode(): "normal" | "slow" {
    return this.isSpeedBoostActive() ? "normal" : "slow";
  }

  private isSpeedBoostActive(): boolean {
    return this.keys.shift.isDown;
  }

  private renderIndicateRing(progress: number): void {
    if (progress <= 0) {
      this.indicateRing.setVisible(false);
      return;
    }

    this.indicateRing.setVisible(true);
    this.indicateRing.setPosition(this.player.x, this.player.y);
    this.indicateRing.setRadius(8 + progress * 5);
    this.indicateRing.setStrokeStyle(
      2,
      this.mixColorHex(0x6be2ff, 0x7df2bc, progress),
      0.4 + progress * 0.5,
    );
  }

  private mixColorHex(from: number, to: number, progress: number): number {
    const start = Phaser.Display.Color.IntegerToRGB(from);
    const end = Phaser.Display.Color.IntegerToRGB(to);
    const value = Phaser.Math.Clamp(progress, 0, 1);

    return Phaser.Display.Color.GetColor(
      Math.round(Phaser.Math.Linear(start.r, end.r, value)),
      Math.round(Phaser.Math.Linear(start.g, end.g, value)),
      Math.round(Phaser.Math.Linear(start.b, end.b, value)),
    );
  }

  private isDroneVisible(drone: DroneDefinition): boolean {
    const droneObject = this.droneObjects.get(drone.id);
    if (!droneObject?.sprite.visible) {
      return false;
    }
    if (
      drone.rule.kind === "scanner" &&
      this.currentRoom.terminal &&
      rectContains(this.currentRoom.terminal.body, {
        x: this.player.x,
        y: this.player.y,
      })
    ) {
      return false;
    }
    return (
      distance(
        { x: this.player.x, y: this.player.y },
        { x: droneObject.sprite.x, y: droneObject.sprite.y },
      ) <= drone.rule.visionRadius
    );
  }

  private updateEscortMotion(delta: number): void {
    const escort = Array.from(this.droneObjects.values()).find(
      (entry) => entry.def.rule.kind === "escort",
    );
    if (!escort || !escort.sprite.visible) {
      return;
    }

    const runtime = this.session.getSnapshot().runtime;
    const target = runtime.escortReleased
      ? this.getEscortWanderPosition(escort)
      : runtime.escortReroutedMs > 0 || runtime.escortDistractedMs > 0
        ? rectCenter(
            this.slotObjects.get("inspection-pad")?.slot.rect ?? {
              x: 214,
              y: 152,
              width: 20,
              height: 20,
            },
          )
        : { x: this.player.x - 18, y: this.player.y - 18 };

    const lerp = Math.min(1, delta / 260);
    this.setDronePosition(escort, {
      x: Phaser.Math.Linear(escort.sprite.x, target.x, lerp),
      y: Phaser.Math.Linear(escort.sprite.y, target.y, lerp),
    });
  }

  private getEscortWanderPosition(escort: RenderedDrone): { x: number; y: number } {
    const anchor = escort.def.rule.escortSpawn ?? escort.def.position;
    const radius = Math.min(escort.def.rule.visionRadius - 18, 32);
    const time = this.time.now / 1000;

    return {
      x: anchor.x + Math.cos(time * 0.95) * radius * 0.82,
      y: anchor.y + Math.sin(time * 1.27) * radius * 0.68,
    };
  }

  private updateScannerMotion(delta: number): void {
    for (const drone of this.droneObjects.values()) {
      if (drone.def.rule.kind !== "scanner" || !drone.def.patrol || delta <= 0) {
        continue;
      }

      const patrolState = this.scannerPatrolStates.get(drone.def.id);
      if (!patrolState) {
        continue;
      }

      if (patrolState.lingerMs > 0) {
        patrolState.lingerMs = Math.max(0, patrolState.lingerMs - delta);
        continue;
      }

      const nextPosition = moveTowardTarget(
        { x: drone.sprite.x, y: drone.sprite.y },
        patrolState.target,
        drone.def.patrol.speed,
        delta,
      );
      this.setDronePosition(drone, nextPosition);

      if (hasReachedTarget(nextPosition, patrolState.target)) {
        const previousTarget = patrolState.target;
        patrolState.lingerMs = drone.def.patrol.lingerMs ?? 1500;
        patrolState.target = this.pickScannerPatrolTarget(
          drone.def,
          previousTarget,
          patrolState.segmentAngleRadians,
        );
        patrolState.segmentAngleRadians = Phaser.Math.Angle.Between(
          previousTarget.x,
          previousTarget.y,
          patrolState.target.x,
          patrolState.target.y,
        );
      }
    }
  }

  private syncResidents(): void {
    const runtime = this.session.getSnapshot().runtime;
    for (const resident of this.residentObjects.values()) {
      const residentRuntime = runtime.residentStates[resident.def.id];
      if (!residentRuntime) {
        continue;
      }

      const position = residentRuntime.position;
      resident.shadow.setPosition(position.x, position.y + 7);
      resident.serviceHalo.setPosition(position.x, position.y);
      resident.sprite.setPosition(position.x, position.y);
      resident.marker.setPosition(position.x, position.y - 13);
      resident.label.setPosition(position.x - 12, position.y + 12);

      const waiting = residentRuntime.mode === "waitingAtService";
      const responding = residentRuntime.mode === "answeringService";
      resident.serviceHalo.setVisible(waiting || responding);
      resident.serviceHalo.setFillStyle(
        waiting ? 0x7df2bc : 0xf2be67,
        waiting ? 0.14 : 0.08,
      );
      resident.serviceHalo.setStrokeStyle(
        1.5,
        waiting ? 0x7df2bc : 0xf2be67,
        waiting ? 0.78 : 0.45,
      );
      resident.marker.setFillStyle(waiting ? 0x7df2bc : 0x9cf5ff, 0.92);
      resident.sprite.setAlpha(waiting ? 1 : 0.96);
      resident.label.setColor(waiting ? "#b9ffd7" : "#cfe6f5");
    }
  }

  private syncStaff(): void {
    const runtime = this.session.getSnapshot().runtime;
    for (const staff of this.staffObjects.values()) {
      const staffRuntime = runtime.staffStates[staff.def.id];
      if (!staffRuntime) {
        continue;
      }

      const position = staffRuntime.position;
      staff.shadow.setPosition(position.x, position.y + 7);
      staff.statusHalo.setPosition(position.x, position.y);
      staff.sprite.setPosition(position.x, position.y);
      staff.marker.setPosition(position.x, position.y - 13);
      staff.label.setPosition(position.x - 12, position.y + 12);

      const checking = staffRuntime.mode === "checkingQueue";
      const loading = staffRuntime.mode === "loading";
      const moving =
        staffRuntime.mode === "walkingToTerminal" ||
        staffRuntime.mode === "returningToDesk" ||
        staffRuntime.mode === "walkingRoute";
      const activeColor =
        staff.def.role === "porter"
          ? loading
            ? 0xf2be67
            : 0xffd27a
          : staff.def.role === "archivist"
            ? loading
              ? 0x7df2bc
              : 0x6be2ff
            : staff.def.role === "clerk"
              ? loading
                ? 0xf6d98b
                : 0xc6f1ff
          : checking
            ? 0x7df2bc
            : 0x73d4ff;
      const idleColor =
        staff.def.role === "porter"
          ? 0xf2be67
          : staff.def.role === "archivist"
            ? 0x6be2ff
            : staff.def.role === "clerk"
              ? 0xc6f1ff
            : 0x73d4ff;

      staff.statusHalo.setVisible(checking || moving || loading);
      staff.statusHalo.setFillStyle(activeColor, checking || loading ? 0.14 : 0.07);
      staff.statusHalo.setStrokeStyle(
        1.5,
        activeColor,
        checking || loading ? 0.78 : 0.45,
      );
      staff.marker.setFillStyle(
        checking || loading ? activeColor : idleColor,
        0.92,
      );
      staff.label.setColor(
        checking
          ? "#c9ffe4"
          : loading
            ? "#ffe9b9"
            : staff.def.role === "archivist"
              ? "#d4f3ff"
              : staff.def.role === "clerk"
                ? "#eef8ff"
              : staff.def.role === "porter"
                ? "#ffe2a8"
                : "#d9f5ff",
      );
      staff.sprite.setAlpha(moving ? 0.94 : loading ? 0.98 : 1);
    }
  }

  private syncWaitingZones(
    activeZoneId: string | null,
    receptionConfirmed: boolean,
  ): void {
    for (const zone of this.waitingZoneObjects.values()) {
      const isActive = zone.zone.id === activeZoneId;
      zone.shape.setFillStyle(
        receptionConfirmed ? 0x1e5540 : 0x1a3f4f,
        receptionConfirmed ? 0.24 : isActive ? 0.22 : 0.16,
      );
      zone.shape.setStrokeStyle(
        1.5,
        receptionConfirmed ? 0x7df2bc : 0x6ecbe8,
        receptionConfirmed ? 0.9 : isActive ? 0.82 : 0.6,
      );
      zone.label.setColor(
        receptionConfirmed ? "#c8ffe0" : isActive ? "#d2f3ff" : "#90c4d8",
      );
      zone.label.setText(
        receptionConfirmed
          ? `${zone.zone.label}\n已确认`
          : isActive
            ? `${zone.zone.label}\n正在读取`
            : `${zone.zone.label}\n等待确认`,
      );
    }
  }

  private pickScannerPatrolTarget(
    drone: DroneDefinition,
    currentPosition: { x: number; y: number },
    previousAngleRadians: number,
  ): { x: number; y: number } {
    let fallbackTarget = createPatrolTarget(
      drone.position,
      drone.patrol,
      previousAngleRadians + Math.PI,
      1,
    );
    let fallbackDelta = this.getAngleDeltaRadians(
      previousAngleRadians,
      Phaser.Math.Angle.Between(
        currentPosition.x,
        currentPosition.y,
        fallbackTarget.x,
        fallbackTarget.y,
      ),
    );

    for (let attempt = 0; attempt < SCANNER_TURN_PICK_ATTEMPTS; attempt += 1) {
      const candidateAngle = Phaser.Math.FloatBetween(0, Math.PI * 2);
      const candidateTarget = createPatrolTarget(
        drone.position,
        drone.patrol,
        candidateAngle,
        1,
      );
      const candidateSegmentAngle = Phaser.Math.Angle.Between(
        currentPosition.x,
        currentPosition.y,
        candidateTarget.x,
        candidateTarget.y,
      );
      const delta = this.getAngleDeltaRadians(
        previousAngleRadians,
        candidateSegmentAngle,
      );

      if (delta >= MIN_SCANNER_TURN_RADIANS) {
        return candidateTarget;
      }

      if (delta > fallbackDelta) {
        fallbackTarget = candidateTarget;
        fallbackDelta = delta;
      }
    }

    return fallbackTarget;
  }

  private getAngleDeltaRadians(from: number, to: number): number {
    return Math.abs(Phaser.Math.Angle.Wrap(to - from));
  }

  private setDronePosition(
    drone: RenderedDrone,
    position: { x: number; y: number },
  ): void {
    drone.shadow.setPosition(position.x, position.y + 6);
    drone.sprite.setPosition(position.x, position.y);
    drone.light.setPosition(position.x, position.y);
    drone.range.setPosition(position.x, position.y);
    drone.label.setPosition(position.x - 14, position.y + 12);
  }

  private getDroneColors(state: DroneState): { fill: number } {
    switch (state) {
      case "Guide":
        return { fill: 0x6be2ff };
      case "Warn":
        return { fill: 0xf0c562 };
      case "Escort":
        return { fill: 0xf3b65b };
      case "Alert":
        return { fill: 0xef5d63 };
      default:
        return { fill: 0xe3e7ee };
    }
  }

  private describeInterpretation(value: DoorRule["accepts"][number] | "intruder"): string {
    if (value === "guidedVisitor") {
      return "读成访客";
    }
    if (value === "maintenanceCandidate") {
      return "读成维修";
    }
    return "读成闯入";
  }

  private describeTerminal(value: TerminalMode): string {
    if (value === "maintenanceRequest") {
      return "挂了维修工单";
    }
    if (value === "faultReport") {
      return "挂了故障上报";
    }
    return "无流程标签";
  }

  private describeTendency(scores: InterpretationScores): string {
    const pairs = [
      ["维修", scores.maintenanceCandidate],
      ["访客", scores.guidedVisitor],
      ["闯入", scores.intruder],
    ] as const;
    const [primary, secondary] = [...pairs].sort((left, right) => right[1] - left[1]);
    const lead = primary[1] - secondary[1];

    if (lead >= 3) {
      return `偏${primary[0]}`;
    }
    if (lead >= 1.2) {
      return `${primary[0]}占上风`;
    }
    return "读法未定";
  }

  private describeDroneState(state: DroneState): string {
    if (state === "Guide") {
      return "在放行你";
    }
    if (state === "Warn") {
      return "开始起疑";
    }
    if (state === "Alert") {
      return "正在锁定";
    }
    if (state === "Escort") {
      return "会跟着你";
    }
    return "只是观察";
  }

  private getInterpretationTone(
    value: DoorRule["accepts"][number] | "intruder",
    isWarning: boolean,
  ): "visitor" | "maintenance" | "intruder" | "warning" {
    if (isWarning) {
      return "warning";
    }
    if (value === "guidedVisitor") {
      return "visitor";
    }
    if (value === "maintenanceCandidate") {
      return "maintenance";
    }
    return "intruder";
  }

  private getHintTone(snapshot: SessionSnapshot): "neutral" | "warning" | "success" | "visitor" | "maintenance" | "intruder" {
    if (snapshot.isComplete) {
      return "success";
    }
    if (
      snapshot.runtime.alertWarningMs > 0 ||
      snapshot.runtime.alertCountdownMs !== null
    ) {
      return "warning";
    }

    return this.getInterpretationTone(snapshot.runtime.interpretation, false);
  }

  private playKeyboardClick(
    variant: "light" | "insert" | "confirm",
  ): void {
    const context = this.getAudioContext();
    if (!context) {
      return;
    }

    const now = context.currentTime;
    const base =
      variant === "confirm" ? 1460 : variant === "insert" ? 1280 : 1120;
    const tail =
      variant === "confirm" ? 980 : variant === "insert" ? 860 : 720;
    const attack =
      variant === "confirm" ? 0.022 : variant === "insert" ? 0.026 : 0.018;

    this.playClickPulse(context, now, "square", base, 0.012, 0.038);
    this.playClickPulse(
      context,
      now + attack,
      "triangle",
      tail,
      0.008,
      variant === "confirm" ? 0.05 : 0.044,
    );
  }

  private playTone(frequency: number, gainValue: number): void {
    const context = this.getAudioContext();
    if (!context) {
      return;
    }

    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "triangle";
    oscillator.frequency.value = frequency;
    gain.gain.value = gainValue;
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.12);
    oscillator.stop(context.currentTime + 0.12);
  }

  private playClickPulse(
    context: AudioContext,
    startAt: number,
    type: OscillatorType,
    frequency: number,
    gainValue: number,
    duration: number,
  ): void {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const filter = context.createBiquadFilter();

    filter.type = "highpass";
    filter.frequency.value = 640;
    filter.Q.value = 0.7;

    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, startAt);
    oscillator.frequency.exponentialRampToValueAtTime(
      Math.max(260, frequency * 0.62),
      startAt + duration,
    );

    gain.gain.setValueAtTime(gainValue, startAt);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);

    oscillator.connect(filter);
    filter.connect(gain);
    gain.connect(context.destination);

    oscillator.start(startAt);
    oscillator.stop(startAt + duration);
  }

  private getAudioContext(): AudioContext | null {
    const manager = this.sound as
      | Phaser.Sound.WebAudioSoundManager
      | Phaser.Sound.NoAudioSoundManager;
    if (!("context" in manager) || !(manager.context instanceof AudioContext)) {
      return null;
    }

    const context = manager.context;
    if (context.state === "suspended") {
      void context.resume();
    }

    return context;
  }
}


