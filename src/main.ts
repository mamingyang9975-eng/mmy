import Phaser from "phaser";
import { BootScene } from "./phaser/scenes/BootScene";
import { GameScene } from "./phaser/scenes/GameScene";
import "./styles.css";
import { UiController } from "./ui/UiController";
import { setUiController } from "./ui/controllerStore";

const app = document.querySelector<HTMLDivElement>("#app");
const DISPLAY_WIDTH = 960;
const DISPLAY_HEIGHT = 540;

if (!app) {
  throw new Error("未找到应用容器。");
}

const ui = new UiController(app);
setUiController(ui);

new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game-root",
  width: DISPLAY_WIDTH,
  height: DISPLAY_HEIGHT,
  backgroundColor: "#0d1117",
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  render: {
    pixelArt: true,
    antialias: false,
    antialiasGL: false,
    roundPixels: false,
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
