import type { CompletionSummary } from "../game/simulation/types";
import {
  queueTouchPressAction,
  resetTouchControls,
  setTouchControlsEnabled,
  setTouchHoldAction,
  setTouchMoveVector,
} from "./touchControls";

export interface UiCommands {
  start: () => void;
  resume: () => void;
  restart: () => void;
}

export type HudTone =
  | "neutral"
  | "visitor"
  | "maintenance"
  | "intruder"
  | "warning"
  | "success";

export interface HudViewModel {
  roomName: string;
  interpretation: string;
  interpretationTone?: HudTone;
  tendency: string;
  tendencyTone?: HudTone;
  terminalMode: string;
  terminalTone?: HudTone;
  carrying: string;
  hint: string;
  hintTone?: HudTone;
  interactEnabled: boolean;
}

interface ModalAction {
  label: string;
  action: () => void;
  primary?: boolean;
}

interface PhoneMessageData {
  sender: string;
  messages: string[];
  footer: string;
  actions: ModalAction[];
}

type ModalState = "hidden" | "phone" | "generic";

const CLUE_TOAST_DURATION_MS = 3200;

export class UiController {
  private commands: UiCommands | null = null;
  private readonly touchControlsEnabled: boolean;
  private readonly roomValue: HTMLElement;
  private readonly identityValue: HTMLElement;
  private readonly tendencyValue: HTMLElement;
  private readonly overlayIdentityValue: HTMLElement;
  private readonly overlayTendencyValue: HTMLElement;
  private readonly terminalValue: HTMLElement;
  private readonly carryValue: HTMLElement;
  private readonly hintValue: HTMLElement;
  private interactButton!: HTMLButtonElement;
  private readonly modal: HTMLElement;
  private readonly modalTitle: HTMLElement;
  private readonly modalBody: HTMLElement;
  private readonly modalActions: HTMLElement;
  private readonly clueToast: HTMLElement;
  private readonly clueToastTitle: HTMLElement;
  private readonly clueToastBody: HTMLElement;
  private readonly phoneButton: HTMLButtonElement;
  private readonly skipPreludeHint: HTMLDivElement;
  private readonly skipPreludeButton: HTMLButtonElement;
  private lastPhoneMessage: PhoneMessageData | null = null;
  private activeModal: ModalState = "hidden";
  private clueToastTimeoutId: number | null = null;

