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
import { samplePatrolPosition } from "../../game/simulation/patrol";
import { getSpeedLimit } from "../../game/simulation/rules";
import { GameSession } from "../../game/simulation/session";
import type {
  ConsoleDefinition,
  DoorDefinition,
  DoorRule,
  DroneDefinition,
  DroneState,
  ItemSlot,
  RoomDefinition,
  TerminalMode,
} from "../../game/simulation/types";
import { getUiController } from "../../ui/controllerStore";

const ROOM_WIDTH = 384;
const ROOM_HEIGHT = 216;
const CAMERA_ZOOM = 3;
const INTERACT_RANGE = 20;
const INDICATE_MS = 1000;
const EXIT_GRACE_MS = 220;

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
  sprite: Phaser.GameObjects.Image;
  light: Phaser.GameObjects.Arc;
  range: Phaser.GameObjects.Arc;
  label: Phaser.GameObjects.Text;
  state: DroneState;
}

interface RenderedItem {
  id: string;
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

export class GameScene extends Phaser.Scene {
  private session = new GameSession();
  private ui = getUiController();
  private keys!: KeyMap;
  private player!: Phaser.Physics.Arcade.Image;
  private indicateRing!: Phaser.GameObjects.Arc;
  private guideGraphics!: Phaser.GameObjects.Graphics;
  private roomTitle!: Phaser.GameObjects.Text;
  private roomObjects: Phaser.GameObjects.GameObject[] = [];
  private wallBodies: Phaser.GameObjects.Rectangle[] = [];
  private wallColliders: Phaser.Physics.Arcade.Collider[] = [];
  private doorObjects = new Map<string, RenderedDoor>();
  private droneObjects = new Map<string, RenderedDrone>();
  private itemObjects = new Map<string, RenderedItem>();
  private slotObjects = new Map<string, RenderedSlot>();
  private consoleObjects = new Map<string, RenderedConsole>();
  private roomRef = this.session.getSnapshot().runtime;
  private currentRoom = ROOMS[0];
  private carriedItemId: string | null = null;
  private indicateChargeMs = 0;
  private roomMotionElapsedMs = 0;

  constructor() {
    super("game");
  }

  create(): void {
    this.physics.world.setBounds(0, 0, ROOM_WIDTH, ROOM_HEIGHT);
    this.cameras.main.setBackgroundColor(0x0f1319);
    this.cameras.main.setBounds(0, 0, ROOM_WIDTH, ROOM_HEIGHT);
    this.cameras.main.setZoom(CAMERA_ZOOM);
    this.cameras.main.roundPixels = true;

    this.keys = this.createKeys();
    this.createBackdrop();
    this.createPlayer();
    this.createForeground();

    this.ui.bindCommands({
      start: () => this.handleStart(),
      resume: () => this.handleResume(),
      restart: () => this.handleRestart(),
    });

    this.loadRoom();
    this.ui.showIntro();
    this.syncHud();
  }

