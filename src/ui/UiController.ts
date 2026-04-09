export interface UiCommands {
  start: () => void;
  resume: () => void;
  restart: () => void;
}

export interface HudViewModel {
  roomName: string;
  interpretation: string;
  terminalMode: string;
  carrying: string;
  hint: string;
}

export class UiController {
  private commands: UiCommands | null = null;
  private readonly roomValue: HTMLElement;
  private readonly identityValue: HTMLElement;
  private readonly terminalValue: HTMLElement;
  private readonly carryValue: HTMLElement;
  private readonly hintValue: HTMLElement;
  private readonly modal: HTMLElement;
  private readonly modalTitle: HTMLElement;
  private readonly modalBody: HTMLElement;
  private readonly modalActions: HTMLElement;

  constructor(root: HTMLElement) {
    root.className = "app-shell";

    const frame = document.createElement("div");
    frame.className = "game-frame";

    const gameRoot = document.createElement("div");
    gameRoot.id = "game-root";
    gameRoot.className = "game-root";

    const hud = document.createElement("aside");
    hud.className = "hud-panel";
    hud.setAttribute("aria-label", "状态面板");

    const hudHeader = document.createElement("div");
    hudHeader.className = "hud-header";
    const hudEyebrow = document.createElement("div");
    hudEyebrow.className = "hud-eyebrow";
    hudEyebrow.textContent = "状态面板";
    const hudTitle = document.createElement("h2");
    hudTitle.className = "hud-title";
    hudTitle.textContent = "设施监控";
    hudHeader.append(hudEyebrow, hudTitle);

    const hudScroll = document.createElement("div");
    hudScroll.className = "hud-scroll";

    this.roomValue = this.createMetric(hudScroll, "当前区域");
    this.identityValue = this.createMetric(hudScroll, "当前身份");
    this.terminalValue = this.createMetric(hudScroll, "局部模式");
    this.carryValue = this.createMetric(hudScroll, "携带物");

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
    this.terminalValue.textContent = viewModel.terminalMode;
    this.carryValue.textContent = viewModel.carrying;
    this.hintValue.textContent = viewModel.hint;
  }

  showIntro(): void {
    this.showModal(
      "接入设施",
      [
        "你正潜入一座会持续校验身份与流程的设施。",
        "先在入口外和同伴完成交接，再穿过外门进入设施。",
        "目标：深入设施，找到失联的同伴。",
        "操作：WASD 移动，Shift 慢行，E 拾取/放置，Space 停留示意，R 重置当前房间，Esc 暂停。",
      ],
      [
        {
          label: "开始潜入",
          action: () => this.commands?.start(),
          primary: true,
        },
      ],
    );
  }

  showPause(): void {
    this.showModal(
      "已暂停",
      [
        "你可以继续当前房间，或者直接从头重开三房间切片。",
      ],
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
        "你一路深入设施，靠的不只是躲避巡查，更是顺着它的流程一路通过。",
        "当一套系统能替所有人安排位置时，真正稀缺的反而是偏离流程的余地。",
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
    this.modal.classList.add("hidden");
  }

  private showModal(
    title: string,
    paragraphs: string[],
    actions: Array<{
      label: string;
      action: () => void;
      primary?: boolean;
    }>,
  ): void {
    this.modalTitle.textContent = title;
    this.modalBody.replaceChildren(
      ...paragraphs.map((text) => {
        const paragraph = document.createElement("p");
        paragraph.textContent = text;
        return paragraph;
      }),
    );

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

    this.modal.classList.remove("hidden");
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
}
