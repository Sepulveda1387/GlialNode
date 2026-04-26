import { ValidationError } from "../core/errors.js";

export type DashboardDistributionTier = "oss_local" | "paid_team";

export type DashboardCapability =
  | "local_metrics_sqlite"
  | "local_json_cli"
  | "local_static_html"
  | "local_read_only_http"
  | "seeded_demo_fixture"
  | "hosted_team_dashboard"
  | "supabase_project_backend"
  | "postgres_team_storage"
  | "subscription_billing"
  | "org_role_access_control"
  | "cross_user_tenancy";

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

export const PAID_TEAM_DASHBOARD_CAPABILITIES: readonly DashboardCapability[] = [
  "hosted_team_dashboard",
  "supabase_project_backend",
  "postgres_team_storage",
  "subscription_billing",
  "org_role_access_control",
  "cross_user_tenancy",
];

export function createDashboardDistributionBoundary(
  tier: DashboardDistributionTier = "oss_local",
): DashboardDistributionBoundary {
  if (tier === "paid_team") {
    return {
      tier,
      allowedCapabilities: PAID_TEAM_DASHBOARD_CAPABILITIES,
      reservedCapabilities: [],
      privacyNotes: [
        "Paid team dashboard work must use isolated tenant boundaries before any shared hosted deployment.",
        "Supabase/Postgres, billing, and role-based access remain outside the OSS package until product demand validates them.",
      ],
    };
  }

  return {
    tier,
    allowedCapabilities: OSS_DASHBOARD_CAPABILITIES,
    reservedCapabilities: PAID_TEAM_DASHBOARD_CAPABILITIES,
    privacyNotes: [
      "OSS dashboard capability is local-first, metrics-only, and safe to run without a hosted backend.",
      "Hosted team dashboards, Supabase/Postgres team storage, subscriptions, roles, and org tenancy are reserved for the paid path.",
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

  for (const capability of PAID_TEAM_DASHBOARD_CAPABILITIES) {
    if (boundary.allowedCapabilities.includes(capability)) {
      throw new ValidationError(`OSS dashboard boundary must not allow paid capability '${capability}'.`);
    }
    if (!boundary.reservedCapabilities.includes(capability)) {
      throw new ValidationError(`OSS dashboard boundary must reserve paid capability '${capability}'.`);
    }
  }
}