  constructor(root: HTMLElement) {
    this.touchControlsEnabled = this.detectTouchControls();
    setTouchControlsEnabled(this.touchControlsEnabled);
    document.addEventListener("visibilitychange", this.handleVisibilityChange);
    window.addEventListener("blur", this.handleWindowBlur);

    root.className = "app-shell";

    const frame = document.createElement("div");
    frame.className = "game-frame";

    const gameRoot = document.createElement("div");
    gameRoot.id = "game-root";
    gameRoot.className = "game-root";
    gameRoot.dataset.touchControls = String(this.touchControlsEnabled);

    const gameOverlay = document.createElement("div");
    gameOverlay.className = "game-overlay";

    const overlayTop = document.createElement("div");
    overlayTop.className = "game-overlay-top";
    const statusStrip = document.createElement("div");
    statusStrip.className = "game-status-strip";
    this.overlayIdentityValue = this.createOverlayMetric(statusStrip, "系统印象");
    this.overlayTendencyValue = document.createElement("span");
    this.overlayTendencyValue.hidden = true;
    overlayTop.append(statusStrip);

    const overlayBottom = document.createElement("div");
    overlayBottom.className = "game-overlay-bottom";
    this.phoneButton = document.createElement("button");
    this.phoneButton.type = "button";
    this.phoneButton.className = "game-phone-button";
    this.phoneButton.textContent = "打开手机";
    this.phoneButton.hidden = true;
    this.phoneButton.disabled = true;
    this.phoneButton.addEventListener("click", () => this.reopenPhone());
    const rightActions = document.createElement("div");
    rightActions.className = "game-overlay-actions-right";
    this.skipPreludeHint = document.createElement("div");
    this.skipPreludeHint.className = "game-skip-hint";
    this.skipPreludeHint.textContent = "按 K 跳过";
    this.skipPreludeHint.hidden = true;
    this.skipPreludeButton = document.createElement("button");
    this.skipPreludeButton.type = "button";
    this.skipPreludeButton.className = "game-overlay-button game-overlay-button-warn";
    this.skipPreludeButton.textContent = "跳过前奏";
    this.skipPreludeButton.hidden = true;
    this.skipPreludeButton.addEventListener("click", () => {
      queueTouchPressAction("skipPrelude");
    });
    const touchPauseButton = document.createElement("button");
    touchPauseButton.type = "button";
    touchPauseButton.className = "game-overlay-button";
    touchPauseButton.textContent = "暂停";
    touchPauseButton.hidden = !this.touchControlsEnabled;
    touchPauseButton.addEventListener("click", () => {
      queueTouchPressAction("pause");
    });
    rightActions.append(
      this.skipPreludeHint,
      this.skipPreludeButton,
      touchPauseButton,
    );
    overlayBottom.append(this.phoneButton, rightActions);

    const touchControls = this.createTouchControls();
    gameOverlay.append(overlayTop, overlayBottom);
    gameRoot.append(touchControls);
    gameRoot.append(gameOverlay);

    const hud = document.createElement("aside");
    hud.className = "hud-panel";
    hud.setAttribute("aria-label", "观察记录");

    const hudHeader = document.createElement("div");
    hudHeader.className = "hud-header";
    const hudEyebrow = document.createElement("div");
    hudEyebrow.className = "hud-eyebrow";
    hudEyebrow.textContent = "观察记录";
    const hudTitle = document.createElement("h2");
    hudTitle.className = "hud-title";
    hudTitle.textContent = "你注意到";
    hudHeader.append(hudEyebrow, hudTitle);

    const hudScroll = document.createElement("div");
    hudScroll.className = "hud-scroll";

    this.roomValue = this.createMetric(hudScroll, "此地");
    this.identityValue = this.createMetric(hudScroll, "系统印象");
    this.tendencyValue = this.createMetric(hudScroll, "走势");
    this.terminalValue = this.createMetric(hudScroll, "挂着什么");
    this.carryValue = this.createMetric(hudScroll, "手里带着");

    const hintWrap = document.createElement("div");
    hintWrap.className = "hint-wrap";
    const hintLabel = document.createElement("div");
    hintLabel.className = "metric-label";
    hintLabel.textContent = "最新线索";
    this.hintValue = document.createElement("div");
    this.hintValue.className = "hint-value";
    hintWrap.append(hintLabel, this.hintValue);
    hudScroll.append(hintWrap);
    hud.append(hudHeader, hudScroll);

    this.modal = document.createElement("div");
    this.modal.className = "modal hidden";
    this.modalTitle = document.createElement("h1");
    this.modalTitle.className = "modal-title";
    this.modalBody = document.createElement("div");
    this.modalBody.className = "modal-body";
    this.modalActions = document.createElement("div");
    this.modalActions.className = "modal-actions";
    this.modal.append(this.modalTitle, this.modalBody, this.modalActions);

    this.clueToast = document.createElement("section");
    this.clueToast.className = "clue-toast hidden";
    this.clueToast.setAttribute("aria-live", "polite");
    this.clueToast.setAttribute("role", "status");
    this.clueToastTitle = document.createElement("h2");
    this.clueToastTitle.className = "clue-toast-title";
    this.clueToastBody = document.createElement("div");
    this.clueToastBody.className = "clue-toast-body";
    this.clueToast.append(this.clueToastTitle, this.clueToastBody);
    gameRoot.append(this.clueToast);

    frame.append(gameRoot, hud, this.modal);
    root.append(frame);
  }

  bindCommands(commands: UiCommands): void {
    this.commands = commands;
  }

