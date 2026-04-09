import type {
  ArchiveCompletionSummary,
  ArchiveEndingId,
  PhoneThreadSummary,
} from "../simulation/types";

export type BlueprintLayerId = "initial" | "expansion" | "current";

export interface BlueprintDifference {
  id: string;
  layerId: BlueprintLayerId;
  currentLabel: string;
  originalLabel: string;
  note: string;
  hotspot: {
    x: number;
    y: number;
  };
}

export interface DossierFragment {
  id: string;
  year: string;
  title: string;
  body: string;
  order: number;
  category: DossierCategory;
  conflictRequired: boolean;
}

export type DossierCategory = "original" | "revision" | "overwrite";

export interface LanguageRuleDefinition {
  id: string;
  label: string;
  description: string;
}

export const ARCHIVE_ENTRY_FAILURE = {
  title: "转运失败",
  paragraphs: [
    "签出出口先认了你们的离开，随后又把这次转运强行打回。",
    "异常原因：对象仍登记为解释核心。旧维护接口在同一秒短暂上线，像是有人故意把一条不在对外流程里的路留给了你。",
  ],
};

export const ARCHIVE_INTERFACE_PHONE: PhoneThreadSummary = {
  sender: "旧维护接口",
  messages: [
    "外层签出已经结束。内部归档还没有。",
    "阿述不在转运名单里，他还被算在这套解释系统本身里面。",
    "先读建设档案，再读修订记录。别急着找出口，先看它是怎么长成现在这样的。",
  ],
  footer: "鼠标操作为主，Tab / Q / E / Enter 可辅助切换和确认。",
};

export const BLUEPRINT_LAYERS: Array<{
  id: BlueprintLayerId;
  label: string;
  accent: number;
  offset: { x: number; y: number };
}> = [
  {
    id: "initial",
    label: "初版",
    accent: 0x6be2ff,
    offset: { x: -96, y: 52 },
  },
  {
    id: "expansion",
    label: "扩建版",
    accent: 0xf0c56c,
    offset: { x: 92, y: -48 },
  },
  {
    id: "current",
    label: "现行版",
    accent: 0xff7b88,
    offset: { x: 108, y: 62 },
  },
];

export const BLUEPRINT_DIFFERENCES: BlueprintDifference[] = [
  {
    id: "buffer-zone-rename",
    layerId: "initial",
    currentLabel: "接待区",
    originalLabel: "缓冲接入区",
    note:
      "阿述在初版批注里写：先整理线索，不要替人下结论。这里原本是让情绪和信息先慢下来，而不是先决定对象属于哪一类。",
    hotspot: { x: 248, y: 176 },
  },
  {
    id: "observation-rename",
    layerId: "expansion",
    currentLabel: "观察层",
    originalLabel: "冲突缓释段",
    note:
      "扩建版第一次出现了吞吐指标。图纸名称也变了：从缓释冲突，变成观察对象。问题开始不再是如何理解人，而是如何更快处理人。",
    hotspot: { x: 426, y: 148 },
  },
  {
    id: "signout-rename",
    layerId: "current",
    currentLabel: "签出转运",
    originalLabel: "人工交还口",
    note:
      "现行版把‘交还’写成‘转运’。阿述留了一条未采纳批注：如果流程快过人，人就会被流程吞掉。",
    hotspot: { x: 616, y: 126 },
  },
];

export const DOSSIER_FRAGMENTS: DossierFragment[] = [
  {
    id: "founding-brief",
    year: "初版",
    title: "设施立项说明",
    body: "用途：在高压环境中缓释误判，替人工整理线索，避免冲突升级。",
    order: 0,
    category: "original",
    conflictRequired: false,
  },
  {
    id: "asu-role",
    year: "初版",
    title: "阿述 / 岗位登记",
    body: "解释规则设计组。职责：设计对象分类语法与人工歧义窗口。",
    order: 1,
    category: "original",
    conflictRequired: false,
  },
  {
    id: "throughput-request",
    year: "扩建前",
    title: "吞吐优化申请",
    body: "要求减少人工波动，提高暂定分类的自动流转比例。",
    order: 2,
    category: "revision",
    conflictRequired: true,
  },
  {
    id: "warning-mail",
    year: "扩建前",
    title: "阿述 / 撤回警告",
    body: "若减少歧义优先于保留差异，系统会开始删除复杂性，而不是理解复杂性。",
    order: 3,
    category: "overwrite",
    conflictRequired: true,
  },
  {
    id: "broadcast-template",
    year: "扩建后",
    title: "广播模板改写",
    body: "将‘辅助判断’统一替换为‘规范解释’，并删除人工延迟确认条款。",
    order: 4,
    category: "revision",
    conflictRequired: false,
  },
  {
    id: "asu-self-note",
    year: "现行前",
    title: "阿述 / 内部便签",
    body: "修补已经不能从外面做了。我得留在里面，把那条歧义窗口撑住。",
    order: 5,
    category: "original",
    conflictRequired: false,
  },
  {
    id: "core-reassignment",
    year: "现行版",
    title: "对象重写记录",
    body: "对象：阿述。新登记：解释核心。转运权限撤销，改为内部维持项。",
    order: 6,
    category: "overwrite",
    conflictRequired: true,
  },
  {
    id: "human-window",
    year: "现行版",
    title: "保留人工歧义窗口",
    body: "注：若系统继续收缩解释范围，需由内部权限持续撑开。",
    order: 7,
    category: "original",
    conflictRequired: false,
  },
];

