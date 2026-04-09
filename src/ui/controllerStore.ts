import type { UiController } from "./UiController";

let currentController: UiController | null = null;

export function setUiController(controller: UiController): void {
  currentController = controller;
}

export function getUiController(): UiController {
  if (!currentController) {
    throw new Error("UI 控制器尚未初始化。");
  }

  return currentController;
}