  renderHud(viewModel: HudViewModel): void {
    this.roomValue.textContent = viewModel.roomName;
    this.identityValue.textContent = viewModel.interpretation;
    this.tendencyValue.textContent = viewModel.tendency;
    this.overlayIdentityValue.textContent = viewModel.interpretation;
    this.overlayTendencyValue.textContent = viewModel.hint;
    this.terminalValue.textContent = viewModel.terminalMode;
    this.carryValue.textContent = viewModel.carrying;
    this.hintValue.textContent = viewModel.hint;

    this.applyTone(this.identityValue, viewModel.interpretationTone);
    this.applyTone(this.overlayIdentityValue, viewModel.interpretationTone);
    this.applyTone(this.tendencyValue, viewModel.tendencyTone);
    this.applyTone(this.terminalValue, viewModel.terminalTone);
    this.applyTone(this.hintValue, viewModel.hintTone);
    this.applyTone(this.overlayTendencyValue, viewModel.hintTone);
    this.interactButton.disabled = !viewModel.interactEnabled;
    this.interactButton.dataset.available = String(viewModel.interactEnabled);
    this.interactButton.setAttribute(
      "aria-disabled",
      String(!viewModel.interactEnabled),
    );
  }

  showIntro(): void {
    this.showPhoneMessage(
      "接应人",
      [
        "阿述被带进去了，消息断断续续。",
        "我只能送你到外门。进去以后别像在躲，像是本来就在这套流程里。",
        "看系统怎么读你，不要只盯出口。",
      ],
      this.touchControlsEnabled
        ? "左下按住会出现半透明轮盘，拖动移动；右下可快走、交互。进入示意区停留片刻会自动示意。"
        : "WASD 移动，Shift 快走，E 交互。进入示意区停留片刻会自动示意。",
      [
        {
          label: "收起手机",
          action: () => this.commands?.start(),
          primary: true,
        },
      ],
    );
  }

  showPause(): void {
    this.showModal(
      "已暂停",
      ["继续当前流程，或从外门重新来一遍。"],
      [
        {
          label: "继续",
          action: () => this.commands?.resume(),
          primary: true,
        },
        {
          label: "重新开始",
          action: () => this.commands?.restart(),
        },
      ],
    );
  }

  showCompletion(summary: CompletionSummary): void {
    this.showPhoneMessage(
      summary.phone.sender,
      summary.phone.messages,
      summary.phone.footer,
      [
        {
          label: "查看回执",
          action: () => this.showCompletionReport(summary),
          primary: true,
        },
        {
          label: "再来一次",
          action: () => this.commands?.restart(),
        },
      ],
    );
  }

  showClue(
    title: string,
    paragraphs: string[],
    onClose: () => void,
  ): void {
    this.showClueToast(title, paragraphs, onClose);
  }

  hideModal(): void {
    this.hideClueToast();
    this.modal.className = "modal hidden";
    this.activeModal = "hidden";
    this.updatePhoneButton();
  }

  setPreludeSkipHintVisible(visible: boolean): void {
    this.skipPreludeHint.hidden = !visible || this.touchControlsEnabled;
    this.skipPreludeButton.hidden = !visible || !this.touchControlsEnabled;
  }

