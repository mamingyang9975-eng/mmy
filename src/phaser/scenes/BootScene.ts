import Phaser from "phaser";

export class BootScene extends Phaser.Scene {
  constructor() {
    super("boot");
  }

  create(): void {
    const g = this.add.graphics();

    g.fillStyle(0x81e3ff, 1);
    g.fillRoundedRect(0, 0, 12, 12, 3);
    g.generateTexture("player-chip", 12, 12);
    g.clear();

    g.fillStyle(0x5e6878, 1);
    g.fillCircle(7, 7, 7);
    g.generateTexture("drone-chip", 14, 14);
    g.clear();

    g.fillStyle(0xf3b95a, 1);
    g.fillRoundedRect(0, 0, 10, 14, 2);
    g.fillStyle(0x1c2130, 0.8);
    g.fillRect(3, 2, 4, 10);
    g.generateTexture("battery-chip", 10, 14);
    g.destroy();

    this.scene.start("game");
  }
}
