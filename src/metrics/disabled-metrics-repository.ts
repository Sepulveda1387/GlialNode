import { ConfigurationError } from "../core/errors.js";
import type {
  MetricsRepository,
  RecordTokenUsageInput,
  TokenUsageFilters,
  TokenUsageRecord,
  TokenUsageReport,
  TokenUsageReportOptions,
} from "./repository.js";

export class DisabledMetricsRepository implements MetricsRepository {
  async recordTokenUsage(_input: RecordTokenUsageInput): Promise<TokenUsageRecord> {
    throw new ConfigurationError("GlialNode metrics repository is disabled.");
  }

  async listTokenUsage(_filters: TokenUsageFilters = {}): Promise<TokenUsageRecord[]> {
    throw new ConfigurationError("GlialNode metrics repository is disabled.");
  }

  async getTokenUsageReport(_options: TokenUsageReportOptions = {}): Promise<TokenUsageReport> {
    throw new ConfigurationError("GlialNode metrics repository is disabled.");
  }
}

export function createDisabledMetricsRepository(): DisabledMetricsRepository {
  return new DisabledMetricsRepository();
}
