import { ValidationError } from "../core/errors.js";
import type { DashboardSnapshot } from "./schema.js";

export type DashboardAccessMode = "local_process" | "local_read_only_http" | "managed_remote";

export type DashboardRedactionRule =
  | "no_prompt_text"
  | "no_completion_text"
  | "no_memory_content"
  | "no_request_response_body"
  | "no_secret_values"
  | "hash_subject_ids";

export interface DashboardPrivacyPolicy {
  readonly accessMode: DashboardAccessMode;
  readonly allowRawText: boolean;
  readonly allowedOrigins: readonly string[];
  readonly redactionRules: readonly DashboardRedactionRule[];
  readonly notes: readonly string[];
}

export const DEFAULT_DASHBOARD_REDACTION_RULES: readonly DashboardRedactionRule[] = [
  "no_prompt_text",
  "no_completion_text",
  "no_memory_content",
  "no_request_response_body",
  "no_secret_values",
];

export function createDefaultDashboardPrivacyPolicy(
  overrides: Partial<DashboardPrivacyPolicy> = {},
): DashboardPrivacyPolicy {
  return {
    accessMode: overrides.accessMode ?? "local_process",
    allowRawText: overrides.allowRawText ?? false,
    allowedOrigins: overrides.allowedOrigins ?? [],
    redactionRules: overrides.redactionRules ?? DEFAULT_DASHBOARD_REDACTION_RULES,
    notes: overrides.notes ?? ["OSS dashboard contracts are local-first and metrics-only by default."],
  };
}

export function assertDashboardPrivacyPolicy(policy: DashboardPrivacyPolicy): void {
  if (policy.accessMode === "managed_remote") {
    throw new ValidationError("Managed remote dashboard access is outside the OSS local dashboard scope.");
  }

  if (policy.accessMode === "local_read_only_http" && policy.allowedOrigins.length === 0) {
    throw new ValidationError("Local read-only HTTP dashboard access must declare allowedOrigins.");
  }

  if (policy.allowRawText) {
    throw new ValidationError("Dashboard privacy policy must keep allowRawText disabled by default.");
  }

  for (const requiredRule of DEFAULT_DASHBOARD_REDACTION_RULES) {
    if (!policy.redactionRules.includes(requiredRule)) {
      throw new ValidationError(`Dashboard privacy policy is missing redaction rule '${requiredRule}'.`);
    }
  }
}

export function assertDashboardSnapshotPrivacy(
  snapshot: DashboardSnapshot,
  policy: DashboardPrivacyPolicy = createDefaultDashboardPrivacyPolicy(),
): void {
  assertDashboardPrivacyPolicy(policy);
  assertNoForbiddenDashboardFields(snapshot);
}

function assertNoForbiddenDashboardFields(value: unknown, path = "snapshot"): void {
  if (value === null || value === undefined) {
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoForbiddenDashboardFields(entry, `${path}[${index}]`));
    return;
  }

  if (typeof value !== "object") {
    return;
  }

  for (const [key, entry] of Object.entries(value)) {
    if (isForbiddenDashboardField(key)) {
      throw new ValidationError(`Dashboard snapshot contains forbidden raw-text field '${path}.${key}'.`);
    }
    assertNoForbiddenDashboardFields(entry, `${path}.${key}`);
  }
}

function isForbiddenDashboardField(key: string): boolean {
  return [
    "prompt",
    "promptText",
    "completion",
    "completionText",
    "content",
    "memoryContent",
    "memoryText",
    "rawText",
    "requestBody",
    "responseBody",
    "secret",
    "secretValue",
    "apiKey",
  ].includes(key);
}
