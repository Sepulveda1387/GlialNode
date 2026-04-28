import { ValidationError } from "../core/errors.js";

export type DashboardDistributionTier = "oss_local" | "managed_private";

export type DashboardCapability =
  | "local_metrics_sqlite"
  | "local_json_cli"
  | "local_static_html"
  | "local_read_only_http"
  | "seeded_demo_fixture"
  | "managed_remote_dashboard"
  | "managed_remote_storage"
  | "managed_access_control";

export interface DashboardDistributionBoundary {
  readonly tier: DashboardDistributionTier;
  readonly allowedCapabilities: readonly DashboardCapability[];
  readonly reservedCapabilities: readonly DashboardCapability[];
  readonly privacyNotes: readonly string[];
}

export const OSS_DASHBOARD_CAPABILITIES: readonly DashboardCapability[] = [
  "local_metrics_sqlite",
  "local_json_cli",
  "local_static_html",
  "local_read_only_http",
  "seeded_demo_fixture",
];

export const RESERVED_MANAGED_DASHBOARD_CAPABILITIES: readonly DashboardCapability[] = [
  "managed_remote_dashboard",
  "managed_remote_storage",
  "managed_access_control",
];

export function createDashboardDistributionBoundary(
  tier: DashboardDistributionTier = "oss_local",
): DashboardDistributionBoundary {
  if (tier === "managed_private") {
    return {
      tier,
      allowedCapabilities: RESERVED_MANAGED_DASHBOARD_CAPABILITIES,
      reservedCapabilities: [],
      privacyNotes: [
        "Managed remote dashboard work must define isolation boundaries before any shared deployment.",
        "Managed remote capabilities remain outside the OSS package.",
      ],
    };
  }

  return {
    tier,
    allowedCapabilities: OSS_DASHBOARD_CAPABILITIES,
    reservedCapabilities: RESERVED_MANAGED_DASHBOARD_CAPABILITIES,
    privacyNotes: [
      "OSS dashboard capability is local-first, metrics-only, and safe to run without a hosted backend.",
      "Managed remote dashboard capabilities are outside the OSS scope.",
    ],
  };
}

export function assertDashboardCapabilityAllowed(
  capability: DashboardCapability,
  boundary: DashboardDistributionBoundary = createDashboardDistributionBoundary(),
): void {
  if (!boundary.allowedCapabilities.includes(capability)) {
    throw new ValidationError(
      `Dashboard capability '${capability}' is not allowed in the ${boundary.tier} boundary.`,
    );
  }
}

export function assertOssDashboardBoundary(
  boundary: DashboardDistributionBoundary = createDashboardDistributionBoundary("oss_local"),
): void {
  if (boundary.tier !== "oss_local") {
    throw new ValidationError("OSS dashboard boundary must use tier 'oss_local'.");
  }

  for (const capability of OSS_DASHBOARD_CAPABILITIES) {
    if (!boundary.allowedCapabilities.includes(capability)) {
      throw new ValidationError(`OSS dashboard boundary is missing capability '${capability}'.`);
    }
  }

  for (const capability of RESERVED_MANAGED_DASHBOARD_CAPABILITIES) {
    if (boundary.allowedCapabilities.includes(capability)) {
      throw new ValidationError(`OSS dashboard boundary must not allow managed capability '${capability}'.`);
    }
    if (!boundary.reservedCapabilities.includes(capability)) {
      throw new ValidationError(`OSS dashboard boundary must reserve managed capability '${capability}'.`);
    }
  }
}