  private showPhoneMessage(
    sender: string,
    messages: string[],
    footer: string,
    actions: ModalAction[],
  ): void {
    this.hideClueToast();
    this.lastPhoneMessage = {
      sender,
      messages: [...messages],
      footer,
      actions: [...actions],
    };
    this.activeModal = "phone";
    this.updatePhoneButton();
    this.modal.className = "modal phone-modal";
    this.modalTitle.textContent = "";

    const shell = document.createElement("div");
    shell.className = "phone-shell";

    const status = document.createElement("div");
    status.className = "phone-status";
    status.innerHTML = "<span>23:14</span><span>信号稳定</span>";

    const chatHeader = document.createElement("div");
    chatHeader.className = "phone-chat-header";

    const avatar = document.createElement("div");
    avatar.className = "phone-avatar";
    avatar.textContent = sender.slice(0, 1);

    const headerText = document.createElement("div");
    headerText.className = "phone-header-text";
    const name = document.createElement("div");
    name.className = "phone-contact";
    name.textContent = sender;
    const state = document.createElement("div");
    state.className = "phone-presence";
    state.textContent = `刚发来 ${messages.length} 条消息`;
    headerText.append(name, state);
    chatHeader.append(avatar, headerText);

    const thread = document.createElement("div");
    thread.className = "phone-thread";

    messages.forEach((text, index) => {
      const row = document.createElement("div");
      row.className = "message-row incoming";

      const bubble = document.createElement("div");
      bubble.className = "message-bubble";
      bubble.textContent = text;
      row.append(bubble);

      if (index === messages.length - 1) {
        const meta = document.createElement("div");
        meta.className = "message-meta";
        meta.textContent = "已送达";
        row.append(meta);
      }

      thread.append(row);
    });

    const hint = document.createElement("div");
    hint.className = "phone-hint";
    hint.textContent = footer;

    shell.append(status, chatHeader, thread, hint);
    this.modalBody.replaceChildren(shell);
    this.renderActions(actions);
    this.modal.classList.remove("hidden");
  }

  private showModal(
    title: string,
    paragraphs: string[],
    actions: ModalAction[],
  ): void {
    this.hideClueToast();
    this.activeModal = "generic";
    this.updatePhoneButton();
    this.modal.className = "modal";
    this.modalTitle.textContent = title;
    this.modalBody.replaceChildren(
      ...paragraphs.map((text) => {
        const paragraph = document.createElement("p");
        paragraph.textContent = text;
        return paragraph;
      }),
    );

    this.renderActions(actions);
    this.modal.classList.remove("hidden");
  }

  private showCompletionReport(summary: CompletionSummary): void {
    this.hideClueToast();
    this.activeModal = "generic";
    this.updatePhoneButton();
    this.modal.className = "modal completion-modal";
    this.modalTitle.textContent = summary.title;

    const paragraphs = summary.paragraphs.map((text) => {
      const paragraph = document.createElement("p");
      paragraph.textContent = text;
      return paragraph;
    });

    const records = document.createElement("div");
    records.className = "completion-records";

    summary.records.forEach((record) => {
      const card = document.createElement("section");
      card.className = "completion-record";

      const label = document.createElement("div");
      label.className = "completion-record-label";
      label.textContent = record.label;

      const value = document.createElement("div");
      value.className = "completion-record-value";
      value.textContent = record.value;

      const detail = document.createElement("div");
      detail.className = "completion-record-detail";
      detail.textContent = record.detail;

      card.append(label, value, detail);
      records.append(card);
    });

    this.modalBody.replaceChildren(...paragraphs, records);
    this.renderActions([
      {
        label: "重看手机",
        action: () => this.showCompletion(summary),
        primary: true,
      },
      {
        label: "再来一次",
        action: () => this.commands?.restart(),
      },
    ]);
    this.modal.classList.remove("hidden");
  }

  private showClueToast(
    title: string,
    paragraphs: string[],
    onClose: () => void,
  ): void {
    this.hideClueToast();
    this.clueToastTitle.textContent = title;
    this.clueToastBody.replaceChildren(
      ...paragraphs.map((text) => {
        const paragraph = document.createElement("p");
        paragraph.textContent = text;
        return paragraph;
      }),
    );
    this.clueToast.classList.remove("hidden");
    this.clueToastTimeoutId = window.setTimeout(() => {
      this.clueToastTimeoutId = null;
      this.hideClueToast();
      onClose();
    }, CLUE_TOAST_DURATION_MS);
  }

  private hideClueToast(): void {
    if (this.clueToastTimeoutId !== null) {
      window.clearTimeout(this.clueToastTimeoutId);
      this.clueToastTimeoutId = null;
    }

    this.clueToast.classList.add("hidden");
  }

