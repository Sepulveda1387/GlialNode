import { ValidationError } from "../core/errors.js";
import { DASHBOARD_SNAPSHOT_SCHEMA_VERSION, type DashboardSnapshotWarning } from "./schema.js";
import type { DashboardMemoryHealthReport } from "./builders.js";

export interface DashboardAlertThresholds {
  readonly memoryHealthWarningBelow: number;
  readonly memoryHealthCriticalBelow: number;
  readonly staleRecordWarningRatio: number;
  readonly staleRecordCriticalRatio: number;
  readonly lowConfidenceWarningRatio: number;
  readonly lowConfidenceCriticalRatio: number;
  readonly backupWarningAgeHours?: number;
  readonly backupCriticalAgeHours?: number;
  readonly databaseWarningBytes?: number;
  readonly databaseCriticalBytes?: number;
}

export interface DashboardAlertThresholdOverrides {
  readonly memoryHealthWarningBelow?: number;
  readonly memoryHealthCriticalBelow?: number;
  readonly staleRecordWarningRatio?: number;
  readonly staleRecordCriticalRatio?: number;
  readonly lowConfidenceWarningRatio?: number;
  readonly lowConfidenceCriticalRatio?: number;
  readonly backupWarningAgeHours?: number;
  readonly backupCriticalAgeHours?: number;
  readonly databaseWarningBytes?: number;
  readonly databaseCriticalBytes?: number;
}

export interface DashboardAlert {
  readonly code: string;
  readonly severity: DashboardSnapshotWarning["severity"];
  readonly message: string;
  readonly source: "memory_health" | "operations" | "threshold_config";
  readonly observedValue?: number | string | boolean;
  readonly threshold?: number;
}

export interface DashboardAlertEvaluationInput {
  readonly generatedAt?: string;
  readonly memoryHealth?: DashboardMemoryHealthReport;
  readonly maintenanceDue?: boolean | null;
  readonly criticalWarnings?: number | null;
  readonly latestBackupAt?: string | null;
  readonly databaseBytes?: number | null;
  readonly thresholds?: DashboardAlertThresholdOverrides;
}

export interface DashboardAlertEvaluation {
  readonly schemaVersion: typeof DASHBOARD_SNAPSHOT_SCHEMA_VERSION;
  readonly generatedAt: string;
  readonly thresholds: DashboardAlertThresholds;
  readonly summary: {
    readonly total: number;
    readonly critical: number;
    readonly warning: number;
    readonly info: number;
    readonly highestSeverity: DashboardSnapshotWarning["severity"] | "none";
  };
  readonly alerts: readonly DashboardAlert[];
}

export const DEFAULT_DASHBOARD_ALERT_THRESHOLDS: DashboardAlertThresholds = {
  memoryHealthWarningBelow: 80,
  memoryHealthCriticalBelow: 60,
  staleRecordWarningRatio: 0.2,
  staleRecordCriticalRatio: 0.5,
  lowConfidenceWarningRatio: 0.15,
  lowConfidenceCriticalRatio: 0.35,
};

export function evaluateDashboardAlerts(input: DashboardAlertEvaluationInput = {}): DashboardAlertEvaluation {
  const thresholds = mergeDashboardAlertThresholds(input.thresholds);
  const alerts: DashboardAlert[] = [];

  if (!input.memoryHealth) {
    alerts.push({
      code: "memory_health_unavailable",
      severity: "info",
      message: "Memory health report is unavailable, so memory quality alerts were not evaluated.",
      source: "memory_health",
    });
  } else {
    alerts.push(...evaluateMemoryHealthAlerts(input.memoryHealth, thresholds));
  }

  if (input.maintenanceDue === true) {
    alerts.push({
      code: "maintenance_due",
      severity: "warning",
      message: "At least one space has no recorded maintenance run.",
      source: "operations",
      observedValue: true,
    });
  }

  if ((input.criticalWarnings ?? 0) > 0) {
    alerts.push({
      code: "critical_warnings_open",
      severity: "critical",
      message: "One or more critical dashboard warnings are open.",
      source: "operations",
      observedValue: input.criticalWarnings ?? 0,
      threshold: 0,
    });
  }

  alerts.push(...evaluateBackupFreshnessAlerts(input.latestBackupAt, thresholds, input.generatedAt));
  alerts.push(...evaluateDatabaseSizeAlerts(input.databaseBytes, thresholds));

  const summary = summarizeAlerts(alerts);
  return {
    schemaVersion: DASHBOARD_SNAPSHOT_SCHEMA_VERSION,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    thresholds,
    summary,
    alerts,
  };
}

