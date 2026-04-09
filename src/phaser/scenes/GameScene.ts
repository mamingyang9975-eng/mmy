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
  ItemSlot,
  Rect,
  ResidentDefinition,
  RoomDefinition,
  TerminalMode,
} from "../../game/simulation/types";
import { getUiController } from "../../ui/controllerStore";

const ROOM_WIDTH = 384;
const PRELUDE_WIDTH = 640;
const ROOM_HEIGHT = 216;
const CAMERA_ZOOM = 3;
const INTERACT_RANGE = 20;
const EXIT_GRACE_MS = 220;
const INDICATE_HOLD_MS = 2000;
const MIN_SCANNER_TURN_RADIANS = Math.PI / 3;
const SCANNER_TURN_PICK_ATTEMPTS = 16;
const PRELUDE_SLOW_SPEED = 68;

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
  body: Phaser.GameObjects.Rectangle;
  badge: Phaser.GameObjects.Rectangle;
  label: Phaser.GameObjects.Text;
  serviceHalo: Phaser.GameObjects.Arc;
}

interface RenderedSignalZone {
  id: string;
  rect: Rect;
  shape: Phaser.GameObjects.Rectangle;
  overlay: Phaser.GameObjects.Graphics;
  reticle: Phaser.GameObjects.Graphics;
}

interface ScannerPatrolRuntime {
  lingerMs: number;
  segmentAngleRadians: number;
  target: { x: number; y: number };
}

export class GameScene extends Phaser.Scene {
  private session = new GameSession();
  private ui = getUiController();
  private keys!: KeyMap;
  private player!: Phaser.Physics.Arcade.Image;
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
  private signalZoneObjects = new Map<string, RenderedSignalZone>();
  private scannerPatrolStates = new Map<string, ScannerPatrolRuntime>();
  private roomRef = this.session.getSnapshot().runtime;
  private currentRoom = ROOMS[0];
  private phase: ScenePhase = "prelude";
  private preludeActive = false;
  private preludeHint =
    "先靠近同伴按 E 完成交接，再穿过右侧入口进入设施。";
  private preludeCompanionSpoken = false;
  private preludeGateUnlocked = false;
  private preludeCompanionPrompt: Phaser.GameObjects.Text | null = null;
  private preludeGateShape: Phaser.GameObjects.Rectangle | null = null;
  private preludeGateBody: Phaser.Physics.Arcade.StaticBody | null = null;
  private preludeGateLabel: Phaser.GameObjects.Text | null = null;
  private carriedItemId: string | null = null;
  private indicateChargeMs = 0;
  private indicateZoneId: string | null = null;

  constructor() {
    super("game");
  }

  create(): void {
    this.physics.world.setBounds(0, 0, PRELUDE_WIDTH, ROOM_HEIGHT);
    this.cameras.main.setBackgroundColor(0x0f1319);
    this.cameras.main.setBounds(0, 0, PRELUDE_WIDTH, ROOM_HEIGHT);
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
      this.updatePrelude();
      return;
    }

    const snapshot = this.session.getSnapshot();
    const room = snapshot.room;
    const runtime = snapshot.runtime;
    const controlsLocked =
      snapshot.isPaused || snapshot.isComplete || runtime.alertCountdownMs !== null;

    const movementMode = this.keys.shift.isDown ? "slow" : "normal";
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
    const droneVisibility = room.drones
      .filter((drone) => this.isDroneVisible(drone))
      .map((drone) => drone.id);
    const isInSignalZone = activeSignalZone !== undefined;
    const isOnMaintenancePath = this.getActiveGuidePaths(room, runtime.terminalMode)
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
    this.syncItems();
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
      throw new Error("Keyboard input is not available.");
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