  update(_: number, delta: number): void {
    if (Phaser.Input.Keyboard.JustDown(this.keys.pause)) {
      this.handlePauseToggle();
    }

    if (Phaser.Input.Keyboard.JustDown(this.keys.reset)) {
      this.session.resetRoom();
      this.loadRoom();
      this.syncHud();
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
    } else {
      body.setVelocity(velocity.x * speedLimit, velocity.y * speedLimit);
      this.roomMotionElapsedMs += delta;
    }

    this.updateScannerMotion();

    const playerPos = { x: this.player.x, y: this.player.y };
    const droneVisibility = room.drones
      .filter((drone) => this.isDroneVisible(drone))
      .map((drone) => drone.id);
    const isInSignalZone = room.signalZones.some((zone) =>
      rectContains(zone.rect, playerPos),
    );
    const isOnMaintenancePath = this.getActiveGuidePaths(room, runtime.terminalMode)
      .some((path) => distanceToPolyline(playerPos, path.points) <= path.tolerance);
    const signalEnabled =
      !room.signalRequiresActivation || runtime.guideFieldPrimed;
    const isInGuideRange =
      runtime.guideMemory.remainingMs > 0 && droneVisibility.length > 0;
    const isOnTrustedRoute = isOnMaintenancePath || isInGuideRange;

    const canCharge =
      !controlsLocked &&
      this.keys.indicate.isDown &&
      isInSignalZone &&
      signalEnabled &&
      body.velocity.length() < 10;
    this.indicateChargeMs = canCharge
      ? Math.min(INDICATE_MS, this.indicateChargeMs + delta)
      : 0;
    this.renderIndicateRing(this.indicateChargeMs / INDICATE_MS);

    const droneStates = this.session.updateIntent(
      {
        movementMode,
        speed: body.velocity.length(),
        isIndicating: this.indicateChargeMs >= INDICATE_MS,
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
    this.syncGuidePaths();
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
    this.session.start();
    this.ui.hideModal();
    this.loadRoom();
    this.syncHud();
  }

  private handleResume(): void {
    this.session.setPaused(false);
    this.ui.hideModal();
    this.syncHud();
  }

  private handleRestart(): void {
    this.session = new GameSession();
    this.carriedItemId = null;
    this.indicateChargeMs = 0;
    this.loadRoom();
    this.ui.showIntro();
    this.syncHud();
  }

  private handlePauseToggle(): void {
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
    const bg = this.add.graphics();
    bg.fillGradientStyle(0x10161f, 0x10161f, 0x090c11, 0x090c11, 1);
    bg.fillRect(0, 0, ROOM_WIDTH, ROOM_HEIGHT);
    bg.fillStyle(0x16304a, 0.08);
    bg.fillEllipse(ROOM_WIDTH * 0.28, ROOM_HEIGHT * 0.22, 130, 78);
    bg.fillStyle(0xf3b65b, 0.04);
    bg.fillEllipse(ROOM_WIDTH * 0.78, ROOM_HEIGHT * 0.7, 168, 112);
    bg.fillStyle(0x111926, 0.88);
    bg.fillRoundedRect(8, 8, ROOM_WIDTH - 16, ROOM_HEIGHT - 16, 14);
    bg.lineStyle(1, 0x233042, 0.9);
    bg.strokeRoundedRect(8, 8, ROOM_WIDTH - 16, ROOM_HEIGHT - 16, 14);
    bg.lineStyle(1, 0x18212c, 0.85);
    for (let x = 0; x <= ROOM_WIDTH; x += 24) {
      bg.lineBetween(x, 0, x, ROOM_HEIGHT);
    }
    for (let y = 0; y <= ROOM_HEIGHT; y += 24) {
      bg.lineBetween(0, y, ROOM_WIDTH, y);
    }
    bg.lineStyle(1, 0x26425c, 0.18);
    bg.lineBetween(16, 22, ROOM_WIDTH - 16, 22);
    bg.lineBetween(16, ROOM_HEIGHT - 22, ROOM_WIDTH - 16, ROOM_HEIGHT - 22);
  }

  private createPlayer(): void {
    this.player = this.physics.add.image(36, 180, "player-chip");
    this.player.setDepth(20);
    this.player.setDrag(900, 900);
    this.player.setMaxVelocity(130, 130);
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
      fontSize: "12px",
      color: "#dce6f7",
      resolution: CAMERA_ZOOM,
    });
    this.roomTitle.setDepth(10);
  }