export function mergeDashboardAlertThresholds(
  overrides: DashboardAlertThresholdOverrides = {},
): DashboardAlertThresholds {
  const thresholds = {
    memoryHealthWarningBelow: overrides.memoryHealthWarningBelow ?? DEFAULT_DASHBOARD_ALERT_THRESHOLDS.memoryHealthWarningBelow,
    memoryHealthCriticalBelow: overrides.memoryHealthCriticalBelow ?? DEFAULT_DASHBOARD_ALERT_THRESHOLDS.memoryHealthCriticalBelow,
    staleRecordWarningRatio: overrides.staleRecordWarningRatio ?? DEFAULT_DASHBOARD_ALERT_THRESHOLDS.staleRecordWarningRatio,
    staleRecordCriticalRatio: overrides.staleRecordCriticalRatio ?? DEFAULT_DASHBOARD_ALERT_THRESHOLDS.staleRecordCriticalRatio,
    lowConfidenceWarningRatio: overrides.lowConfidenceWarningRatio ?? DEFAULT_DASHBOARD_ALERT_THRESHOLDS.lowConfidenceWarningRatio,
    lowConfidenceCriticalRatio: overrides.lowConfidenceCriticalRatio ?? DEFAULT_DASHBOARD_ALERT_THRESHOLDS.lowConfidenceCriticalRatio,
    backupWarningAgeHours: overrides.backupWarningAgeHours,
    backupCriticalAgeHours: overrides.backupCriticalAgeHours,
    databaseWarningBytes: overrides.databaseWarningBytes,
    databaseCriticalBytes: overrides.databaseCriticalBytes,
  };

  assertPercentThreshold("memoryHealthWarningBelow", thresholds.memoryHealthWarningBelow);
  assertPercentThreshold("memoryHealthCriticalBelow", thresholds.memoryHealthCriticalBelow);
  assertRatioThreshold("staleRecordWarningRatio", thresholds.staleRecordWarningRatio);
  assertRatioThreshold("staleRecordCriticalRatio", thresholds.staleRecordCriticalRatio);
  assertRatioThreshold("lowConfidenceWarningRatio", thresholds.lowConfidenceWarningRatio);
  assertRatioThreshold("lowConfidenceCriticalRatio", thresholds.lowConfidenceCriticalRatio);
  assertOptionalNonNegativeThreshold("backupWarningAgeHours", thresholds.backupWarningAgeHours);
  assertOptionalNonNegativeThreshold("backupCriticalAgeHours", thresholds.backupCriticalAgeHours);
  assertOptionalNonNegativeThreshold("databaseWarningBytes", thresholds.databaseWarningBytes);
  assertOptionalNonNegativeThreshold("databaseCriticalBytes", thresholds.databaseCriticalBytes);

  if (thresholds.memoryHealthCriticalBelow > thresholds.memoryHealthWarningBelow) {
    throw new ValidationError("memoryHealthCriticalBelow cannot be greater than memoryHealthWarningBelow.");
  }
  if (thresholds.staleRecordCriticalRatio < thresholds.staleRecordWarningRatio) {
    throw new ValidationError("staleRecordCriticalRatio cannot be less than staleRecordWarningRatio.");
  }
  if (thresholds.lowConfidenceCriticalRatio < thresholds.lowConfidenceWarningRatio) {
    throw new ValidationError("lowConfidenceCriticalRatio cannot be less than lowConfidenceWarningRatio.");
  }

  return thresholds;
}

function evaluateMemoryHealthAlerts(
  health: DashboardMemoryHealthReport,
  thresholds: DashboardAlertThresholds,
): DashboardAlert[] {
  const alerts: DashboardAlert[] = [];
  const activeRecords = health.activeRecords.value ?? 0;
  const healthScore = health.healthScore.value;

  if (healthScore !== null && healthScore < thresholds.memoryHealthCriticalBelow) {
    alerts.push({
      code: "memory_health_critical",
      severity: "critical",
      message: "Memory health score is below the critical threshold.",
      source: "memory_health",
      observedValue: healthScore,
      threshold: thresholds.memoryHealthCriticalBelow,
    });
  } else if (healthScore !== null && healthScore < thresholds.memoryHealthWarningBelow) {
    alerts.push({
      code: "memory_health_warning",
      severity: "warning",
      message: "Memory health score is below the warning threshold.",
      source: "memory_health",
      observedValue: healthScore,
      threshold: thresholds.memoryHealthWarningBelow,
    });
  }

  const staleRatio = ratio(health.staleRecords.value ?? 0, activeRecords);
  if (staleRatio >= thresholds.staleRecordCriticalRatio) {
    alerts.push({
      code: "stale_memory_critical",
      severity: "critical",
      message: "Stale active records exceed the critical ratio threshold.",
      source: "memory_health",
      observedValue: staleRatio,
      threshold: thresholds.staleRecordCriticalRatio,
    });
  } else if (staleRatio >= thresholds.staleRecordWarningRatio) {
    alerts.push({
      code: "stale_memory_warning",
      severity: "warning",
      message: "Stale active records exceed the warning ratio threshold.",
      source: "memory_health",
      observedValue: staleRatio,
      threshold: thresholds.staleRecordWarningRatio,
    });
  }

  const lowConfidenceRatio = ratio(health.lowConfidenceRecords.value ?? 0, activeRecords);
  if (lowConfidenceRatio >= thresholds.lowConfidenceCriticalRatio) {
    alerts.push({
      code: "low_confidence_memory_critical",
      severity: "critical",
      message: "Low-confidence active records exceed the critical ratio threshold.",
      source: "memory_health",
      observedValue: lowConfidenceRatio,
      threshold: thresholds.lowConfidenceCriticalRatio,
    });
  } else if (lowConfidenceRatio >= thresholds.lowConfidenceWarningRatio) {
    alerts.push({
      code: "low_confidence_memory_warning",
      severity: "warning",
      message: "Low-confidence active records exceed the warning ratio threshold.",
      source: "memory_health",
      observedValue: lowConfidenceRatio,
      threshold: thresholds.lowConfidenceWarningRatio,
    });
  }

  return alerts;
}

