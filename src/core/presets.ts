import type { MemorySpaceSettings } from "./types.js";

export type SpacePresetName =
  | "balanced-default"
  | "execution-first"
  | "conservative-review"
  | "planning-heavy";

export interface SpacePresetDefinition {
  name: string;
  summary: string;
  version?: string;
  author?: string;
  source?: string;
  createdAt?: string;
  updatedAt?: string;
  settings: MemorySpaceSettings;
}

export interface SpacePresetSettingChange {
  path: string;
  left: unknown;
  right: unknown;
}

export interface SpacePresetDiff {
  left: {
    name: string;
    version?: string;
    source?: string;
  };
  right: {
    name: string;
    version?: string;
    source?: string;
  };
  metadata: SpacePresetSettingChange[];
  settings: SpacePresetSettingChange[];
}

export const spacePresets: Record<SpacePresetName, MemorySpaceSettings> = {
  "balanced-default": {},
  "execution-first": {
    compaction: {
      shortPromoteImportanceMin: 0.78,
      shortPromoteConfidenceMin: 0.72,
      midPromoteImportanceMin: 0.82,
      midPromoteConfidenceMin: 0.76,
      midPromoteFreshnessMin: 0.5,
      archiveImportanceMax: 0.32,
      archiveConfidenceMax: 0.45,
      archiveFreshnessMax: 0.32,
    },
    routing: {
      preferReviewerOnContested: true,
      preferReviewerOnStale: false,
      staleThreshold: 0.3,
      preferExecutorOnActionable: true,
      preferPlannerOnDistilled: false,
    },
    decay: {
      enabled: true,
      minAgeDays: 10,
      confidenceDecayPerDay: 0.008,
      freshnessDecayPerDay: 0.015,
    },
    reinforcement: {
      enabled: true,
      confidenceBoost: 0.1,
      freshnessBoost: 0.14,
    },
  },
  "conservative-review": {
    compaction: {
      shortPromoteImportanceMin: 0.88,
      shortPromoteConfidenceMin: 0.82,
      midPromoteImportanceMin: 0.9,
      midPromoteConfidenceMin: 0.84,
      midPromoteFreshnessMin: 0.62,
      archiveImportanceMax: 0.24,
      archiveConfidenceMax: 0.35,
      archiveFreshnessMax: 0.24,
      distillSupersedeSources: false,
    },
    conflict: {
      enabled: true,
      minTokenOverlap: 2,
      confidencePenalty: 0.2,
    },
    decay: {
      enabled: true,
      minAgeDays: 7,
      confidenceDecayPerDay: 0.015,
      freshnessDecayPerDay: 0.025,
      minConfidence: 0.25,
      minFreshness: 0.2,
    },
    routing: {
      preferReviewerOnContested: true,
      preferReviewerOnStale: true,
      staleThreshold: 0.4,
      preferExecutorOnActionable: false,
      preferPlannerOnDistilled: true,
    },
  },
  "planning-heavy": {
    compaction: {
      distillMinClusterSize: 2,
      distillMinTokenOverlap: 2,
      distillSupersedeSources: false,
      distillSupersedeMinConfidence: 0.9,
    },
    routing: {
      preferReviewerOnContested: true,
      preferReviewerOnStale: true,
      staleThreshold: 0.35,
      preferExecutorOnActionable: false,
      preferPlannerOnDistilled: true,
    },
    reinforcement: {
      enabled: true,
      confidenceBoost: 0.06,
      freshnessBoost: 0.1,
    },
    retentionDays: {
      short: 10,
      mid: 45,
      long: 120,
    },
  },
};

const presetSummaries: Record<SpacePresetName, string> = {
  "balanced-default": "Keeps GlialNode close to the default tiering, routing, and maintenance posture.",
  "execution-first": "Biases memory toward actionable handoff, faster promotion, and execution-oriented routing.",
  "conservative-review": "Prefers reviewer routing, slower archival, and more cautious trust management for risky memory.",
  "planning-heavy": "Keeps more distilled context available and favors planner-oriented recall over execution routing.",
};