  private loadRoom(): void {
    this.clearRoomObjects();
    const snapshot = this.session.getSnapshot();
    this.currentRoom = snapshot.room;
    this.roomRef = snapshot.runtime;
    this.carriedItemId = null;
    this.indicateChargeMs = 0;
    this.roomMotionElapsedMs = 0;
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
        fontSize: "8px",
        color: "#a5b7c8",
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
      const body = this.createTerminalBody(terminal.body);
      const title = this.add.text(terminal.body.x + 6, terminal.body.y + 6, terminal.label, {
        fontFamily: "Avenir Next, PingFang SC, Noto Sans SC, sans-serif",
        fontSize: "8px",
        color: "#c6d3e0",
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
          fontSize: "7px",
          color: "#8ea0b2",
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
            fontSize: "7px",
            color: "#8fdff3",
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
        fontSize: "7px",
        color: "#f4d996",
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

    for (const zone of snapshot.room.signalZones) {
      this.createSignalZone(zone.rect);
    }

    snapshot.room.signage.forEach((text, index) => {
      const sign = this.add.text(18, 28 + index * 12, text, {
        fontFamily: "Avenir Next, PingFang SC, Noto Sans SC, sans-serif",
        fontSize: "8px",
        color: "#6f8193",
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
        fontSize: "7px",
        color: "#9ab0c3",
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
    }

    this.syncDoorStates(0);
    this.syncConsoles();
    this.syncGuidePaths();
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
    this.itemObjects.clear();
    this.slotObjects.clear();
    this.consoleObjects.clear();
    for (const object of this.roomObjects) {
      object.destroy();
    }
    this.roomObjects = [];
    this.guideGraphics.clear();
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
      const nearestSlot = Array.from(this.slotObjects.values())
        .map((entry) => ({
          slot: entry.slot,
          distance: distanceToRect(playerPos, entry.slot.rect),
        }))
        .filter((entry) => entry.distance <= INTERACT_RANGE)
        .sort((a, b) => a.distance - b.distance)[0];

      const item = this.itemObjects.get(this.carriedItemId);
      if (!item) {
        this.carriedItemId = null;
        return;
      }

      if (nearestSlot) {
        item.slotId = nearestSlot.slot.id;
        const center = rectCenter(nearestSlot.slot.rect);
        item.sprite.setPosition(center.x, center.y);
        item.label.setPosition(center.x - 12, center.y + 12);
        this.session.placeItem(this.carriedItemId, nearestSlot.slot.id);
        this.playKeyboardClick("insert");
      } else {
        item.slotId = null;
        item.sprite.setPosition(this.player.x + 12, this.player.y + 8);
        item.label.setPosition(item.sprite.x - 12, item.sprite.y + 12);
        this.session.clearItemPlacement(this.carriedItemId);
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
        active ? 0x325565 : 0x20343f,
        active ? 0.95 : 0.85,
      );
      consoleObject.shape.setStrokeStyle(
        1.5,
        active ? 0x98f0ff : 0x6be2ff,
        0.95,
      );
      consoleObject.label.setColor(active ? "#d7fbff" : "#8fdff3");
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
        item.label.setPosition(item.sprite.x - 12, item.sprite.y + 10);
        item.sprite.setAlpha(1);
      } else {
        item.sprite.setAlpha(0.95);
      }
    }
  }

  private syncHud(): void {
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
    this.indicateRing.setStrokeStyle(2, 0x6be2ff, 0.4 + progress * 0.5);
  }

  private isDroneVisible(drone: DroneDefinition): boolean {
    const droneObject = this.droneObjects.get(drone.id);
    if (!droneObject?.sprite.visible) {
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
    const target = runtime.escortDistractedMs > 0
      ? rectCenter(this.slotObjects.get("inspection-pad")?.slot.rect ?? { x: 214, y: 152, width: 20, height: 20 })
      : { x: this.player.x - 18, y: this.player.y - 18 };

    const lerp = Math.min(1, delta / 260);
    this.setDronePosition(escort, {
      x: Phaser.Math.Linear(escort.sprite.x, target.x, lerp),
      y: Phaser.Math.Linear(escort.sprite.y, target.y, lerp),
    });
  }

  private updateScannerMotion(): void {
    for (const drone of this.droneObjects.values()) {
      if (drone.def.rule.kind !== "scanner" || !drone.def.patrol) {
        continue;
      }

      this.setDronePosition(
        drone,
        samplePatrolPosition(
          drone.def.position,
          drone.def.patrol,
          this.roomMotionElapsedMs,
        ),
      );
    }
  }

  private setDronePosition(
    drone: RenderedDrone,
    position: { x: number; y: number },
  ): void {
    drone.sprite.setPosition(position.x, position.y);
    drone.light.setPosition(position.x, position.y);
    drone.range.setPosition(position.x, position.y);
    drone.label.setPosition(position.x - 14, position.y + 12);
  }

  private getDroneColors(state: DroneState): { fill: number } {
    switch (state) {
      case "Guide":
        return { fill: 0x6be2ff };
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
      return "访客流量";
    }
    if (value === "maintenanceCandidate") {
      return "维修流量";
    }
    return "入侵者";
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
