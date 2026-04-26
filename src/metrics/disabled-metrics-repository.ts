import { ConfigurationError } from "../core/errors.js";
import type {
  MetricsRepository,
  RecordExecutionOutcomeInput,
  RecordTokenUsageInput,
  ExecutionContextRecordFilters,
  TokenUsageFilters,
  TokenUsageRecord,
  TokenUsageReport,
  TokenUsageReportOptions,
} from "./repository.js";
import type { ExecutionContextRecord } from "../execution-context/index.js";

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

  async recordExecutionOutcome(_input: RecordExecutionOutcomeInput): Promise<ExecutionContextRecord> {
    throw new ConfigurationError("GlialNode metrics repository is disabled.");
  }

  async listExecutionContextRecords(_filters: ExecutionContextRecordFilters = {}): Promise<ExecutionContextRecord[]> {
    throw new ConfigurationError("GlialNode metrics repository is disabled.");
  }
}

export function createDisabledMetricsRepository(): DisabledMetricsRepository {
  return new DisabledMetricsRepository();
}
