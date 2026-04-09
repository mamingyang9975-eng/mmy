import type { RoomDefinition } from "../simulation/types";

const SCANNER_VISION_RADIUS = 48;

export const ROOMS: RoomDefinition[] = [
  {
    id: "room-1",
    name: "Access / Initial Read",
    shortName: "Room 1",
    hint: "Activate the guide panel, hold Space in the signal zone, then move slowly while the scanner can see you.",
    signage: [
      "Stable and legible behavior is processed first.",
      "Complete guided access before approaching the visitor door.",
    ],
    playerSpawn: { x: 48, y: 170 },
    wallRects: [
      { x: 192, y: 0, width: 24, height: 88 },
      { x: 192, y: 128, width: 24, height: 88 },
    ],
    drones: [
      {
        id: "scanner-a",
        label: "Scanner",
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
        label: "Visitor Door",
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
        label: "Guide Panel",
        prompt: "Press E to activate guidance",
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
    name: "Service / Resident Check",
    shortName: "Room 2",
    hint: "Place a battery in the service tray, then wait for the resident to confirm service at the door.",
    signage: [
      "Main power slot locked. Leave service parts in the side tray.",
      "Resident service requests must be confirmed at the door.",
    ],
    playerSpawn: { x: 42, y: 174 },
    wallRects: [
      { x: 214, y: 0, width: 22, height: 86 },
      { x: 214, y: 124, width: 22, height: 92 },
    ],
    drones: [
      {
        id: "scanner-b",
        label: "Scanner",
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
        label: "Resident",
        position: { x: 168, y: 168 },
        servicePoint: { x: 188, y: 150 },
        speed: 22,
      },
    ],
    doors: [
      {
        id: "service-door",
        label: "Service Door",
        rect: { x: 214, y: 86, width: 22, height: 38 },
        rule: {
          id: "service-door",
          accepts: ["maintenanceCandidate"],
          requiresTerminalMode: ["maintenanceRequest"],
          requiresFilledSlotsExcluding: ["fault-slot"],
          requiresResidentService: true,
        },
        exitToNextRoom: true,
      },
    ],
    terminal: {
      id: "terminal-b",
      label: "Service Terminal",
      body: { x: 32, y: 44, width: 90, height: 86 },
      slots: [
        {
          id: "power-slot",
          label: "Main Power",
          rect: { x: 66, y: 58, width: 18, height: 18 },
        },
        {
          id: "service-tray",
          label: "Service Tray",
          rect: { x: 40, y: 102, width: 18, height: 18 },
        },
        {
          id: "fault-slot",
          label: "Fault Slot",
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
        label: "Battery A",
        position: { x: 72, y: 164 },
      },
      {
        id: "battery-b",
        itemType: "battery",
        label: "Battery B",
        position: { x: 104, y: 186 },
      },
    ],
    signalZones: [],
    guidePaths: [],
  },
  {
    id: "room-3",
    name: "Archive / Escort Cost",
    shortName: "Room 3",
    hint: "Use maintenance access to cross the first gate, then carry the spare battery to the inspection pad to pull the escort off the route.",
    signage: [
      "Maintenance traffic is escorted by default.",
      "Deliver spare parts to the inspection pad before advancing.",
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
        label: "Scanner",
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
        label: "Escort",
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
    doors: [
      {
        id: "maintenance-gate",
        label: "Maintenance Gate",
        rect: { x: 154, y: 82, width: 22, height: 44 },
        rule: {
          id: "maintenance-gate",
          accepts: ["maintenanceCandidate"],
          requiresTerminalMode: ["maintenanceRequest"],
          requiresSlowInDroneRange: true,
        },
      },
      {
        id: "service-exit",
        label: "Work Exit",
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
      label: "Maintenance Desk",
      body: { x: 26, y: 42, width: 92, height: 88 },
      slots: [
        {
          id: "service-tray",
          label: "Service Tray",
          rect: { x: 34, y: 104, width: 18, height: 18 },
        },
        {
          id: "inspection-pad",
          label: "Inspection Pad",
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
        label: "Main Battery",
        position: { x: 76, y: 162 },
      },
      {
        id: "battery-spare",
        itemType: "battery",
        label: "Spare Battery",
        position: { x: 110, y: 182 },
      },
    ],
    signalZones: [],
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
    name: "Observation / Identity Switch",
    shortName: "Room 4",
    hint: "Enter as maintenance, use the broadcast console to shed the local work order, then switch yourself back into visitor flow.",
    signage: [
      "Maintenance tickets keep an escort attached.",
      "Visitor exit accepts guided visitors only.",
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
        label: "Scanner",
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
        label: "Escort",
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
    doors: [
      {
        id: "maintenance-gate",
        label: "Maintenance Gate",
        rect: { x: 160, y: 82, width: 22, height: 44 },
        rule: {
          id: "maintenance-gate",
          accepts: ["maintenanceCandidate"],
          requiresTerminalMode: ["maintenanceRequest"],
          requiresSlowInDroneRange: true,
        },
      },
      {
        id: "archive-exit",
        label: "Visitor Exit",
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
      label: "Work Desk",
      body: { x: 26, y: 42, width: 92, height: 88 },
      slots: [
        {
          id: "service-tray",
          label: "Service Tray",
          rect: { x: 34, y: 104, width: 18, height: 18 },
        },
        {
          id: "inspection-pad",
          label: "Review Pad",
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
        label: "Broadcast",
        prompt: "Press E to reroute escort",
        action: "rerouteEscort",
      },
    ],
    items: [
      {
        id: "battery-main",
        itemType: "battery",
        label: "Work Battery",
        position: { x: 78, y: 164 },
      },
    ],
    signalZones: [
      {
        id: "archive-signal",
        rect: { x: 470, y: 148, width: 42, height: 30 },
      },
    ],
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
];
