export interface UiCommands {
  start: () => void;
  resume: () => void;
  restart: () => void;
}

export interface HudViewModel {
  roomName: string;
  interpretation: string;
  tendency: string;
  terminalMode: string;
  carrying: string;
  hint: string;
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

export class UiController {
  private commands: UiCommands | null = null;
  private readonly roomValue: HTMLElement;
  private readonly identityValue: HTMLElement;
  private readonly tendencyValue: HTMLElement;
  private readonly overlayIdentityValue: HTMLElement;
  private readonly overlayTendencyValue: HTMLElement;
  private readonly terminalValue: HTMLElement;
  private readonly carryValue: HTMLElement;
  private readonly hintValue: HTMLElement;
  private readonly modal: HTMLElement;
  private readonly modalTitle: HTMLElement;
  private readonly modalBody: HTMLElement;
  private readonly modalActions: HTMLElement;
  private readonly phoneButton: HTMLButtonElement;
  private lastPhoneMessage: PhoneMessageData | null = null;
  private activeModal: ModalState = "hidden";

  constructor(root: HTMLElement) {
    root.className = "app-shell";

    const frame = document.createElement("div");
    frame.className = "game-frame";

    const gameRoot = document.createElement("div");
    gameRoot.id = "game-root";
    gameRoot.className = "game-root";

    const gameOverlay = document.createElement("div");
    gameOverlay.className = "game-overlay";

    const overlayTop = document.createElement("div");
    overlayTop.className = "game-overlay-top";
    const statusStrip = document.createElement("div");
    statusStrip.className = "game-status-strip";
    this.overlayIdentityValue = this.createOverlayMetric(
      statusStrip,
      "当前解释",
    );
    this.overlayTendencyValue = this.createOverlayMetric(
      statusStrip,
      "解释倾向",
    );
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
    overlayBottom.append(this.phoneButton);

    gameOverlay.append(overlayTop, overlayBottom);
    gameRoot.append(gameOverlay);

    const hud = document.createElement("aside");
    hud.className = "hud-panel";
    hud.setAttribute("aria-label", "解释面板");

    const hudHeader = document.createElement("div");
    hudHeader.className = "hud-header";
    const hudEyebrow = document.createElement("div");
    hudEyebrow.className = "hud-eyebrow";
    hudEyebrow.textContent = "解释面板";
    const hudTitle = document.createElement("h2");
    hudTitle.className = "hud-title";
    hudTitle.textContent = "设施读数";
    hudHeader.append(hudEyebrow, hudTitle);

    const hudScroll = document.createElement("div");
    hudScroll.className = "hud-scroll";

    this.roomValue = this.createMetric(hudScroll, "当前区域");
    this.identityValue = this.createMetric(hudScroll, "当前解释");
    this.tendencyValue = this.createMetric(hudScroll, "解释倾向");
    this.terminalValue = this.createMetric(hudScroll, "局部模式");
    this.carryValue = this.createMetric(hudScroll, "携带物品");

    const hintWrap = document.createElement("div");
    hintWrap.className = "hint-wrap";
    const hintLabel = document.createElement("div");
    hintLabel.className = "metric-label";
    hintLabel.textContent = "当前提示";
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
    this.overlayTendencyValue.textContent = viewModel.tendency;
    this.terminalValue.textContent = viewModel.terminalMode;
    this.carryValue.textContent = viewModel.carrying;
    this.hintValue.textContent = viewModel.hint;
  }

  showIntro(): void {
    this.showPhoneMessage(
      "接应人",
      [
        "阿述被弄进去了，消息一直断断续续。",
        "我只能送你到外门。进去看看，人要是还能带出来，就带他走。",
        "别一上来就露怯，像来办事的就行。",
      ],
      "WASD 移动，Shift 慢行，E 交互，Space 停留示意",
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
      ["你可以继续当前房间，或从头重新进入三房间切片。"],
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

  showCompletion(): void {
    this.showModal(
      "观察室",
      [
        "你一路通关，靠的不只是躲避，而是不断塑造系统如何理解你。",
        "这里最危险的从来不只是监控，而是那些流畅到不再被质疑的自动解释。",
      ],
      [
        {
          label: "再来一次",
          action: () => this.commands?.restart(),
          primary: true,
        },
      ],
    );
  }

  hideModal(): void {
    this.modal.className = "modal hidden";
    this.activeModal = "hidden";
    this.updatePhoneButton();
  }

  private showPhoneMessage(
    sender: string,
    messages: string[],
    footer: string,
    actions: ModalAction[],
  ): void {
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
    status.innerHTML = "<span>23:14</span><span>信号正常</span>";

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
    state.textContent = "刚发来 3 条消息";
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
        ? "当前弹窗关闭后可重新打开手机"
        : this.activeModal === "phone"
          ? "手机当前已打开"
          : "重新打开手机";
    this.phoneButton.setAttribute(
      "aria-pressed",
      String(this.activeModal === "phone"),
    );
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
}