  private renderActions(actions: ModalAction[]): void {
    this.modalActions.replaceChildren(
      ...actions.map((item) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = item.primary ? "action primary" : "action";
        button.textContent = item.label;
        button.addEventListener("click", item.action);
        return button;
      }),
    );
  }

  private reopenPhone(): void {
    if (!this.lastPhoneMessage || this.activeModal !== "hidden") {
      return;
    }

    const { sender, messages, footer, actions } = this.lastPhoneMessage;
    this.showPhoneMessage(sender, messages, footer, actions);
  }

  private updatePhoneButton(): void {
    const hasPhoneMessage = this.lastPhoneMessage !== null;
    this.phoneButton.hidden = !hasPhoneMessage;
    this.phoneButton.textContent =
      this.activeModal === "phone" ? "手机已打开" : "打开手机";
    this.phoneButton.disabled = !hasPhoneMessage || this.activeModal !== "hidden";
    this.phoneButton.title =
      this.activeModal === "generic"
        ? "关闭当前弹窗后可重新打开手机"
        : this.activeModal === "phone"
          ? "手机当前已打开"
          : "重新打开手机";
    this.phoneButton.setAttribute(
      "aria-pressed",
      String(this.activeModal === "phone"),
    );
  }

  private createTouchControls(): HTMLDivElement {
    const controls = document.createElement("div");
    controls.className = "touch-controls";
    controls.dataset.enabled = String(this.touchControlsEnabled);

    const joystick = this.createJoystick();

    const actions = document.createElement("div");
    actions.className = "touch-cluster touch-actions";
    const speedBoostButton = this.createHoldButton(
      "快走",
      "touch-button-secondary",
      () => {
        setTouchHoldAction("speedBoost", true);
      },
      () => {
        setTouchHoldAction("speedBoost", false);
      },
    );
    speedBoostButton.classList.add("touch-button-speed");

    const interactButton = this.createPressButton(
      "交互",
      "touch-button-primary",
      () => {
        queueTouchPressAction("interact");
      },
    );
    interactButton.disabled = true;
    interactButton.dataset.available = "false";
    this.interactButton = interactButton;

    actions.append(speedBoostButton, interactButton);

    controls.append(joystick, actions);
    return controls;
  }

  private createJoystick(): HTMLDivElement {
    const zone = document.createElement("div");
    zone.className = "touch-cluster touch-joystick-zone";
    zone.setAttribute("aria-label", "移动触发区");

    const plate = document.createElement("div");
    plate.className = "touch-joystick-plate";
    plate.setAttribute("aria-label", "移动轮盘");
    plate.hidden = true;

    const thumb = document.createElement("div");
    thumb.className = "touch-joystick-thumb";
    plate.append(thumb);

    let activePointerId: number | null = null;
    let originX = 0;
    let originY = 0;

    const updateFromPointer = (event: PointerEvent): void => {
      const rawX = event.clientX - originX;
      const rawY = event.clientY - originY;
      const maxDistance = Math.max(20, plate.offsetWidth * 0.28);
      const distance = Math.hypot(rawX, rawY);
      const scale = distance > maxDistance ? maxDistance / distance : 1;
      const clampedX = rawX * scale;
      const clampedY = rawY * scale;

      setTouchMoveVector(clampedX / maxDistance, clampedY / maxDistance);
      thumb.style.transform = `translate(calc(-50% + ${clampedX}px), calc(-50% + ${clampedY}px))`;
      plate.dataset.active = "true";
    };

    const resetJoystick = (): void => {
      setTouchMoveVector(0, 0);
      thumb.style.transform = "translate(-50%, -50%)";
      plate.hidden = true;
      delete plate.dataset.active;
    };

    const activate = (event: PointerEvent): void => {
      event.preventDefault();
      if (activePointerId !== null) {
        return;
      }

      const zoneRect = zone.getBoundingClientRect();
      originX = event.clientX;
      originY = event.clientY;
      plate.hidden = false;
      plate.style.left = `${originX - zoneRect.left}px`;
      plate.style.top = `${originY - zoneRect.top}px`;

      activePointerId = event.pointerId;
      zone.setPointerCapture(event.pointerId);
      updateFromPointer(event);
    };

    const move = (event: PointerEvent): void => {
      if (event.pointerId !== activePointerId) {
        return;
      }

      event.preventDefault();
      updateFromPointer(event);
    };

    const release = (event?: PointerEvent): void => {
      if (activePointerId === null) {
        return;
      }
      if (event && event.pointerId !== activePointerId) {
        return;
      }

      activePointerId = null;
      resetJoystick();
    };

    zone.addEventListener("pointerdown", activate);
    zone.addEventListener("pointermove", move);
    zone.addEventListener("pointerup", release);
    zone.addEventListener("pointercancel", release);
    zone.addEventListener("lostpointercapture", release);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "visible") {
        release();
      }
    });
    window.addEventListener("blur", () => release());

    resetJoystick();
    zone.append(plate);
    return zone;
  }

  private createPressButton(
    label: string,
    className: string,
    onPress: () => void,
  ): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `touch-button ${className}`;
    button.textContent = label;
    button.addEventListener("pointerdown", (event) => {
      if (button.disabled) {
        return;
      }
      event.preventDefault();
      button.dataset.active = "true";
      onPress();
    });
    const release = (): void => {
      delete button.dataset.active;
    };
    button.addEventListener("pointerup", release);
    button.addEventListener("pointercancel", release);
    button.addEventListener("lostpointercapture", release);
    return button;
  }

  private createHoldButton(
    label: string,
    className: string,
    onHoldStart: () => void,
    onHoldEnd: () => void,
  ): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `touch-button ${className}`;
    button.textContent = label;

    let activePointerId: number | null = null;

    const activate = (event: PointerEvent): void => {
      event.preventDefault();
      if (activePointerId !== null) {
        return;
      }

      activePointerId = event.pointerId;
      button.dataset.active = "true";
      button.setPointerCapture(event.pointerId);
      onHoldStart();
    };

    const release = (event?: PointerEvent): void => {
      if (activePointerId === null) {
        return;
      }
      if (event && event.pointerId !== activePointerId) {
        return;
      }

      activePointerId = null;
      delete button.dataset.active;
      onHoldEnd();
    };

    button.addEventListener("pointerdown", activate);
    button.addEventListener("pointerup", release);
    button.addEventListener("pointercancel", release);
    button.addEventListener("lostpointercapture", release);
    button.addEventListener("pointerleave", release);

    return button;
  }

  private createMetric(parent: HTMLElement, label: string): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "metric";
    const labelNode = document.createElement("div");
    labelNode.className = "metric-label";
    labelNode.textContent = label;
    const valueNode = document.createElement("div");
    valueNode.className = "metric-value";
    wrap.append(labelNode, valueNode);
    parent.append(wrap);
    return valueNode;
  }

  private createOverlayMetric(parent: HTMLElement, label: string): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "game-status-block";
    const labelNode = document.createElement("div");
    labelNode.className = "game-status-label";
    labelNode.textContent = label;
    const valueNode = document.createElement("div");
    valueNode.className = "game-status-value";
    wrap.append(labelNode, valueNode);
    parent.append(wrap);
    return valueNode;
  }

  private applyTone(element: HTMLElement, tone: HudTone | undefined): void {
    if (!tone || tone === "neutral") {
      delete element.dataset.tone;
      return;
    }
    element.dataset.tone = tone;
  }

  private detectTouchControls(): boolean {
    const supportsTouchPoints =
      typeof navigator !== "undefined" && navigator.maxTouchPoints > 0;
    const coarsePointer =
      typeof window !== "undefined" &&
      window.matchMedia("(pointer: coarse), (hover: none)").matches;
    return supportsTouchPoints || coarsePointer;
  }

  private readonly handleVisibilityChange = (): void => {
    if (document.visibilityState !== "visible") {
      resetTouchControls();
    }
  };

  private readonly handleWindowBlur = (): void => {
    resetTouchControls();
  };
}
