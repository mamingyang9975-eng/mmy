import Phaser from "phaser";

export class BootScene extends Phaser.Scene {
  constructor() {
    super("boot");
  }

  create(): void {
    const g = this.add.graphics();

    g.fillStyle(0x081019, 0.35);
    g.fillCircle(6, 9, 5);
    g.fillStyle(0x66dfff, 1);
    g.fillRoundedRect(1, 1, 10, 10, 3);
    g.fillStyle(0xbef7ff, 1);
    g.fillRect(3, 2, 6, 3);
    g.fillStyle(0x10202d, 0.95);
    g.fillRect(3, 6, 6, 4);
    g.fillStyle(0xe8fbff, 0.8);
    g.fillRect(4, 7, 4, 1);
    g.generateTexture("player-chip", 12, 12);
    g.clear();

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
}
