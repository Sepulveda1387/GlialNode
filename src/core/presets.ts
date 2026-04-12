import type { MemorySpaceSettings } from "./types.js";

export type SpacePresetName =
  | "balanced-default"
  | "execution-first"
  | "conservative-review"
  | "planning-heavy";

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

export function isSpacePresetName(value: string | undefined): value is SpacePresetName {
  if (!value) {
    return false;
  }

  return value in spacePresets;
}

export function getSpacePreset(name: SpacePresetName): MemorySpaceSettings {
  return structuredClone(spacePresets[name]);
}
