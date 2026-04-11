import Phaser from "phaser";

interface PersonTextureConfig {
  skin: number;
  hair: number;
  outerwear: number;
  outerwearShade: number;
  innerwear: number;
  trousers: number;
  shoes: number;
  accent: number;
  longHair?: boolean;
  longCoat?: boolean;
  satchel?: boolean;
}

export class BootScene extends Phaser.Scene {
  constructor() {
    super("boot");
  }

  preload(): void {
    this.load.image("facility-tileset", "/tilesets/tileset_for_free.png");
    this.load.json("facility-example-map-data", "/maps/free_scifi_tileset_example.json");
    this.load.image(
      "steelsoldier-floor-objects",
      "/tilesets/steelsoldier/floor-objects.png",
    );
    this.load.image(
      "steelsoldier-walls-roofs",
      "/tilesets/steelsoldier/walls-roofs.png",
    );
    this.load.image(
      "steelsoldier-space-objects",
      "/tilesets/steelsoldier/space-animated-objects.png",
    );
  }

  create(): void {
    const g = this.add.graphics();

    this.createPersonTexture(g, "player-chip", {
      skin: 0xd4b18c,
      hair: 0x1a212c,
      outerwear: 0x325364,
      outerwearShade: 0x223947,
      innerwear: 0x8ab7c4,
      trousers: 0x263241,
      shoes: 0x0f141c,
      accent: 0x66dfff,
      satchel: true,
    });

    this.createPersonTexture(g, "companion-chip", {
      skin: 0xe2bb95,
      hair: 0x241a18,
      outerwear: 0xb58a63,
      outerwearShade: 0x8f6a4a,
      innerwear: 0xf1dcc0,
      trousers: 0x4f4036,
      shoes: 0x16181d,
      accent: 0x95d2bc,
      longHair: true,
      longCoat: true,
    });

    this.createPersonTexture(g, "resident-chip", {
      skin: 0xcaa88f,
      hair: 0x2a313d,
      outerwear: 0x758a9d,
      outerwearShade: 0x5a6d7e,
      innerwear: 0xdce6f0,
      trousers: 0x394554,
      shoes: 0x11161d,
      accent: 0x98c0de,
    });

    this.createPersonTexture(g, "staff-chip", {
      skin: 0xd8b291,
      hair: 0x1e2732,
      outerwear: 0x496a82,
      outerwearShade: 0x355164,
      innerwear: 0xe6eef6,
      trousers: 0x2e3946,
      shoes: 0x11161d,
      accent: 0x79d6c8,
      longCoat: true,
    });

    g.fillStyle(0x091018, 0.34);
    g.fillEllipse(7, 10, 10, 5);
    g.fillStyle(0x4f5968, 1);
    g.fillCircle(7, 7, 7);
    g.fillStyle(0x7f8ea5, 0.95);
    g.fillCircle(7, 7, 5);
    g.fillStyle(0x17222d, 1);
    g.fillCircle(7, 7, 3);
    g.fillStyle(0xdce6f2, 0.9);
    g.fillCircle(7, 7, 1.5);
    g.fillStyle(0x49566c, 0.9);
    g.fillRect(1, 6, 2, 2);
    g.fillRect(11, 6, 2, 2);
    g.generateTexture("drone-chip", 14, 14);
    g.clear();

    g.fillStyle(0x080b10, 0.32);
    g.fillEllipse(5, 12, 8, 4);
    g.fillStyle(0xf3b95a, 1);
    g.fillRoundedRect(0, 1, 10, 13, 2);
    g.fillStyle(0xffd581, 0.95);
    g.fillRect(2, 2, 6, 1);
    g.fillStyle(0x3a3122, 0.75);
    g.fillRect(3, 3, 4, 9);
    g.fillStyle(0x1a1f2b, 0.7);
    g.fillRect(4, 3, 2, 9);
    g.fillStyle(0xd89c3d, 1);
    g.fillRect(2, 13, 6, 1);
    g.generateTexture("battery-chip", 10, 14);
    g.destroy();

    this.scene.start("game");
  }

  private createPersonTexture(
    graphics: Phaser.GameObjects.Graphics,
    key: string,
    config: PersonTextureConfig,
  ): void {
    graphics.clear();

    if (config.longHair) {
      graphics.fillStyle(config.hair, 0.98);
      graphics.fillEllipse(8, 6, 8.5, 9);
      graphics.fillRect(4, 6, 2, 5);
      graphics.fillRect(10, 6, 2, 5);
    } else {
      graphics.fillStyle(config.hair, 0.98);
      graphics.fillEllipse(8, 5.4, 7.6, 5.8);
    }

    graphics.fillStyle(config.skin, 1);
    graphics.fillCircle(8, 6, 3.2);
    graphics.fillRect(7, 9, 2, 1);

    graphics.fillStyle(config.hair, 1);
    graphics.fillRoundedRect(5, 2, 6, 2.6, 1.2);
    graphics.fillRect(5, 4, 1, 1);
    graphics.fillRect(10, 4, 1, 1);

    graphics.fillStyle(config.outerwear, 1);
    graphics.fillRoundedRect(4, 10, 8, 7, 2);
    graphics.fillRect(3, 11, 1, 4);
    graphics.fillRect(12, 11, 1, 4);

    if (config.longCoat) {
      graphics.fillTriangle(4, 15, 8, 19, 3, 19);
      graphics.fillTriangle(12, 15, 8, 19, 13, 19);
    }

    graphics.fillStyle(config.outerwearShade, 0.95);
    graphics.fillRect(4, 13, 8, 1);
    graphics.fillRect(6, 10, 1, 7);
    graphics.fillRect(9, 10, 1, 7);

    graphics.fillStyle(config.innerwear, 1);
    graphics.fillRect(7, 11, 2, 4);

    graphics.fillStyle(config.accent, 0.95);
    graphics.fillRect(4, 10, 8, 1);

    if (config.satchel) {
      graphics.fillRect(9, 9, 1, 4);
      graphics.fillRoundedRect(10, 12, 2, 4, 1);
    }

    graphics.fillStyle(config.trousers, 1);
    graphics.fillRect(5, 17, 2, 4);
    graphics.fillRect(9, 17, 2, 4);

    graphics.fillStyle(config.shoes, 1);
    graphics.fillRect(4, 21, 3, 1);
    graphics.fillRect(9, 21, 3, 1);

    graphics.fillStyle(0xffffff, 0.22);
    graphics.fillRect(6, 5, 1, 1);
    graphics.fillRect(9, 5, 1, 1);

    graphics.generateTexture(key, 16, 22);
    graphics.clear();
  }
}
