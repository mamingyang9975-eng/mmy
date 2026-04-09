import Phaser from "phaser";
import { BootScene } from "./phaser/scenes/BootScene";
import { GameScene } from "./phaser/scenes/GameScene";
import "./styles.css";
import { UiController } from "./ui/UiController";
import { setUiController } from "./ui/controllerStore";

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("App container not found.");
}

const ui = new UiController(app);
setUiController(ui);

new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game-root",
  width: 384,
  height: 216,
  backgroundColor: "#0d1117",
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  render: {
    pixelArt: true,
    antialias: false,
  },
  physics: {
    default: "arcade",
    arcade: {
      gravity: { x: 0, y: 0 },
      debug: false,
    },
  },
  scene: [BootScene, GameScene],
});
