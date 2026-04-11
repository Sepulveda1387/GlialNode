export interface GlialNodeConfig {
  defaultSpaceId?: string;
  maxWorkingMemoryRecords: number;
  staleRecordWindowDays: number;
  allowCrossSpaceLinks: boolean;
}

export interface CompactionPolicy {
  shortPromoteImportanceMin: number;
  shortPromoteConfidenceMin: number;
  midPromoteImportanceMin: number;
  midPromoteConfidenceMin: number;
  midPromoteFreshnessMin: number;
  archiveImportanceMax: number;
  archiveConfidenceMax: number;
  archiveFreshnessMax: number;
  distillMinClusterSize: number;
  distillMinTokenOverlap: number;
  distillSupersedeSources: boolean;
  distillSupersedeMinConfidence: number;
}

export interface RetentionPolicy {
  short?: number;
  mid?: number;
  long?: number;
}

export interface ConflictPolicy {
  enabled: boolean;
  minTokenOverlap: number;
  confidencePenalty: number;
}

export interface DecayPolicy {
  enabled: boolean;
  minAgeDays: number;
  confidenceDecayPerDay: number;
  freshnessDecayPerDay: number;
  minConfidence: number;
  minFreshness: number;
}

export interface ReinforcementPolicy {
  enabled: boolean;
  confidenceBoost: number;
  freshnessBoost: number;
  maxConfidence: number;
  maxFreshness: number;
}

export const defaultConfig: GlialNodeConfig = {
  maxWorkingMemoryRecords: 50,
  staleRecordWindowDays: 14,
  allowCrossSpaceLinks: false,
};

export const defaultCompactionPolicy: CompactionPolicy = {
  shortPromoteImportanceMin: 0.8,
  shortPromoteConfidenceMin: 0.75,
  midPromoteImportanceMin: 0.85,
  midPromoteConfidenceMin: 0.8,
  midPromoteFreshnessMin: 0.55,
  archiveImportanceMax: 0.4,
  archiveConfidenceMax: 0.55,
  archiveFreshnessMax: 0.4,
  distillMinClusterSize: 2,
  distillMinTokenOverlap: 2,
  distillSupersedeSources: true,
  distillSupersedeMinConfidence: 0.8,
};

export const defaultRetentionPolicy: RetentionPolicy = {
  short: 7,
  mid: 30,
};

export const defaultConflictPolicy: ConflictPolicy = {
  enabled: true,
  minTokenOverlap: 2,
  confidencePenalty: 0.15,
};

export const defaultDecayPolicy: DecayPolicy = {
  enabled: true,
  minAgeDays: 14,
  confidenceDecayPerDay: 0.01,
  freshnessDecayPerDay: 0.02,
  minConfidence: 0.2,
  minFreshness: 0.15,
};

export const defaultReinforcementPolicy: ReinforcementPolicy = {
  enabled: true,
  confidenceBoost: 0.08,
  freshnessBoost: 0.12,
  maxConfidence: 1,
  maxFreshness: 1,
};
