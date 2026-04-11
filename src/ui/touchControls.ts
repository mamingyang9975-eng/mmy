export type TouchHoldAction = "speedBoost";

export type TouchPressAction = "interact" | "pause" | "skipPrelude";

type HoldState = Record<TouchHoldAction, boolean>;
type PressQueueState = Record<TouchPressAction, number>;

const movementVector = {
  x: 0,
  y: 0,
};

const holds: HoldState = {
  speedBoost: false,
};

const presses: PressQueueState = {
  interact: 0,
  pause: 0,
  skipPrelude: 0,
};

let touchControlsEnabled = false;

export function setTouchControlsEnabled(enabled: boolean): void {
  touchControlsEnabled = enabled;
  if (!enabled) {
    resetTouchControls();
  }
}

export function areTouchControlsEnabled(): boolean {
  return touchControlsEnabled;
}

export function setTouchMoveVector(x: number, y: number): void {
  const magnitude = Math.hypot(x, y);
  if (magnitude <= 0.0001) {
    movementVector.x = 0;
    movementVector.y = 0;
    return;
  }

  const safeMagnitude = Math.min(1, magnitude);
  movementVector.x = (x / magnitude) * safeMagnitude;
  movementVector.y = (y / magnitude) * safeMagnitude;
}

export function getTouchMoveVector(): { x: number; y: number } {
  if (!touchControlsEnabled) {
    return { x: 0, y: 0 };
  }

  return {
    x: movementVector.x,
    y: movementVector.y,
  };
}

export function setTouchHoldAction(
  action: TouchHoldAction,
  active: boolean,
): void {
  holds[action] = active;
}

export function isTouchHoldActionActive(action: TouchHoldAction): boolean {
  return touchControlsEnabled && holds[action];
}

export function queueTouchPressAction(action: TouchPressAction): void {
  if (!touchControlsEnabled) {
    return;
  }
  presses[action] += 1;
}

export function consumeTouchPressAction(action: TouchPressAction): boolean {
  if (!touchControlsEnabled || presses[action] <= 0) {
    return false;
  }

  presses[action] -= 1;
  return true;
}

export function resetTouchControls(): void {
  movementVector.x = 0;
  movementVector.y = 0;

  for (const action of Object.keys(holds) as TouchHoldAction[]) {
    holds[action] = false;
  }

  for (const action of Object.keys(presses) as TouchPressAction[]) {
    presses[action] = 0;
  }
}