  private createPlayer(): void {
    this.player = this.physics.add.image(36, 180, "player-chip");
    this.player.setDepth(20);
    this.player.setDrag(900, 900);
    this.player.setMaxVelocity(NORMAL_SPEED_LIMIT, NORMAL_SPEED_LIMIT);
    this.player.setCollideWorldBounds(true);

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
      "先靠近同伴按 E 完成交接，再穿过右侧入口进入设施。";
    this.carriedItemId = null;
    this.indicateChargeMs = 0;
    this.indicateZoneId = null;

    this.setWorldFrame(PRELUDE_WIDTH, ROOM_HEIGHT, "prelude");
    this.player.setPosition(64, 166);
    this.player.setVelocity(0, 0);
    this.roomTitle.setText("设施外 / 入口坡道");

    const yard = this.add.graphics();
    yard.setDepth(2);
    yard.fillStyle(0x1a2632, 0.82);
    yard.fillRoundedRect(28, 92, PRELUDE_WIDTH - 204, 88, 18);
    yard.fillStyle(0x101821, 0.88);
    yard.fillRoundedRect(458, 54, 132, 124, 16);
    yard.lineStyle(2, 0x41556b, 0.65);
    yard.strokeRoundedRect(458, 54, 132, 124, 16);
    yard.lineStyle(1, 0x36495d, 0.5);
    for (let x = 44; x <= 404; x += 24) {
      yard.lineBetween(x, 170, x + 10, 104);
    }
    yard.lineStyle(1.5, 0x54697d, 0.52);
    yard.lineBetween(426, 42, 426, 180);
    yard.lineBetween(438, 42, 438, 180);
    yard.lineBetween(450, 42, 450, 180);

    const doorFrame = this.add.rectangle(524, 116, 36, 86, 0x1a212b, 0.92);
    doorFrame.setStrokeStyle(2, 0x4e6277, 0.74);
    doorFrame.setDepth(6.7);
    const gate = this.add.rectangle(524, 116, 24, 72, 0x334251, 0.96);
    gate.setStrokeStyle(2, 0xf0c562, 0.5);
    gate.setDepth(7);
    this.physics.add.existing(gate, true);
    const gateBody = gate.body as Phaser.Physics.Arcade.StaticBody;
    this.preludeGateShape = gate;
    this.preludeGateBody = gateBody;
    this.preludeColliders.push(this.physics.add.collider(this.player, gate));
    const gateLabel = this.add.text(486, 68, "外部门禁", {
      fontFamily: "Avenir Next, PingFang SC, Noto Sans SC, sans-serif",
      fontSize: "9px",
      fontStyle: "600",
      color: "#c0cfdd",
      resolution: CAMERA_ZOOM,
    });
    gateLabel.setDepth(8);
    this.decorateLabel(gateLabel);
    this.preludeGateLabel = gateLabel;

    const companionShadow = this.add.ellipse(132, 174, 22, 9, 0x05070b, 0.3);
    companionShadow.setDepth(10.5);
    const companionBody = this.add.rectangle(132, 164, 13, 16, 0xe4b77c, 0.96);
    companionBody.setStrokeStyle(1.5, 0xffe0bb, 0.95);
    companionBody.setDepth(11);
    const companionBadge = this.add.rectangle(132, 160, 6, 6, 0x24374c, 0.95);
    companionBadge.setDepth(11.05);
    const companionMarker = this.add.circle(132, 149, 3, 0xf6d08e, 0.92);
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

    const brief = this.add.text(42, 38, "“我在外面接应。你进去以后，顺着它的流程走，别和门口硬碰。”", {
      fontFamily: "Avenir Next, PingFang SC, Noto Sans SC, sans-serif",
      fontSize: "10px",
      color: "#b8c8d8",
      resolution: CAMERA_ZOOM,
      wordWrap: { width: 240 },
    });
    brief.setDepth(4);
    this.decorateLabel(brief);

    const facilitySign = this.add.text(472, 42, "低歧义接入设施", {
      fontFamily: "Avenir Next, PingFang SC, Noto Sans SC, sans-serif",
      fontSize: "10px",
      fontStyle: "600",
      color: "#d6e4f1",
      resolution: CAMERA_ZOOM,
    });
    facilitySign.setDepth(4);
    this.decorateLabel(facilitySign);

    this.preludeObjects.push(
      yard,
      doorFrame,
      gate,
      gateLabel,
      companionShadow,
      companionBody,
      companionBadge,
      companionMarker,
      companionLabel,
      companionPrompt,
      brief,
      facilitySign,
    );
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
    this.setWorldFrame(ROOM_WIDTH, ROOM_HEIGHT, "facility");
    this.player.setPosition(snapshot.room.playerSpawn.x, snapshot.room.playerSpawn.y);
    this.player.setVelocity(0, 0);
    this.roomTitle.setText(snapshot.room.name);

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

    for (const resident of snapshot.room.residents) {
      this.createResidentServicePoint(resident.servicePoint);
      const shadow = this.add.ellipse(
        resident.position.x,
        resident.position.y + 7,
        20,
        8,
        0x05070b,
        0.26,
      );
      shadow.setDepth(10.5);
      const serviceHalo = this.add.circle(
        resident.position.x,
        resident.position.y,
        13,
        0xf2be67,
        0.08,
      );
      serviceHalo.setStrokeStyle(1.5, 0xf2be67, 0.45);
      serviceHalo.setDepth(10.8);
      const body = this.add.rectangle(
        resident.position.x,
        resident.position.y,
        12,
        14,
        0xb6d4e6,
        0.96,
      );
      body.setStrokeStyle(1.5, 0xeaf4ff, 0.95);
      body.setDepth(11);
      const badge = this.add.rectangle(
        resident.position.x,
        resident.position.y - 2,
        5,
        5,
        0x2f495d,
        0.95,
      );
      badge.setDepth(11.05);
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
      this.roomObjects.push(shadow, serviceHalo, body, badge, marker, label);
      this.residentObjects.set(resident.id, {
        def: resident,
        marker,
        shadow,
        body,
        badge,
        label,
        serviceHalo,
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
    this.signalZoneObjects.clear();
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
    this.preludeGateShape = null;
    this.preludeGateBody = null;
    this.preludeGateLabel = null;
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

  private updatePrelude(): void {
    const body = this.player.body as Phaser.Physics.Arcade.Body;
    const velocity = this.getInputVelocity();
    const speedLimit = this.keys.shift.isDown
      ? PRELUDE_SLOW_SPEED
      : NORMAL_SPEED_LIMIT;

    if (!this.preludeActive) {
      body.setVelocity(0, 0);
    } else {
      body.setVelocity(velocity.x * speedLimit, velocity.y * speedLimit);
    }

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
      "外部门禁已经被同伴远程放行。沿右侧坡道进入设施，潜入会在门后正式开始。";
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

    if (this.preludeGateShape) {
      this.preludeGateShape.setFillStyle(
        this.preludeGateUnlocked ? 0x315f4d : 0x334251,
        this.preludeGateUnlocked ? 0.88 : 0.96,
      );
      this.preludeGateShape.setStrokeStyle(
        2,
        this.preludeGateUnlocked ? 0x8ff0a4 : 0xf0c562,
        this.preludeGateUnlocked ? 0.9 : 0.5,
      );
    }

    if (this.preludeGateBody) {
      this.preludeGateBody.checkCollision.none = this.preludeGateUnlocked;
    }

    if (this.preludeGateLabel) {
      this.preludeGateLabel.setText(
        this.preludeGateUnlocked ? "外部门禁 / 已放行" : "外部门禁 / 锁定",
      );
      this.preludeGateLabel.setColor(
        this.preludeGateUnlocked ? "#8ff0a4" : "#c0cfdd",
      );
    }
  }

  private processPreludeExit(): boolean {
    if (!this.preludeGateUnlocked) {
      return false;
    }

    if (this.player.x < 578) {
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
      door.shape.setFillStyle(open ? 0x315f4d : 0x2d3b49, open ? 0.85 : 1);
      door.shape.setStrokeStyle(2, open ? 0x8ff0a4 : 0xefcf69, open ? 0.9 : 0.5);
      door.body.checkCollision.none = open;
      door.label.setColor(open ? "#8ff0a4" : "#a5b7c8");
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
      drone.range.setStrokeStyle(1, colors.fill, visible ? 0.24 : 0);
      drone.range.setFillStyle(colors.fill, visible ? 0.05 : 0);
    }
  }

  private syncConsoles(): void {
    const runtime = this.session.getSnapshot().runtime;
    for (const consoleObject of this.consoleObjects.values()) {
      const active = runtime.guideFieldPrimed;
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
        (path.activeWhen === "guided" && runtime.guideMemory.remainingMs > 0);
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

  private syncHud(): void {
    if (this.phase === "prelude") {
      this.ui.renderHud({
        roomName: "设施外",
        interpretation: "未接入",
        terminalMode: "无",
        carrying: "空手",
        hint: this.preludeHint,
      });
      return;
    }

    const snapshot = this.session.getSnapshot();
    this.ui.renderHud({
      roomName: snapshot.room.shortName,
      interpretation: this.describeInterpretation(snapshot.runtime.interpretation),
      terminalMode: this.describeTerminal(snapshot.runtime.terminalMode),
      carrying: this.carriedItemId ? "电池" : "空手",
      hint: snapshot.runtime.message ?? snapshot.room.hint,
    });
  }

  private getActiveGuidePaths(
    room: RoomDefinition,
    terminalMode: TerminalMode,
  ) {
    return room.guidePaths.filter((path) => {
      return (
        path.activeWhen === "maintenance" &&
        terminalMode === "maintenanceRequest"
      );
    });
  }

  private getDoorApproachState(): {
    movementMode: "normal" | "slow";
    isInDroneRange: boolean;
  } {
    return {
      movementMode: this.keys.shift.isDown ? "slow" : "normal",
      isInDroneRange: this.currentRoom.drones.some((drone) =>
        this.isDroneVisible(drone),
      ),
    };
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
    const escort = this.droneObjects.get("escort-c");
    if (!escort || !escort.sprite.visible) {
      return;
    }

    const runtime = this.session.getSnapshot().runtime;
    const target = runtime.escortReleased
      ? this.getEscortWanderPosition(escort)
      : runtime.escortDistractedMs > 0
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
      resident.body.setPosition(position.x, position.y);
      resident.badge.setPosition(position.x, position.y - 2);
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
      resident.body.setFillStyle(waiting ? 0xc9f3dd : 0xb6d4e6, 0.96);
      resident.badge.setFillStyle(waiting ? 0x3b8f63 : 0x2f495d, 0.95);
      resident.label.setColor(waiting ? "#b9ffd7" : "#cfe6f5");
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
      return "访客通道";
    }
    if (value === "maintenanceCandidate") {
      return "维修通道";
    }
    return "未授权";
  }

  private describeTerminal(value: TerminalMode): string {
    if (value === "maintenanceRequest") {
      return "维修请求";
    }
    if (value === "faultReport") {
      return "故障上报";
    }
    return "无";
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
