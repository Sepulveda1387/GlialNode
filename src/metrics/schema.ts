export const METRICS_SQLITE_SCHEMA_VERSION = 2;

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

export const metricsExecutionContextSql = `
CREATE TABLE IF NOT EXISTS execution_context_records (
  id TEXT PRIMARY KEY,
  fingerprint_method TEXT NOT NULL,
  fingerprint_hash TEXT NOT NULL,
  fingerprint_feature_count INTEGER NOT NULL,
  repo_id TEXT,
  project_id TEXT,
  workflow_id TEXT,
  agent_id TEXT,
  selected_skills_json TEXT NOT NULL,
  selected_tools_json TEXT NOT NULL,
  skipped_tools_json TEXT NOT NULL,
  first_reads_json TEXT NOT NULL,
  outcome_state TEXT NOT NULL,
  latency_ms REAL,
  tool_call_count INTEGER,
  input_tokens INTEGER,
  output_tokens INTEGER,
  outcome_notes_json TEXT NOT NULL,
  confidence TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_execution_context_fingerprint_created
  ON execution_context_records(fingerprint_hash, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_execution_context_scope_created
  ON execution_context_records(repo_id, project_id, workflow_id, agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_execution_context_expires
  ON execution_context_records(expires_at);
`;
