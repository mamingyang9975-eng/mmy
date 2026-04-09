import type { UiController } from "./UiController";

let currentController: UiController | null = null;

export function setUiController(controller: UiController): void {
  currentController = controller;
}

export function getUiController(): UiController {
  if (!currentController) {
    throw new Error("UI controller has not been initialized.");
  }

  return currentController;
}
