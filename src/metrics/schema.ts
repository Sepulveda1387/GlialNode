export const METRICS_SQLITE_SCHEMA_VERSION = 1;

export const metricsBootstrapSql = `
CREATE TABLE IF NOT EXISTS token_usage_records (
  id TEXT PRIMARY KEY,
  space_id TEXT,
  scope_id TEXT,
  agent_id TEXT,
  project_id TEXT,
  workflow_id TEXT,
  operation TEXT NOT NULL,
  provider TEXT,
  model TEXT NOT NULL,
  baseline_tokens INTEGER,
  actual_context_tokens INTEGER,
  glialnode_overhead_tokens INTEGER,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  estimated_saved_tokens INTEGER,
  estimated_saved_ratio REAL,
  latency_ms REAL,
  cost_currency TEXT,
  input_cost REAL,
  output_cost REAL,
  total_cost REAL,
  dimensions_json TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_token_usage_created_at ON token_usage_records(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_token_usage_space_created ON token_usage_records(space_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_token_usage_agent_created ON token_usage_records(agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_token_usage_model_created ON token_usage_records(provider, model, created_at DESC);
`;
