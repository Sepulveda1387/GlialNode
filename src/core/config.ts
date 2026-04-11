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