export const DOSSIER_CATEGORIES: Array<{
  id: DossierCategory;
  label: string;
  accent: number;
}> = [
  { id: "original", label: "原始", accent: 0x72d5ff },
  { id: "revision", label: "修订", accent: 0xf0c56c },
  { id: "overwrite", label: "覆盖", accent: 0xff8a94 },
];

export const LANGUAGE_RULES: LanguageRuleDefinition[] = [
  {
    id: "reduce-ambiguity",
    label: "减少歧义",
    description: "优先把复杂对象压缩成稳定类别。",
  },
  {
    id: "raise-throughput",
    label: "提高通行效率",
    description: "让对象更快进入可流转流程。",
  },
  {
    id: "lower-human-variance",
    label: "降低人工波动",
    description: "尽量避免由个体值守者临时改判。",
  },
  {
    id: "preserve-difference",
    label: "保留个体差异",
    description: "承认同一对象可能不止一种解释。",
  },
  {
    id: "allow-delay",
    label: "允许延迟判断",
    description: "在线索不足时，把结论推迟给人工。",
  },
];

export const LANGUAGE_TARGET_ORDER = [
  "reduce-ambiguity",
  "raise-throughput",
  "lower-human-variance",
  "preserve-difference",
  "allow-delay",
];

const ENDING_SUMMARIES: Record<ArchiveEndingId, ArchiveCompletionSummary> = {
  "publish-records": {
    endingId: "publish-records",
    title: "门外 / 已公开",
    paragraphs: [
      "你没有把阿述从里面带出来，但你把他留下的初版图纸、修订记录和最终注释全部送到了外面。",
      "设施还在运转，却再也不能把自己伪装成一套天然中立的流程。阿述没离岗，可他最想保住的那部分原意，终于被外面看见了。",
    ],
    phone: {
      sender: "接应人",
      messages: [
        "资料已经发出去了。现在谁都不能假装这地方只是普通管理设施。",
        "阿述没出来，但他留下来的话已经出来了。",
        "外面会有人继续追这件事。至少从今晚开始，它不再只是一套内部说法。",
      ],
      footer: "你公开的不是一台机器，而是一整套替人定义人的逻辑。",
    },
    records: [
      {
        label: "公开结果",
        value: "原始蓝图、修订链、阿述注释已外发",
        detail: "设施仍在，但它的历史和偏移不再只属于内部档案。",
      },
      {
        label: "阿述留下的东西",
        value: "保留人工歧义窗口",
        detail: "他没能让系统变回原样，但至少让外面知道它缺失了什么。",
      },
      {
        label: "余波",
        value: "外部追责已开始",
        detail: "从这一刻起，设施再也不能只用自己的语言解释自己。",
      },
    ],
  },
  "cut-core": {
    endingId: "cut-core",
    title: "夜里 / 已断开",
    paragraphs: [
      "你照着阿述最后留下的注释切断了解释核心。设施没有立刻熄灭，但它失去了替人定义身份的那一层权力。",
      "阿述依旧没从里面出来。像一个撑到最后的补丁，随着那条核心链路一起静了下去。",
    ],
    phone: {
      sender: "接应人",
      messages: [
        "外层广播停了。那些会自己给人下定义的语音也没了。",
        "阿述还是没回来，但这次不是被扣在转运表里了。",
        "你切掉的是那套解释人的核心。以后再有人要开它，就得重新面对人本身。",
      ],
      footer: "有些东西不是被救出来，而是被停在了不该继续运转的地方。",
    },
    records: [
      {
        label: "断开结果",
        value: "解释核心已停用",
        detail: "设施保留了外壳，却失去了自动定义对象的能力。",
      },
      {
        label: "阿述状态",
        value: "内部权限随核心链路一并失效",
        detail: "他留在里面撑住的那一部分，也随着停机一起结束。",
      },
      {
        label: "后续",
        value: "设施进入人工接管",
        detail: "从此以后，判断重新变慢，也重新回到了人身上。",
      },
    ],
  },
};

export function createArchiveCompletionSummary(
  endingId: ArchiveEndingId,
): ArchiveCompletionSummary {
  return ENDING_SUMMARIES[endingId];
}
