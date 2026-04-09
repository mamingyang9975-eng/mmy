import type { RoomDefinition } from "../simulation/types";

const SCANNER_VISION_RADIUS = 48;

export const ROOMS: RoomDefinition[] = [
  {
    id: "room-1",
    name: "接入 / 访客登记",
    shortName: "区域 1",
    hint: "门禁先看登记记录。先观察登记面板和访客门各自认什么。",
    signage: [
      "访客记录缺失，门禁保持关闭。",
      "接入对象状态：待登记。",
    ],
    playerSpawn: { x: 48, y: 170 },
    wallRects: [
      { x: 192, y: 0, width: 24, height: 88 },
      { x: 192, y: 128, width: 24, height: 88 },
    ],
    drones: [
      {
        id: "scanner-a",
        label: "扫描机",
        position: { x: 126, y: 118 },
        rule: {
          id: "scanner-a",
          kind: "scanner",
          visionRadius: SCANNER_VISION_RADIUS,
        },
        patrol: {
          speed: 22,
          radius: 22,
          lingerMs: 1500,
        },
      },
    ],
    residents: [],
    doors: [
      {
        id: "north-door",
        label: "访客门",
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
        id: "registration-console-a",
        rect: { x: 108, y: 146, width: 18, height: 18 },
        label: "登记面板",
        prompt: "按 E 登记访客",
        action: "registerVisitor",
      },
    ],
    items: [],
    signalZones: [],
    guidePaths: [],
  },
  {
    id: "room-1b",
    name: "接待 / 缓冲确认",
    shortName: "区域 2",
    hint: "登记只是第一层。前台点头之前，内部门不会跟着改口。",
    signage: [
      "候位区用于人工确认。",
      "确认序列未完成，内部门保持锁闭。",
    ],
    dimensions: {
      width: 448,
      height: 216,
    },
    playerSpawn: { x: 42, y: 170 },
    wallRects: [
      { x: 232, y: 0, width: 24, height: 86 },
      { x: 232, y: 126, width: 24, height: 90 },
    ],
    drones: [
      {
        id: "scanner-b0",
        label: "扫描机",
        position: { x: 150, y: 108 },
        rule: {
          id: "scanner-b0",
          kind: "scanner",
          visionRadius: 50,
        },
        patrol: {
          speed: 22,
          radius: 24,
          lingerMs: 1500,
        },
      },
    ],
    residents: [],
    staff: [
      {
        id: "receptionist-a",
        label: "前台",
        role: "receptionist",
        position: { x: 168, y: 96 },
        deskPoint: { x: 168, y: 96 },
        terminalPoint: { x: 114, y: 146 },
        speed: 20,
        idleMs: 3000,
        checkMs: 1800,
        waitZoneId: "queue-a",
      },
    ],
    doors: [
      {
        id: "reception-door",
        label: "内部门",
        rect: { x: 232, y: 86, width: 24, height: 40 },
        rule: {
          id: "reception-door",
          accepts: ["guidedVisitor"],
          requiresReceptionConfirmed: true,
        },
        exitToNextRoom: true,
      },
    ],
    items: [],
    clues: [
      {
        id: "reception-note",
        rect: { x: 144, y: 152, width: 18, height: 12 },
        label: "前台晚班夹",
        title: "前台晚班备注",
        body: [
          "候位区内静止等待的对象，优先补录到本轮接待名单。",
          "未进入候位区的来访对象，不写入内部门可见记录。",
        ],
        style: "clipboard",
      },
    ],
    signalZones: [],
    waitingZones: [
      {
        id: "queue-a",
        label: "候位区",
        rect: { x: 76, y: 144, width: 52, height: 28 },
      },
    ],
    guidePaths: [
      {
        id: "visitor-route-b0",
        color: "blue",
        activeWhen: "guided",
        tolerance: 14,
        points: [
          { x: 102, y: 158 },
          { x: 132, y: 150 },
          { x: 172, y: 136 },
          { x: 212, y: 118 },
          { x: 228, y: 104 },
        ],
      },
    ],
  },
  {
    id: "room-2",
    name: "服务 / 住户确认",
    shortName: "区域 3",
    hint: "服务门盯着的不止是工单。门侧那一位也在决定你像谁。",
    signage: [
      "主电源槽已锁定，请将服务部件放入侧边托盘。",
      "服务确认来自门侧住户。",
    ],
    playerSpawn: { x: 42, y: 174 },
    wallRects: [
      { x: 214, y: 0, width: 22, height: 86 },
      { x: 214, y: 124, width: 22, height: 92 },
    ],
    drones: [
      {
        id: "scanner-b",
        label: "扫描机",
        position: { x: 140, y: 106 },
        rule: {
          id: "scanner-b",
          kind: "scanner",
          visionRadius: SCANNER_VISION_RADIUS,
          requiresSlowGuide: true,
        },
        patrol: {
          speed: 24,
          radius: 24,
          lingerMs: 1500,
        },
      },
    ],
    residents: [
      {
        id: "resident-b",
        label: "住户",
        position: { x: 168, y: 168 },
        servicePoint: { x: 188, y: 150 },
        speed: 22,
      },
    ],
    staff: [
      {
        id: "porter-b",
        label: "后勤",
        role: "porter",
        position: { x: 76, y: 176 },
        deskPoint: { x: 76, y: 176 },
        terminalPoint: { x: 76, y: 176 },
        speed: 24,
        idleMs: 0,
        checkMs: 0,
        waitZoneId: "",
        pauseMs: 1100,
        influenceRadius: 28,
        routePoints: [
          { x: 76, y: 176 },
          { x: 58, y: 112 },
          { x: 116, y: 112 },
          { x: 176, y: 134 },
          { x: 120, y: 168 },
        ],
      },
    ],
    doors: [
      {
        id: "service-door",
        label: "服务门",
        rect: { x: 214, y: 86, width: 22, height: 38 },
        rule: {
          id: "service-door",
          accepts: ["maintenanceCandidate"],
          requiresTerminalMode: ["maintenanceRequest"],
          requiresFilledSlotsExcluding: ["fault-slot"],
          requiresResidentService: true,
        },
        alternateRules: [
          {
            id: "service-door-fault-visitor",
            accepts: ["guidedVisitor"],
            requiresTerminalMode: ["faultReport"],
            requiresResidentService: true,
            requiresSlowMovement: true,
            maxScores: {
              intruder: 7,
            },
          },
        ],
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
          label: "主电源",
          rect: { x: 66, y: 58, width: 18, height: 18 },
        },
        {
          id: "service-tray",
          label: "服务托盘",
          rect: { x: 40, y: 102, width: 18, height: 18 },
        },
        {
          id: "fault-slot",
          label: "故障槽",
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
    clues: [
      {
        id: "porter-slip",
        rect: { x: 142, y: 182, width: 18, height: 12 },
        label: "后勤交接单",
        title: "后勤口临时交接单",
        body: [
          "搬运电池的缓行对象，可按后勤协作处理。",
          "服务门只在门边确认到住户响应后，才继续放行。",
        ],
        style: "sticker",
      },
    ],
    signalZones: [],
    waitingZones: [],
    guidePaths: [],
  },
  {
    id: "room-3",
    name: "档案 / 护送代价",
    shortName: "区域 4",
    hint: "维修身份能带你进来，但护送机会让出口重新打量你。",
    signage: [
      "维修流程默认附带护送。",
      "检修台会改变当前路线优先级。",
    ],
    dimensions: {
      width: 512,
      height: 216,
    },
    playerSpawn: { x: 44, y: 170 },
    wallRects: [
      { x: 154, y: 0, width: 22, height: 82 },
      { x: 154, y: 126, width: 22, height: 90 },
      { x: 406, y: 0, width: 22, height: 82 },
      { x: 406, y: 126, width: 22, height: 90 },
      { x: 252, y: 54, width: 48, height: 14 },
      { x: 250, y: 148, width: 52, height: 14 },
    ],
    drones: [
      {
        id: "scanner-c",
        label: "扫描机",
        position: { x: 250, y: 104 },
        rule: {
          id: "scanner-c",
          kind: "scanner",
          visionRadius: 52,
        },
        patrol: {
          speed: 24,
          radius: 34,
          lingerMs: 1400,
        },
      },
      {
        id: "escort-c",
        label: "护送机",
        position: { x: 220, y: 104 },
        rule: {
          id: "escort-c",
          kind: "escort",
          visionRadius: 124,
          escortSpawn: { x: 220, y: 104 },
        },
      },
    ],
    residents: [],
    staff: [],
    doors: [
      {
        id: "maintenance-gate",
        label: "维修闸门",
        rect: { x: 154, y: 82, width: 22, height: 44 },
        rule: {
          id: "maintenance-gate",
          accepts: ["maintenanceCandidate"],
          requiresTerminalMode: ["maintenanceRequest"],
          requiresSlowMovement: true,
        },
      },
      {
        id: "service-exit",
        label: "作业出口",
        rect: { x: 406, y: 82, width: 22, height: 44 },
        rule: {
          id: "service-exit",
          accepts: ["maintenanceCandidate"],
          requiresTerminalMode: ["maintenanceRequest"],
          deniesEscort: true,
        },
        exitToNextRoom: true,
      },
    ],
    terminal: {
      id: "terminal-c",
      label: "维修台",
      body: { x: 26, y: 42, width: 92, height: 88 },
      slots: [
        {
          id: "service-tray",
          label: "服务托盘",
          rect: { x: 34, y: 104, width: 18, height: 18 },
        },
        {
          id: "inspection-pad",
          label: "检修台",
          rect: { x: 314, y: 168, width: 20, height: 20 },
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
        position: { x: 76, y: 162 },
      },
      {
        id: "battery-spare",
        itemType: "battery",
        label: "备用电池",
        position: { x: 110, y: 182 },
      },
    ],
    signalZones: [],
    waitingZones: [],
    guidePaths: [
      {
        id: "maint-route-c",
        color: "amber",
        activeWhen: "maintenance",
        tolerance: 14,
        points: [
          { x: 92, y: 150 },
          { x: 138, y: 136 },
          { x: 198, y: 118 },
          { x: 278, y: 118 },
          { x: 350, y: 118 },
          { x: 396, y: 104 },
        ],
      },
    ],
    triggers: [
      {
        id: "escort-trigger",
        rect: { x: 188, y: 58, width: 34, height: 94 },
        action: "spawnEscort",
      },
    ],
  },
  {
    id: "room-4",
    name: "观察 / 身份切换",
    shortName: "区域 5",
    hint: "这里能把维修痕迹卸下来，再慢慢把你改写回访客。",
    signage: [
      "广播改派会打断护送节奏。",
      "复核区会重写低置信记录。",
    ],
    dimensions: {
      width: 640,
      height: 216,
    },
    playerSpawn: { x: 44, y: 170 },
    wallRects: [
      { x: 160, y: 0, width: 22, height: 82 },
      { x: 160, y: 126, width: 22, height: 90 },
      { x: 552, y: 0, width: 22, height: 82 },
      { x: 552, y: 126, width: 22, height: 90 },
      { x: 294, y: 52, width: 52, height: 14 },
      { x: 294, y: 148, width: 54, height: 14 },
    ],
    drones: [
      {
        id: "scanner-d",
        label: "扫描机",
        position: { x: 256, y: 104 },
        rule: {
          id: "scanner-d",
          kind: "scanner",
          visionRadius: 52,
        },
        patrol: {
          speed: 24,
          radius: 36,
          lingerMs: 1400,
        },
      },
      {
        id: "escort-d",
        label: "护送机",
        position: { x: 222, y: 104 },
        rule: {
          id: "escort-d",
          kind: "escort",
          visionRadius: 126,
          escortSpawn: { x: 222, y: 104 },
        },
      },
    ],
    residents: [],
    staff: [
      {
        id: "archivist-d",
        label: "档案员",
        role: "archivist",
        position: { x: 430, y: 148 },
        deskPoint: { x: 430, y: 148 },
        terminalPoint: { x: 430, y: 148 },
        speed: 30,
        idleMs: 0,
        checkMs: 0,
        waitZoneId: "",
        pauseMs: 1200,
        influenceRadius: 34,
        routePoints: [
          { x: 430, y: 148 },
          { x: 488, y: 162 },
          { x: 522, y: 114 },
          { x: 362, y: 58 },
          { x: 332, y: 168 },
        ],
      },
    ],
    doors: [
      {
        id: "maintenance-gate",
        label: "维修闸门",
        rect: { x: 160, y: 82, width: 22, height: 44 },
        rule: {
          id: "maintenance-gate",
          accepts: ["maintenanceCandidate"],
          requiresTerminalMode: ["maintenanceRequest"],
          requiresSlowMovement: true,
        },
      },
      {
        id: "archive-exit",
        label: "访客出口",
        rect: { x: 552, y: 82, width: 22, height: 44 },
        rule: {
          id: "archive-exit",
          accepts: ["guidedVisitor"],
          deniesEscort: true,
        },
        exitToNextRoom: true,
      },
    ],
    terminal: {
      id: "terminal-d",
      label: "作业台",
      body: { x: 26, y: 42, width: 92, height: 88 },
      slots: [
        {
          id: "service-tray",
          label: "服务托盘",
          rect: { x: 34, y: 104, width: 18, height: 18 },
        },
        {
          id: "inspection-pad",
          label: "复核台",
          rect: { x: 330, y: 168, width: 20, height: 20 },
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
    consoles: [
      {
        id: "escort-reroute-console",
        rect: { x: 360, y: 46, width: 18, height: 18 },
        label: "广播台",
        prompt: "按 E 改派护送",
        action: "rerouteEscort",
      },
    ],
    items: [
      {
        id: "battery-main",
        itemType: "battery",
        label: "作业电池",
        position: { x: 78, y: 164 },
      },
    ],
    signalZones: [
      {
        id: "archive-signal",
        rect: { x: 470, y: 148, width: 42, height: 30 },
      },
    ],
    waitingZones: [],
    guidePaths: [
      {
        id: "maint-route-d",
        color: "amber",
        activeWhen: "maintenance",
        tolerance: 14,
        points: [
          { x: 92, y: 150 },
          { x: 138, y: 136 },
          { x: 210, y: 118 },
          { x: 292, y: 118 },
          { x: 356, y: 118 },
        ],
      },
      {
        id: "visitor-route-d",
        color: "blue",
        activeWhen: "guided",
        tolerance: 14,
        points: [
          { x: 472, y: 164 },
          { x: 506, y: 164 },
          { x: 530, y: 138 },
          { x: 530, y: 104 },
          { x: 548, y: 104 },
        ],
      },
    ],
    triggers: [
      {
        id: "escort-trigger",
        rect: { x: 192, y: 58, width: 34, height: 94 },
        action: "spawnEscort",
      },
    ],
  },
  {
    id: "room-5",
    name: "办公 / 值班交接",
    shortName: "区域 6",
    hint: "别急着找出口。先看谁能把你写进夜班记录。",
    signage: [
      "交接记录未写入前，不得离层。",
      "低置信对象需在交接区等待。",
    ],
    dimensions: {
      width: 704,
      height: 216,
    },
    playerSpawn: { x: 54, y: 170 },
    wallRects: [
      { x: 176, y: 0, width: 22, height: 82 },
      { x: 176, y: 126, width: 22, height: 90 },
      { x: 622, y: 0, width: 22, height: 82 },
      { x: 622, y: 126, width: 22, height: 90 },
      { x: 286, y: 40, width: 66, height: 16 },
      { x: 286, y: 160, width: 66, height: 16 },
      { x: 448, y: 54, width: 54, height: 14 },
      { x: 448, y: 148, width: 54, height: 14 },
    ],
    drones: [
      {
        id: "scanner-e",
        label: "扫描机",
        position: { x: 372, y: 104 },
        rule: {
          id: "scanner-e",
          kind: "scanner",
          visionRadius: 52,
        },
        patrol: {
          speed: 24,
          radius: 34,
          lingerMs: 1400,
        },
      },
    ],
    residents: [],
    staff: [
      {
        id: "clerk-e",
        label: "夜班文员",
        role: "clerk",
        position: { x: 494, y: 160 },
        deskPoint: { x: 494, y: 160 },
        terminalPoint: { x: 494, y: 160 },
        speed: 26,
        idleMs: 0,
        checkMs: 0,
        waitZoneId: "handover-zone",
        pauseMs: 1400,
        influenceRadius: 34,
        routePoints: [
          { x: 494, y: 160 },
          { x: 540, y: 152 },
          { x: 564, y: 102 },
          { x: 486, y: 54 },
          { x: 404, y: 104 },
        ],
      },
    ],
    doors: [
      {
        id: "handover-exit",
        label: "值班出口",
        rect: { x: 622, y: 82, width: 22, height: 44 },
        rule: {
          id: "handover-exit",
          accepts: ["guidedVisitor"],
          requiresOfficeClearance: true,
          requiresSlowMovement: true,
        },
        exitToNextRoom: true,
      },
    ],
    items: [],
    clues: [
      {
        id: "handover-ledger",
        rect: { x: 500, y: 176, width: 20, height: 12 },
        label: "值班交接簿",
        title: "夜班交接簿",
        body: [
          "夜班文员只记录交接区内完成停留确认的对象。",
          "未写进交接簿的人，不在值班出口放行范围内。",
        ],
        style: "ledger",
      },
    ],
    signalZones: [],
    waitingZones: [
      {
        id: "handover-zone",
        label: "交接区",
        rect: { x: 526, y: 144, width: 48, height: 28 },
      },
    ],
    guidePaths: [
      {
        id: "visitor-route-e",
        color: "blue",
        activeWhen: "guided",
        tolerance: 14,
        points: [
          { x: 538, y: 158 },
          { x: 566, y: 152 },
          { x: 596, y: 138 },
          { x: 614, y: 114 },
          { x: 618, y: 104 },
        ],
      },
    ],
  },
  {
    id: "room-6",
    name: "核心 / 签出转运",
    shortName: "区域 7",
    hint: "签出区先认领出的人，再认被带走的人。",
    signage: [
      "签出记录未完成，对象不得离层。",
      "确认后的签出对象不可中途更换。",
    ],
    dimensions: {
      width: 736,
      height: 216,
    },
    playerSpawn: { x: 52, y: 170 },
    wallRects: [
      { x: 194, y: 0, width: 22, height: 82 },
      { x: 194, y: 126, width: 22, height: 90 },
      { x: 654, y: 0, width: 22, height: 82 },
      { x: 654, y: 126, width: 22, height: 90 },
      { x: 348, y: 40, width: 64, height: 16 },
      { x: 348, y: 160, width: 64, height: 16 },
      { x: 486, y: 52, width: 54, height: 14 },
      { x: 486, y: 150, width: 54, height: 14 },
    ],
    drones: [],
    residents: [
      {
        id: "subject-asu",
        label: "阿述",
        position: { x: 548, y: 168 },
        servicePoint: { x: 612, y: 152 },
        speed: 22,
      },
    ],
    staff: [],
    doors: [
      {
        id: "subject-exit",
        label: "签出出口",
        rect: { x: 654, y: 82, width: 22, height: 44 },
        rule: {
          id: "subject-exit",
          accepts: ["guidedVisitor"],
          requiresResidentService: true,
          requiresSlowMovement: true,
        },
        exitToNextRoom: true,
      },
    ],
    consoles: [
      {
        id: "subject-release-console",
        rect: { x: 98, y: 146, width: 18, height: 18 },
        label: "签出台",
        prompt: "按 E 发起领出",
        action: "releaseSubject",
      },
    ],
    items: [],
    signalZones: [
      {
        id: "subject-signout-zone",
        rect: { x: 74, y: 142, width: 50, height: 30 },
      },
    ],
    waitingZones: [],
    guidePaths: [
      {
        id: "visitor-route-f",
        color: "blue",
        activeWhen: "guided",
        tolerance: 14,
        points: [
          { x: 100, y: 156 },
          { x: 144, y: 150 },
          { x: 212, y: 132 },
          { x: 318, y: 118 },
          { x: 468, y: 118 },
          { x: 610, y: 118 },
          { x: 650, y: 104 },
        ],
      },
    ],
  },
];
