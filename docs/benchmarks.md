# Benchmarks

This page tracks local benchmark baselines for core GlialNode operations.

Run the harness:

```bash
npm run bench
npm run bench:provenance
```

The harness seeds synthetic datasets and measures median wall-clock time for:
- `search` (`searchRecords`)
- `recall` (`recallRecords`)
- `bundle build` (`bundleRecall`)
- `compaction dry-run` (`maintainSpace(..., apply=false)`)
- `space report` (`getSpaceReport`)

Latest raw output is written to:
- `docs/benchmarks/latest.json`
- `docs/benchmarks/provenance-latest.json`

## Provenance-Heavy Review

Use `npm run bench:provenance` to compare:
- `balanced_mix` (lower provenance ratio)
- `provenance_heavy` (audit-heavy memory mix)

The script reports:
- normal-query latency (`normalSearchMs`)
- provenance-query latency (`provenanceSearchMs`)
- top-result provenance share for normal vs provenance queries

Tuning notes:
- if `normalTopProvenanceShare` grows too high in provenance-heavy runs, prefer executor bundles with `--bundle-provenance-mode minimal` or `auto`
- keep reviewer workflows on `auto`/`preserve` so trust context remains visible
- compare runs by commit on the same machine profile before changing retrieval knobs

### Provenance Baseline (2026-04-17, size=1,500)

All values are milliseconds except share columns.

| Profile | Seed | Normal Search | Provenance Search | Normal Top Provenance Share | Provenance Top Provenance Share |
|---|---:|---:|---:|---:|---:|
| `balanced_mix` | 23,344.128 | 60.621 | 101.307 | 0.000 | 1.000 |
| `provenance_heavy` | 18,152.514 | 59.801 | 64.196 | 0.000 | 1.000 |

## Baseline (2026-04-17)

Environment:
- Node `v24.14.0`
- Platform `win32 x64`
- CPU `13th Gen Intel(R) Core(TM) i5-1335U`
- Memory `~8 GB`

All values are milliseconds.

| Records | Seed | Search | Recall | Bundle Build | Compaction Dry-Run | Report |
|---:|---:|---:|---:|---:|---:|---:|
| 1,000 | 187.503 | 27.221 | 3,437.781 | 215.352 | 51.114 | 2.675 |
| 10,000 | 2,320.223 | 300.038 | 48,277.970 | 3,071.636 | 1,799.303 | 62.406 |
| 50,000 | 12,281.486 | 1,661.308 | 272,242.166 | 17,061.806 | 147,914.104 | 316.647 |

Notes:
- These are local-machine baselines, not universal SLA targets.
- The synthetic dataset intentionally mixes tiers, statuses, and tags so retrieval and maintenance paths are exercised realistically.
- Use this table primarily for regression comparison between commits on the same machine profile.
