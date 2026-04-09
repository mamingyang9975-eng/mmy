import type { RoomDefinition } from "../simulation/types";

export const ROOMS: RoomDefinition[] = [
  {
    id: "room-1",
    name: "接入区 / 读懂系统",
    shortName: "房间 1",
    hint: "先按 E 激活引导面板，再在感应区按住空格示意；之后在巡逻机范围内保持慢行。",
    signage: [
      "本设施不判断对错，仅减少表达歧义。",
      "访客接入前，请先启用引导面板。",
    ],
    playerSpawn: { x: 48, y: 170 },
    wallRects: [
      { x: 192, y: 0, width: 24, height: 88 },
      { x: 192, y: 128, width: 24, height: 88 },
    ],
    drones: [
      {
        id: "scanner-a",
        label: "巡逻机",
        position: { x: 126, y: 118 },
        rule: {
          id: "scanner-a",
          kind: "scanner",
          visionRadius: 70,
        },
        patrol: {
          speed: 24,
          points: [
            { x: 126, y: 118 },
            { x: 166, y: 118 },
          ],
        },
      },
    ],
    doors: [
      {
        id: "north-door",
        label: "访客门禁",
        rect: { x: 192, y: 88, width: 24, height: 40 },
        rule: {
          id: "north-door",
          accepts: ["guidedVisitor"],
        },
        exitToNextRoom: true,
      },
    ],
    consoles: [
      {
        id: "guide-console-a",
        rect: { x: 108, y: 146, width: 18, height: 18 },
        label: "引导面板",
        prompt: "按 E 激活引导面板",
        action: "primeGuidance",
      },
    ],
    signalRequiresActivation: true,
    items: [],
    signalZones: [
      {
        id: "entry-signal",
        rect: { x: 64, y: 144, width: 44, height: 28 },
      },
    ],
    guidePaths: [],
  },
  {
    id: "room-2",
    name: "服务层 / 制造误解",
    shortName: "房间 2",
    hint: "终端侧托盘会把你登记成维修流量，红色槽会触发故障上报。",
    signage: ["主电槽锁定。待检件请置于侧托盘。"],
    playerSpawn: { x: 42, y: 174 },
    wallRects: [
      { x: 214, y: 0, width: 22, height: 86 },
      { x: 214, y: 124, width: 22, height: 92 },
    ],
    drones: [
      {
        id: "scanner-b",
        label: "巡逻机",
        position: { x: 140, y: 106 },
        rule: {
          id: "scanner-b",
          kind: "scanner",
          visionRadius: 70,
        },
        patrol: {
          speed: 26,
          points: [
            { x: 140, y: 106 },
            { x: 178, y: 106 },
          ],
        },
      },
    ],
    doors: [
      {
        id: "service-door",
        label: "维修门禁",
        rect: { x: 214, y: 86, width: 22, height: 38 },
        rule: {
          id: "service-door",
          accepts: ["maintenanceCandidate"],
          requiresTerminalMode: ["maintenanceRequest"],
        },
        exitToNextRoom: true,
      },
    ],
    terminal: {
      id: "terminal-b",
      label: "服务终端",
      body: { x: 32, y: 44, width: 90, height: 86 },
      slots: [
        {
          id: "power-slot",
          label: "主电槽",
          rect: { x: 66, y: 58, width: 18, height: 18 },
        },
        {
          id: "service-tray",
          label: "侧托盘",
          rect: { x: 40, y: 102, width: 18, height: 18 },
        },
        {
          id: "fault-slot",
          label: "异常槽",
          rect: { x: 94, y: 102, width: 18, height: 18 },
        },
      ],
      recipes: [
        {
          slotId: "service-tray",
          resultingMode: "maintenanceRequest",
          acceptsItemType: "battery",
        },
        {
          slotId: "fault-slot",
          resultingMode: "faultReport",
          acceptsItemType: "battery",
        },
      ],
    },
    items: [
      {
        id: "battery-a",
        itemType: "battery",
        label: "电池 A",
        position: { x: 72, y: 164 },
      },
      {
        id: "battery-b",
        itemType: "battery",
        label: "电池 B",
        position: { x: 104, y: 186 },
      },
    ],
    signalZones: [],
    guidePaths: [
      {
        id: "maintenance-route",
        color: "amber",
        activeWhen: "maintenance",
        tolerance: 14,
        points: [
          { x: 48, y: 112 },
          { x: 92, y: 112 },
          { x: 146, y: 110 },
          { x: 214, y: 106 },
        ],
      },
    ],
  },
  {
    id: "room-3",
    name: "归档层 / 双重后果",
    shortName: "房间 3",
    hint: "先借维修身份穿过第一道门，再把护送机引开，重新示意后在可见范围内慢行通过出口。",
    signage: ["维修流量默认护送。离线访客请重新示意。"],
    playerSpawn: { x: 44, y: 170 },
    wallRects: [
      { x: 144, y: 0, width: 20, height: 86 },
      { x: 144, y: 126, width: 20, height: 90 },
      { x: 286, y: 0, width: 20, height: 86 },
      { x: 286, y: 126, width: 20, height: 90 },
    ],
    drones: [
      {
        id: "scanner-c",
        label: "巡逻机",
        position: { x: 74, y: 106 },
        rule: {
          id: "scanner-c",
          kind: "scanner",
          visionRadius: 66,
        },
        patrol: {
          speed: 22,
          points: [
            { x: 74, y: 106 },
            { x: 112, y: 106 },
          ],
        },
      },
      {
        id: "escort-c",
        label: "护送机",
        position: { x: 214, y: 106 },
        rule: {
          id: "escort-c",
          kind: "escort",
          visionRadius: 120,
          escortSpawn: { x: 214, y: 106 },
        },
      },
    ],
    doors: [
      {
        id: "maintenance-gate",
        label: "维修检查门",
        rect: { x: 144, y: 86, width: 20, height: 40 },
        rule: {
          id: "maintenance-gate",
          accepts: ["maintenanceCandidate"],
          requiresTerminalMode: ["maintenanceRequest"],
        },
      },
      {
        id: "archive-exit",
        label: "访客出口",
        rect: { x: 286, y: 86, width: 20, height: 40 },
        rule: {
          id: "archive-exit",
          accepts: ["guidedVisitor"],
          deniesEscort: true,
        },
        exitToNextRoom: true,
      },
    ],
    terminal: {
      id: "terminal-c",
      label: "维保中枢",
      body: { x: 18, y: 42, width: 84, height: 88 },
      slots: [
        {
          id: "service-tray",
          label: "侧托盘",
          rect: { x: 24, y: 106, width: 18, height: 18 },
        },
        {
          id: "inspection-pad",
          label: "检修台",
          rect: { x: 210, y: 152, width: 20, height: 20 },
        },
      ],
      recipes: [
        {
          slotId: "service-tray",
          resultingMode: "maintenanceRequest",
          acceptsItemType: "battery",
        },
      ],
    },
    items: [
      {
        id: "battery-main",
        itemType: "battery",
        label: "主电池",
        position: { x: 72, y: 160 },
      },
      {
        id: "battery-spare",
        itemType: "battery",
        label: "备用电池",
        position: { x: 190, y: 170 },
      },
    ],
    signalZones: [
      {
        id: "archive-signal",
        rect: { x: 316, y: 152, width: 36, height: 28 },
      },
    ],
    guidePaths: [
      {
        id: "maintenance-lane",
        color: "amber",
        activeWhen: "maintenance",
        tolerance: 14,
        points: [
          { x: 42, y: 116 },
          { x: 92, y: 108 },
          { x: 140, y: 106 },
          { x: 154, y: 106 },
        ],
      },
    ],
    triggers: [
      {
        id: "escort-trigger",
        rect: { x: 168, y: 64, width: 28, height: 84 },
        action: "spawnEscort",
      },
    ],
  },
];