function evaluateBackupFreshnessAlerts(
  latestBackupAt: string | null | undefined,
  thresholds: DashboardAlertThresholds,
  generatedAt: string | undefined,
): DashboardAlert[] {
  if (!latestBackupAt || (thresholds.backupWarningAgeHours === undefined && thresholds.backupCriticalAgeHours === undefined)) {
    return [];
  }

  const generatedTime = Date.parse(generatedAt ?? new Date().toISOString());
  const backupTime = Date.parse(latestBackupAt);
  if (!Number.isFinite(generatedTime) || !Number.isFinite(backupTime)) {
    return [
      {
        code: "backup_timestamp_invalid",
        severity: "warning",
        message: "Latest backup timestamp could not be parsed.",
        source: "operations",
        observedValue: latestBackupAt,
      },
    ];
  }

  const ageHours = Math.max(0, (generatedTime - backupTime) / 3_600_000);
  if (thresholds.backupCriticalAgeHours !== undefined && ageHours >= thresholds.backupCriticalAgeHours) {
    return [
      {
        code: "backup_freshness_critical",
        severity: "critical",
        message: "Latest backup is older than the critical freshness threshold.",
        source: "operations",
        observedValue: ageHours,
        threshold: thresholds.backupCriticalAgeHours,
      },
    ];
  }
  if (thresholds.backupWarningAgeHours !== undefined && ageHours >= thresholds.backupWarningAgeHours) {
    return [
      {
        code: "backup_freshness_warning",
        severity: "warning",
        message: "Latest backup is older than the warning freshness threshold.",
        source: "operations",
        observedValue: ageHours,
        threshold: thresholds.backupWarningAgeHours,
      },
    ];
  }
  return [];
}

function evaluateDatabaseSizeAlerts(
  databaseBytes: number | null | undefined,
  thresholds: DashboardAlertThresholds,
): DashboardAlert[] {
  if (databaseBytes === null || databaseBytes === undefined) {
    return [];
  }
  if (thresholds.databaseCriticalBytes !== undefined && databaseBytes >= thresholds.databaseCriticalBytes) {
    return [
      {
        code: "database_size_critical",
        severity: "critical",
        message: "Database size exceeds the critical threshold.",
        source: "operations",
        observedValue: databaseBytes,
        threshold: thresholds.databaseCriticalBytes,
      },
    ];
  }
  if (thresholds.databaseWarningBytes !== undefined && databaseBytes >= thresholds.databaseWarningBytes) {
    return [
      {
        code: "database_size_warning",
        severity: "warning",
        message: "Database size exceeds the warning threshold.",
        source: "operations",
        observedValue: databaseBytes,
        threshold: thresholds.databaseWarningBytes,
      },
    ];
  }
  return [];
}

function summarizeAlerts(alerts: readonly DashboardAlert[]): DashboardAlertEvaluation["summary"] {
  const critical = alerts.filter((alert) => alert.severity === "critical").length;
  const warning = alerts.filter((alert) => alert.severity === "warning").length;
  const info = alerts.filter((alert) => alert.severity === "info").length;
  return {
    total: alerts.length,
    critical,
    warning,
    info,
    highestSeverity: critical > 0 ? "critical" : warning > 0 ? "warning" : info > 0 ? "info" : "none",
  };
}

function ratio(value: number, denominator: number): number {
  if (denominator <= 0) {
    return 0;
  }
  return value / denominator;
}

function assertPercentThreshold(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new ValidationError(`${name} must be between 0 and 100.`);
  }
}

function assertRatioThreshold(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new ValidationError(`${name} must be between 0 and 1.`);
  }
}

function assertOptionalNonNegativeThreshold(name: string, value: number | undefined): void {
  if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
    throw new ValidationError(`${name} must be a non-negative number.`);
  }
}
