# Semantic Retrieval Prototype

GlialNode remains lexical-first by default.

This prototype adds an optional reranking layer that can be enabled explicitly for experiments:

- CLI flags on `memory search|recall|trace|bundle`:
  - `--semantic-prototype true|false`
  - `--semantic-weight <0..1>`
  - `--semantic-gate-report <path>`
  - `--semantic-gate-require-pass true|false`
  - `memory semantic-eval --corpus docs/evals/retrieval-corpus.v1.json --output docs/evals/semantic-eval.latest.json --json`
- Client API:
  - `searchRecords(..., { semantic: { enabled: true, semanticWeight: 0.35 } })`
  - `searchRecords(..., { semantic: { enabled: true, semanticWeight: 0.35, gate: { requirePass: true, passed: report.passed, reportId: report.reportId } } })`
  - `recallRecords(..., { semantic: { enabled: true, semanticWeight: 0.35 } })`
  - `traceRecall(..., { semantic: { enabled: true, semanticWeight: 0.35 } })`
  - `bundleRecall(..., { semantic: { enabled: true, semanticWeight: 0.35 } })`

## Design Notes

- lexical retrieval still runs first (SQLite FTS + existing rank behavior)
- semantic prototype reranks only the already-retrieved candidate set
- gate policy can require a passing eval report before semantic rerank is allowed
- no schema changes
- default behavior is unchanged unless explicitly enabled

## Intended Use

- evaluation and diagnostics when lexical ranking is near a plateau
- controlled A/B testing against retrieval corpus fixtures
- eval-gated opt-in via the generated semantic eval report (`passed=true`)

## Not Intended Yet

- production default routing
- vector database dependency
- remote embedding service calls