export function isSpacePresetName(value: string | undefined): value is SpacePresetName {
  if (!value) {
    return false;
  }

  return value in spacePresets;
}

export function getSpacePreset(name: SpacePresetName): MemorySpaceSettings {
  return structuredClone(spacePresets[name]);
}

export function getSpacePresetDefinition(name: SpacePresetName): SpacePresetDefinition {
  const timestamp = "built-in";
  return {
    name,
    summary: presetSummaries[name],
    version: "1.0.0",
    source: "built-in",
    createdAt: timestamp,
    updatedAt: timestamp,
    settings: getSpacePreset(name),
  };
}

export function listSpacePresetDefinitions(): SpacePresetDefinition[] {
  return (Object.keys(spacePresets) as SpacePresetName[]).map((name) => getSpacePresetDefinition(name));
}

export function parseSpacePresetDefinition(value: string): SpacePresetDefinition {
  const parsed = JSON.parse(value) as unknown;

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Preset must be a JSON object.");
  }

  const candidate = parsed as Partial<SpacePresetDefinition>;
  if (!candidate.name || typeof candidate.name !== "string") {
    throw new Error("Preset must include a string name.");
  }

  if (!candidate.summary || typeof candidate.summary !== "string") {
    throw new Error("Preset must include a string summary.");
  }

  if (!candidate.settings || typeof candidate.settings !== "object" || Array.isArray(candidate.settings)) {
    throw new Error("Preset must include a settings object.");
  }

  return {
    name: candidate.name,
    summary: candidate.summary,
    version: candidate.version && typeof candidate.version === "string" ? candidate.version : "1.0.0",
    author: candidate.author && typeof candidate.author === "string" ? candidate.author : undefined,
    source: candidate.source && typeof candidate.source === "string" ? candidate.source : "custom",
    createdAt: candidate.createdAt && typeof candidate.createdAt === "string" ? candidate.createdAt : undefined,
    updatedAt: candidate.updatedAt && typeof candidate.updatedAt === "string" ? candidate.updatedAt : undefined,
    settings: structuredClone(candidate.settings),
  };
}

export function stringifySpacePresetDefinition(preset: SpacePresetDefinition): string {
  return JSON.stringify(preset, null, 2);
}

export function diffSpacePresetDefinitions(
  left: SpacePresetDefinition,
  right: SpacePresetDefinition,
): SpacePresetDiff {
  return {
    left: {
      name: left.name,
      version: left.version,
      source: left.source,
    },
    right: {
      name: right.name,
      version: right.version,
      source: right.source,
    },
    metadata: collectObjectDiffs(
      {
        summary: left.summary,
        version: left.version,
        author: left.author,
        source: left.source,
        createdAt: left.createdAt,
        updatedAt: left.updatedAt,
      },
      {
        summary: right.summary,
        version: right.version,
        author: right.author,
        source: right.source,
        createdAt: right.createdAt,
        updatedAt: right.updatedAt,
      },
    ),
    settings: collectObjectDiffs(left.settings, right.settings, "settings"),
  };
}

function collectObjectDiffs(
  left: unknown,
  right: unknown,
  prefix = "",
): SpacePresetSettingChange[] {
  if (deepEqual(left, right)) {
    return [];
  }

  if (isPlainObject(left) || isPlainObject(right)) {
    const leftObject = isPlainObject(left) ? left : {};
    const rightObject = isPlainObject(right) ? right : {};
    const keys = new Set([...Object.keys(leftObject), ...Object.keys(rightObject)]);

    return [...keys]
      .sort((a, b) => a.localeCompare(b))
      .flatMap((key) =>
        collectObjectDiffs(
          leftObject[key],
          rightObject[key],
          prefix ? `${prefix}.${key}` : key,
        ),
      );
  }

  return [
    {
      path: prefix || "value",
      left,
      right,
    },
  ];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function deepEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
