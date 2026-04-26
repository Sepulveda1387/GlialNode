# GlialNode Live Roadmap (GNL)

`GNL` = `GlialNode Notation Language`.
Goal: low-token review, easy append-only updates, fast diffing, compact roadmap maintenance.

## Snapshot

```text
STAT: date=2026-04-24; v1=1.00; vision=0.96; core=0.99; stor=0.94; recall=0.98; trust=1.00; dx=1.00; ops=1.00; docs=1.00
CTX: mode=local_first; db=sqlite; retr=lexical_first; pri=pub_v1>hardening>dx>scale
STATE: repo=public_v1_ready; publish=approved_for_public_testing; tests=green; pack=green; ci=ready
```

## Legend

```text
KEY:S = D done | A active | N next | B blocked | H hold
KEY:PH = V1 now | V1p soon_after_v1 | V2 next_major | RND research
KEY:PR = P0 release_critical | P1 strong_should | P2 useful_next | P3 later
KEY:EF = XS | S | M | L | XL
KEY:AR = CORE | STOR | RETR | TRUST | DX | OPS | TEST | DOC | REL | SEC | PERF | API | DATA | UX
KEY:LINE = TAG:id | S: | PH: | PR: | EF: | AR: | IN: | DOD:[...] | DEP:[...] | RSK:[...] | NXT:[...]
KEY:BP = always_rule
KEY:GT = release_gate
KEY:BASE = completed_baseline
KEY:CK = checklist_item
KEY:SG = implementation_suggestion
RULE: append_new_items; keep_ids_stable; prefer_status_flip_over_line_rewrite
RULE: if_item_done => set S:D and keep DOD/RSK history intact
RULE: if_new_policy/event/hint added => update cli+client+docs+tests in same change
```

## Always Rules

```text
BP:01 | S:D | AR:CORE | RULE: human_txt + compact_txt dual_rep; never compact_only unless data is mechanically reconstructible
BP:02 | S:D | AR:RETR | RULE: lexical_first + metadata_filter_first; add semantic/vector only when eval proves gain
BP:03 | S:D | AR:STOR | RULE: additive_schema_migrations; no silent breaking schema mutation; every schema change gets migration + test + note
BP:04 | S:D | AR:TRUST | RULE: trust_decision => evt + searchable_sum + clear_report_path; no silent trust state change
BP:05 | S:D | AR:CORE | RULE: no_silent_mutation; lifecycle actions must leave inspectable history
BP:06 | S:D | AR:DX | RULE: cli_surface and client_surface should stay conceptually aligned; avoid one-off hidden capability
BP:07 | S:D | AR:TEST | RULE: new feature => repo/client/cli coverage where applicable; minimum_pair=client+cli for behavior features
BP:08 | S:D | AR:SEC | RULE: never log private_key material; never export secret by default; always prefer explicit opt-in
BP:09 | S:D | AR:DX | RULE: default paths and demo flows must stay win/linux/macos safe; avoid shell-specific primary workflow
BP:10 | S:D | AR:RETR | RULE: every new recall hint/annotation should be tested for trace + bundle + routing impact
BP:11 | S:D | AR:TRUST | RULE: preset_bundle trust and memory_snapshot trust stay separate concepts unless unified by explicit format design
BP:12 | S:D | AR:API | RULE: prefer additive APIs; avoid breaking current CLI/client signatures in v1 line
BP:13 | S:D | AR:RETR | RULE: keep reviewer routes context-rich, executor routes lean, planner routes summary-biased
BP:14 | S:D | AR:DATA | RULE: sourceEventId/source provenance should be preserved whenever summaries are system-generated
BP:15 | S:D | AR:STOR | RULE: query input must be escaped/sanitized before FTS execution; never trust raw query tokens
BP:16 | S:D | AR:DX | RULE: machine-readable output matters; human-readable and JSON-like automation surface should not diverge semantically
BP:17 | S:D | AR:DOC | RULE: docs must update in same slice as behavior changes; roadmap should track real repo state only
BP:18 | S:D | AR:REL | RULE: publish only from clean tree + green checks + reviewed roadmap gate
BP:19 | S:N | AR:OBS | RULE: token/cost telemetry must be metrics_only by default; never store raw prompts, completions, retrieved content, or private memory text in metrics
BP:20 | S:N | AR:DATA | RULE: reporting data should stay queryable without polluting semantic memory; prefer separate metrics store for high-volume operational telemetry
BP:21 | S:N | AR:OBS | RULE: dashboard panels must map to explicit operator decisions; no vanity metric panel without a named CEO/CPO/COO decision
BP:22 | S:N | AR:SEC | RULE: before implementing metrics/dashboard storage, pause and ask owner to switch reasoning_level=extra_high because privacy, measurement accuracy, and API contracts are high-risk
```

## Release Gates

```text
GT:V1.PUB | S:D | IN: public_v1_allowed only if all P0(V1)=D; tests=green; pack=green; docs=aligned; publish_docs reviewed; tree=clean | NXT:[completed: PR#1 merged to master; release readiness status=ready with owner approval; public testing allowed]
GT:V1.STAB | S:D | IN: v1_stable tag only if concurrency_story documented; snapshot story versioned; json automation path present | NXT:[completed: write-mode contract docs + versioned snapshot/trust docs + json-envelope schema contract]
GT:V1.SEC | S:D | IN: public trust workflows only if key handling docs + trust store docs + revoke/rotate tests are all current | NXT:[completed: explicit snapshot revoke/rotate regression coverage in cli+client tests and operator trust-lifecycle verification drill]
GT:V2.START | S:D | IN: do not start multi-backend or vector-first expansion until V1.P0 and V1.P1 storage/dx items are closed or consciously deferred | NXT:[completed: prerequisites satisfied and first V2 graph-export slice started]
```

## Completed Baseline

```text
BASE:01 | S:D | AR:CORE | IN: spaces+scopes+records+events+links model shipped
BASE:02 | S:D | AR:STOR | IN: sqlite schema+migrations+fts+wal+busy_timeout+schema_tracking shipped
BASE:03 | S:D | AR:CORE | IN: short/mid/long lifecycle ops shipped via compaction+retention+decay+reinforcement
BASE:04 | S:D | AR:TRUST | IN: preset bundles support checksum+compat_meta+signatures+trust_profiles+trusted_signers+rotation+revocation
BASE:05 | S:D | AR:RETR | IN: recall packs+traces+bundles+annotations+hints+auto_routing shipped
BASE:06 | S:D | AR:TRUST | IN: space provenance defaults + audit events + recallable audit summaries shipped
BASE:07 | S:D | AR:DX | IN: cli + GlialNodeClient both cover core ops
BASE:08 | S:D | AR:DOC | IN: README+architecture+publish/launch docs exist and are usable
BASE:09 | S:D | AR:REL | IN: package/ci/demo surfaces exist and are cross-platform minded
```

## V1 Now

```text
CK:V1.P0.01 | S:D | PH:V1 | PR:P0 | EF:M | AR:STOR | IN: formalize sqlite write_mode contract; expose mode=single_writer|serialized_local; document exact guarantees and non-goals | DOD:[status_cmd, docs, 2proc_stress, no_breaking_api] | DEP:[sqlite_conn] | RSK:[lock_fail, false_safety_claim] | NXT:[completed: runtime contract + status/doctor + contention tests]
CK:V1.P0.02 | S:D | PH:V1 | PR:P0 | EF:M | AR:DATA | IN: version + checksum full memory snapshots/export/import same way preset bundles are versioned | DOD:[snapshot_meta, compat_check, checksum_check, tests] | DEP:[export_import_path] | RSK:[corrupt_import, incompatible_restore] | NXT:[completed: snapshot format v1 metadata/checksum checks]
CK:V1.P0.03 | S:D | PH:V1 | PR:P0 | EF:L | AR:TRUST | IN: optional signature + trust policy for full memory snapshots; keep separate from preset bundle trust model unless later unified | DOD:[sign_export, verify_import, cli+client, docs, tests] | DEP:[V1.P0.02] | RSK:[confused_format, operator_misuse] | NXT:[completed: ed25519 signing + trust profiles for snapshot import]
CK:V1.P0.04 | S:D | PH:V1 | PR:P0 | EF:S | AR:STOR | IN: harden FTS query handling; auto escape/quote risky chars; add hyphen/symbol/phrase regression tests | DOD:[safe_query_builder, test_matrix, note_in_arch] | DEP:[search_repo] | RSK:[fts_parse_fail, weird_match_loss] | NXT:[completed: safe query builder + punctuation regression coverage]
CK:V1.P0.05 | S:D | PH:V1 | PR:P0 | EF:M | AR:DX | IN: add stable machine-readable output mode for high-value CLI flows (`space show/report`, `memory search/recall/trace/bundle`, `preset bundle-show/import`) | DOD:[--json, docs, tests, no_current_text_break] | DEP:[cli_output] | RSK:[automation_fragility] | NXT:[completed: json output across read/report surfaces]
CK:V1.P0.06 | S:D | PH:V1 | PR:P0 | EF:M | AR:SEC | IN: key handling hardening; verify local key/trust files use safe write path + documented permission guidance + zero secret echo | DOD:[fs_notes, secure_write_review, tests where possible] | DEP:[key_registry] | RSK:[secret_leak, operator_copy_error] | NXT:[completed: atomic safe writes + perms guidance + doctor checks]
CK:V1.P0.07 | S:D | PH:V1 | PR:P0 | EF:M | AR:DOC | IN: operator guide for backup/restore/trust/import/export/rotation; one place for safe operational flows | DOD:[docs/operator-guide.md or equivalent, linked from README] | DEP:[V1.P0.02,V1.P0.03] | RSK:[unsafe_ops, hidden_workflows] | NXT:[completed: operator guide published + README linkage]
CK:V1.P0.08 | S:D | PH:V1 | PR:P0 | EF:S | AR:REL | IN: define semver + compatibility policy for CLI/API/schema/snapshot/preset bundle formats | DOD:[compat_notes, README, changelog note] | DEP:[none] | RSK:[publish_confusion] | NXT:[completed: compatibility policy documented]

CK:V1.P1.01 | S:D | PH:V1 | PR:P1 | EF:M | AR:DX | IN: effective policy inspection; show merged space settings + preset/channel/provenance origin in one read path | DOD:[space show/report enhancement, docs, tests] | DEP:[settings_merge] | RSK:[opaque_config] | NXT:[completed: raw+effective+origin via space show/report]
CK:V1.P1.02 | S:D | PH:V1 | PR:P1 | EF:M | AR:OPS | IN: `doctor`/`status` workflow for db runtime, schema ver, preset dir, trust store, signer store, WAL state, path sanity | DOD:[cli cmd, client helper maybe later, docs, smoke test] | DEP:[status surfaces] | RSK:[hard_support, hidden_misconfig] | NXT:[completed: doctor/status cli + json + diagnostics tests]
CK:V1.P1.03 | S:D | PH:V1 | PR:P1 | EF:M | AR:DATA | IN: define import collision semantics for presets/snapshots/records; overwrite vs merge vs rename policy | DOD:[policy doc, validation, tests] | DEP:[import paths] | RSK:[data_dup, accidental_overwrite] | NXT:[completed: explicit collision policy for snapshot/preset imports]
CK:V1.P1.04 | S:D | PH:V1 | PR:P1 | EF:M | AR:OBS | IN: richer space report: event counts by type, provenance summary count, latest maintenance timestamps | DOD:[report ext, docs, tests] | DEP:[space_report] | RSK:[opaque_ops] | NXT:[completed: event counts + provenance summary count + maintenance timestamps]
CK:V1.P1.05 | S:D | PH:V1 | PR:P1 | EF:M | AR:PERF | IN: add benchmark harness for search, recall, bundle build, compaction, report on realistic dataset sizes | DOD:[bench script, baseline numbers, doc note] | DEP:[seed data] | RSK:[perf regressions unseen] | NXT:[completed: scripts/benchmark.mjs + docs/benchmarks.md + latest baseline json]
CK:V1.P1.06 | S:D | PH:V1 | PR:P1 | EF:M | AR:DX | IN: add example integration app/service that embeds GlialNodeClient in realistic loop | DOD:[examples/ app, docs, smoke path] | DEP:[client API] | RSK:[adoption friction] | NXT:[completed: examples/memory-service + npm run example:service smoke path]
CK:V1.P1.07 | S:D | PH:V1 | PR:P1 | EF:S | AR:DOC | IN: create troubleshooting matrix for common failures: lock contention, trust validation fail, signer revoke, query parse, snapshot import fail | DOD:[troubleshooting doc + README link] | DEP:[known failure list] | RSK:[support load] | NXT:[completed: docs/troubleshooting failure matrix + README linkage]
CK:V1.P1.08 | S:D | PH:V1 | PR:P1 | EF:M | AR:TEST | IN: long-run lifecycle tests covering repeated maintain/compact/retain/decay loops over same dataset | DOD:[durable state test suite, no flake] | DEP:[maintenance flows] | RSK:[state drift] | NXT:[completed: deterministic 48-step lifecycle loop in client tests]

CK:V1.P2.01 | S:D | PH:V1 | PR:P2 | EF:M | AR:API | IN: expose lower-level safe query builder + route reasoning helpers for host apps | DOD:[client exports, docs, tests] | DEP:[retrieval] | RSK:[duplicate downstream logic] | NXT:[completed: exported buildSafeFtsQuery + bundle hint/route reasoning helpers]
CK:V1.P2.02 | S:D | PH:V1 | PR:P2 | EF:M | AR:UX | IN: better operator ergonomics for trust review: diff trusted signer sets, show why bundle failed policy in denser table/json | DOD:[bundle-show/report polish] | DEP:[trust report] | RSK:[ops friction] | NXT:[completed: bundle-show requested/unmatched signer sets + trust-explain diagnostics json/text]
CK:V1.P2.03 | S:D | PH:V1 | PR:P2 | EF:S | AR:REL | IN: add release checklist link chain: README -> live roadmap -> launch checklist -> publish guide | DOD:[doc links aligned] | DEP:[this file] | RSK:[doc drift] | NXT:[completed: explicit chain section + checklist links]
CK:V1.P2.04 | S:D | PH:V1 | PR:P2 | EF:S | AR:SEC | IN: explicit data classification note for spaces/records/events/preset secrets | DOD:[security doc section] | DEP:[ops guide] | RSK:[wrong storage assumptions] | NXT:[completed: README + operator-guide data classification section]
CK:V1.P2.05 | S:D | PH:V1 | PR:P2 | EF:M | AR:OBS | IN: maintenance summaries should expose last_run and delta counts in report/status without search | DOD:[report fields, docs, tests] | DEP:[report ext] | RSK:[ops blind spots] | NXT:[completed: maintenance timestamps + phase deltas in report/status]
CK:V1.P2.06 | S:D | PH:V1 | PR:P2 | EF:S | AR:REL | IN: expose release readiness gate as read-only CLI/client report instead of manual-only checklist | DOD:[cli, client, docs, tests] | DEP:[GT:V1.PUB] | RSK:[false_publish_claim] | NXT:[completed: release readiness report keeps publish blocked until tests/pack/docs/tree/user approval are explicitly confirmed]
```

## V1 Soon After

```text
CK:V1p.01 | S:D | PH:V1p | PR:P1 | EF:L | AR:STOR | IN: optional serialized write broker or lightweight write queue for safer local multi-process use | DOD:[adapter path, contention tests, docs] | DEP:[V1.P0.01] | RSK:[complexity creep] | NXT:[completed: SerializedLocalRepository write queue + client/cli writeMode path + contention serialization test]
CK:V1p.02 | S:D | PH:V1p | PR:P1 | EF:M | AR:DATA | IN: snapshot restore preview/dry-run showing counts, conflicts, schema version, trust status before apply | DOD:[preview cmd/api, docs, tests] | DEP:[snapshot meta/trust] | RSK:[unsafe_restore] | NXT:[completed: client previewSnapshotImport + CLI import --preview/json with collision/trust/schema diagnostics]
CK:V1p.03 | S:D | PH:V1p | PR:P1 | EF:M | AR:RETR | IN: provenance-sensitive pruning policy so executor bundles keep only critical trust context while reviewer bundles preserve more | DOD:[policy knob, tests, docs] | DEP:[provenance routing/hints] | RSK:[bundle bloat or missing trust context] | NXT:[completed: bundle-provenance-mode auto|minimal|balanced|preserve with risk-aware preservation floor]
CK:V1p.04 | S:D | PH:V1p | PR:P1 | EF:M | AR:RETR | IN: route-aware bundle shaping should prefer provenance summaries for reviewer bundles and de-prioritize them for executor bundles unless explicit risk present | DOD:[ranking tweak, tests] | DEP:[V1p.03] | RSK:[review noise] | NXT:[completed: reviewer provenance-summary weighting + executor provenance penalty unless risk hints]
CK:V1p.05 | S:D | PH:V1p | PR:P2 | EF:M | AR:TEST | IN: retrieval eval corpus with expected primary/support/route outcomes for core scenarios | DOD:[fixture set, golden assertions] | DEP:[bundle behavior stabilizing] | RSK:[regressions hidden] | NXT:[completed: docs/evals/retrieval-corpus.v1.json + retrieval-eval golden test]
CK:V1p.06 | S:D | PH:V1p | PR:P2 | EF:M | AR:DX | IN: add `examples/agent-loop` or `examples/service` with trust+recall+maintenance cycle | DOD:[realistic sample, docs] | DEP:[V1.P1.06] | RSK:[adoption lag] | NXT:[completed: examples/agent-loop signed export + preview/import anchored trust cycle]
CK:V1p.07 | S:D | PH:V1p | PR:P2 | EF:S | AR:OBS | IN: include provenance memory counts/hints in bundle trace summary for reviewer path | DOD:[trace text update, tests] | DEP:[provenance hints] | RSK:[opaque review context] | NXT:[completed: reviewer trace summary adds provenance memory item count hint]
CK:V1p.08 | S:D | PH:V1p | PR:P2 | EF:M | AR:PERF | IN: index review for provenance-heavy spaces; ensure added audit memory does not distort normal retrieval too aggressively | DOD:[bench + tuning notes] | DEP:[bench harness] | RSK:[audit noise ranking] | NXT:[completed: npm run bench:provenance + docs/benchmarks provenance tuning notes]
CK:V1p.09 | S:D | PH:V1p | PR:P2 | EF:S | AR:DX | IN: provide schema-versioned CLI automation envelope while preserving existing `--json` payload shape for compatibility | DOD:[--json-envelope, tests, docs/json-contract.md, launch/publish checklist linkage] | DEP:[V1.P0.05] | RSK:[automation_breakage] | NXT:[completed: schemaVersion=1.0.0 envelope with command/timestamp/data wrapper]
CK:V1p.10 | S:D | PH:V1p | PR:P2 | EF:S | AR:SEC | IN: expand trust lifecycle regression coverage so snapshot imports explicitly verify revoke/rotate behavior under anchored trust policies | DOD:[cli+client tests, operator drill docs, roadmap alignment] | DEP:[V1.P0.03,V1.P0.06] | RSK:[silent trust drift] | NXT:[completed: snapshot signed-artifact revoke/rotate tests + operator guide trust drill]
```

## V2

```text
CK:V2.01 | S:H | PH:V2 | PR:P2 | EF:XL | AR:STOR | IN: Postgres backend or server-backed source-of-truth for heavier concurrency/team deployments | DOD:[adapter contract, migration path, docs] | DEP:[V1 storage hardening] | RSK:[premature scale work] | NXT:[defer until proven need]
CK:V2.01a | S:D | PH:V2 | PR:P2 | EF:S | AR:STOR | IN: define storage backend adapter contract metadata before any server-backed implementation | DOD:[capability model, validation helper, sqlite declaration, docs, tests] | DEP:[V1 storage hardening] | RSK:[false backend claims] | NXT:[completed: describeStorageAdapter + assertStorageAdapterContract + storage contract/migration-plan cli+client + docs/storage-backends.md + status visibility]
CK:V2.02 | S:D | PH:V2 | PR:P2 | EF:L | AR:RETR | IN: optional semantic retrieval module with eval-gated enablement and hybrid ranking | DOD:[plugin design, eval set, docs] | DEP:[retrieval eval corpus] | RSK:[semantic noise] | NXT:[completed: semantic prototype rerank + client/cli flags + semantic-eval report command + optional gate-pass enforcement]
CK:V2.03 | S:D | PH:V2 | PR:P2 | EF:L | AR:UX | IN: local dashboard / TUI / web inspector for spaces, policies, trust stores, reports, recall traces | DOD:[inspect flows, screenshots, docs] | DEP:[json outputs] | RSK:[ux drag] | NXT:[completed: html+json inspector snapshots, index exports, pack exports, screenshot automation, and optional live-served pack mode]
CK:V2.03a | S:D | PH:V2 | PR:P2 | EF:M | AR:UX | IN: implement first read-only local space inspector export that combines space report, effective policy, trust registry, and graph topology into one standalone artifact | DOD:[client api, cli cmd, docs, tests] | DEP:[V2.03,V2.05a] | RSK:[format drift, ui bloat] | NXT:[completed: buildSpaceInspectorSnapshot + exportSpaceInspectorHtml + CLI space inspect-export + docs/space-inspector.md]
CK:V2.03b | S:D | PH:V2 | PR:P2 | EF:M | AR:UX | IN: extend inspector with trace-centric recall previews and add multi-space index export for fleet-level local review | DOD:[query-aware recall snapshot in inspector, index exporter, cli+client, docs, tests] | DEP:[V2.03a] | RSK:[payload growth, operator confusion] | NXT:[completed: inspect-export --query-* recall preview + inspect-index-export + client index snapshot/html APIs + docs/tests]
CK:V2.03c | S:D | PH:V2 | PR:P2 | EF:M | AR:UX | IN: add portable JSON snapshot artifacts and risk-summary overlays for inspector automation flows | DOD:[single/index snapshot export apis, cli snapshot cmds, risk summary model, docs/tests] | DEP:[V2.03b] | RSK:[schema drift, false-positive risk signals] | NXT:[completed: inspect-snapshot + inspect-index-snapshot + client snapshot file apis + risk level/totals in inspector payloads]
CK:V2.03d | S:D | PH:V2 | PR:P2 | EF:M | AR:UX | IN: add one-shot inspector pack export that emits index + per-space html/json artifacts with a machine-readable manifest for handoff/archive workflows | DOD:[pack api, cli cmd, manifest schema, docs/tests] | DEP:[V2.03c] | RSK:[artifact sprawl, path portability] | NXT:[completed: exportSpaceInspectorPack + CLI inspect-pack-export + manifest/index/per-space artifact generation + docs/tests]
CK:V2.03e | S:D | PH:V2 | PR:P2 | EF:S | AR:UX | IN: add automated screenshot capture for inspector pack artifacts so review handoffs include static visual evidence | DOD:[optional screenshot flag, viewport controls, manifest fields, docs/tests] | DEP:[V2.03d] | RSK:[optional dependency drift] | NXT:[completed: --capture-screenshots + --screenshot-width/height + index/per-space png manifest wiring]
CK:V2.03f | S:D | PH:V2 | PR:P2 | EF:S | AR:UX | IN: add temporary local serving mode for exported inspector packs to support quick local review and CI probe checks | DOD:[serve cmd, static file hardening, probe status output, docs/tests] | DEP:[V2.03d] | RSK:[path traversal, serve lifecycle confusion] | NXT:[completed: inspect-pack-serve + duration-based auto-shutdown + probe-path + cli tests/docs]
CK:V2.04 | S:D | PH:V2 | PR:P2 | EF:L | AR:TRUST | IN: org-level trust policy packs, named trust profiles beyond permissive/signed/anchored, environment inheritance | DOD:[policy registry, docs, tests] | DEP:[snapshot trust story] | RSK:[policy sprawl] | NXT:[completed: trust-pack registry/inheritance + --trust-pack + env default + docs/tests]
CK:V2.04a | S:D | PH:V2 | PR:P2 | EF:M | AR:TRUST | IN: implement named trust policy packs with inheritance and apply them across preset bundle and snapshot trust workflows | DOD:[registry api, cli management commands, --trust-pack wiring, docs/tests] | DEP:[V2.04] | RSK:[policy confusion] | NXT:[completed: .trust-packs storage + resolveTrustPolicyPack + CLI trust-pack-* + GLIALNODE_TRUST_POLICY_PACK default]
CK:V2.05 | S:D | PH:V2 | PR:P3 | EF:L | AR:DATA | IN: graph export / visualization path for record-event-link topology | DOD:[exporter, docs] | DEP:[stable schema] | RSK:[extra maintenance] | NXT:[completed: native graph export + cytoscape/dot adapters + docs]
CK:V2.05a | S:D | PH:V2 | PR:P3 | EF:M | AR:DATA | IN: implement first graph export artifact for spaces (`space/scope/record/event` nodes + link/source/containment edges) with machine-friendly JSON output | DOD:[client api, cli cmd, tests, docs] | DEP:[V2.05] | RSK:[schema drift] | NXT:[completed: GlialNodeClient exportSpaceGraph + CLI space graph-export + json/file paths]
CK:V2.05b | S:D | PH:V2 | PR:P3 | EF:S | AR:DATA | IN: add practical visualization adapters so exported graph can feed common tooling with minimal transforms | DOD:[cytoscape adapter, graphviz dot adapter, cli format flag, docs/tests] | DEP:[V2.05a] | RSK:[format drift] | NXT:[completed: native|cytoscape|dot formats via client+cli]
CK:V2.06 | S:D | PH:V2 | PR:P3 | EF:XL | AR:CORE | IN: richer learning loops: controlled auto-reinforcement, confidence calibration from repeated successful use, contradiction resolution suggestions | DOD:[policy, explainability, tests] | DEP:[eval corpus] | RSK:[untrusted self-rewrite] | NXT:[completed: read-only learning loop planner with repeated-use reinforcement suggestions, calibration review, contradiction review, client+cli+tests]
CK:V2.07 | S:A | PH:V2 | PR:P1 | EF:XL | AR:OBS | IN: full visibility dashboard program for CEO/operator reporting across ROI, memory health, recall quality, trust, agents, operations, and storage | DOD:[dashboard_spec, metrics_schema, client_api, cli_json, local_server_api, docs, tests] | DEP:[V2.03,V2.05a] | RSK:[vanity_metrics, privacy_drift, dashboard_without_source_contract] | NXT:[metrics storage, token recording, aggregate token ROI reporting, dashboard connector snapshots, executive snapshot, memory health report, ops snapshot, alert evaluator, recall quality report, trust report, local dashboard exports, static local dashboard HTML, dashboard fixture, and local read-only HTTP API complete; lifecycle-due detail and historical trend/screenshot polish remain]
CK:V2.07a | S:D | PH:V2 | PR:P1 | EF:M | AR:STOR | IN: add optional separate metrics sqlite database so high-volume token/cost/latency telemetry stays outside semantic memory | DOD:[metrics_repo, schema_ver, migrations, default_path, backup_notes, disable_mode, tests] | DEP:[BP:19,BP:20] | RSK:[two_file_ops_confusion, schema_drift] | NXT:[completed: src/metrics SqliteMetricsRepository uses separate glialnode.metrics.sqlite schema/migrations/default path plus disabled repository mode]
CK:V2.07b | S:D | PH:V2 | PR:P1 | EF:M | AR:API | IN: expose token usage recording API for host apps without prompt storage | DOD:[recordTokenUsage client api, cli import/append path, validation, no_text_payload_contract, docs/tests] | DEP:[V2.07a] | RSK:[bad_baseline_estimates, accidental_content_logging] | NXT:[completed: client.recordTokenUsage and CLI metrics token-record validate numeric fields and reject prompt/memory/request/secret payload fields]
CK:V2.07c | S:D | PH:V2 | PR:P1 | EF:L | AR:API | IN: add aggregate reporting APIs for day/week/month token ROI and cost visibility | DOD:[getTokenUsageReport, granularity_day_week_month, model/provider_cost_config, per_space_agent_project_breakdowns, cli_json, docs/tests] | DEP:[V2.07b] | RSK:[cost_pricing_staleness, misleading_net_savings] | NXT:[completed: client/CLI token-report supports day/week/month/all, model/provider cost config, filters, cost before/after/saved, and estimated saved tokens]
CK:V2.07d | S:D | PH:V2 | PR:P1 | EF:L | AR:API | IN: add dashboard connector surface that combines existing memory/trust/graph reports with new metrics aggregates | DOD:[buildDashboardOverviewSnapshot, buildSpaceDashboardSnapshot, buildAgentDashboardSnapshot, schema_versioned_json, docs/tests] | DEP:[V2.07c,V2.03c,V2.05a] | RSK:[fragmented_dashboard_queries, slow_large_spaces] | NXT:[completed: client dashboard builders plus CLI dashboard overview/space/agent JSON combine memory counts, storage bytes, maintenance due, and token ROI metrics]
CK:V2.07e | S:A | PH:V2 | PR:P2 | EF:L | AR:UX | IN: implement executive overview dashboard for value visibility | DOD:[kpi_cards, trends, roi_by_space_project_agent, health_score, risk_score, storage_growth, screenshot_test, docs] | DEP:[V2.07d] | RSK:[pretty_but_not_actionable] | NXT:[client.buildExecutiveDashboardSnapshot + CLI dashboard executive complete for saved_tokens/saved_cost/net_savings/active_spaces/memory_health/risk; static dashboard-html export renders KPI cards, top_roi, top_risk, and risk panels; historical trend detail and screenshot test remain]
CK:V2.07f | S:A | PH:V2 | PR:P2 | EF:M | AR:OBS | IN: implement memory health reporting pack for records, lifecycle, stale/decayed/conflicted/low-confidence memory, compaction/retention due work | DOD:[health_metrics_model, client+cli_json, dashboard_panel, docs/tests] | DEP:[space_report, V2.07d] | RSK:[false_health_score, hidden_policy_context] | NXT:[client.buildMemoryHealthReport + CLI dashboard memory-health complete for active/stale/low-confidence/archive/superseded/expired/provenance/health_score; static dashboard-html includes memory health panel; lifecycle-due detail remains]
CK:V2.07g | S:D | PH:V2 | PR:P2 | EF:M | AR:RETR | IN: implement recall quality and retrieval efficiency metrics | DOD:[recall_usage_metrics, bundle_size_metrics, compact_vs_full_usage, latency_percentiles, top_recalled, never_recalled_candidates, docs/tests] | DEP:[V2.07a,V2.07d] | RSK:[quality_proxy_overclaim] | NXT:[completed: buildDashboardRecallQualityReport + client.buildRecallQualityReport + CLI dashboard recall-quality report recall/bundle/trace counts, latency p50/p95, compact-vs-full token ratio, top recalled IDs from metrics dimensions, and never-recalled active candidates without memory text]
CK:V2.07h | S:D | PH:V2 | PR:P2 | EF:M | AR:TRUST | IN: implement trust/provenance dashboard reporting for signed/unsigned artifacts, policy failures, unreviewed provenance, revoked/rotated signer posture | DOD:[trust_dashboard_snapshot, per_space_trust_posture, recent_trust_events, cli_json, docs/tests] | DEP:[V2.04a,V2.07d] | RSK:[trust_noise, operator_alarm_fatigue] | NXT:[completed: buildDashboardTrustReport + client.buildTrustDashboardReport + CLI dashboard trust summarize signer posture, revoked/rotated signers, trust policy packs, per-space trust posture, recent provenance event metadata, and policy failure counts]
CK:V2.07i | S:D | PH:V2 | PR:P2 | EF:M | AR:OPS | IN: implement operations dashboard reporting for maintenance, db health, schema versions, file sizes, write mode, export/backup freshness, benchmark baselines | DOD:[ops_snapshot_api, alert_thresholds, cli_json, docs/tests] | DEP:[doctor,status,V2.07d] | RSK:[local_env_variance] | NXT:[completed: client.buildOperationsDashboardSnapshot + CLI dashboard operations report backend/schema/db_size/maintenance_due/backup/doctor_status, threshold evaluator covers backup age and database size, and static dashboard-html includes operations plus opt-in benchmark baseline panel]
CK:V2.07j | S:D | PH:V2 | PR:P2 | EF:M | AR:API | IN: provide optional local read-only HTTP API for dashboard clients while keeping TypeScript client + CLI JSON as primary contracts | DOD:[local_server, read_only_routes, schema_envelope, cors_default_safe, auth_note, tests, docs] | DEP:[V2.07d] | RSK:[security_surface, false_server_backed_claim] | NXT:[completed: dashboard serve is loopback-only, explicit --allow-origin, temporary duration-bound, JSON-envelope read-only routes for /overview /executive /spaces /spaces/:id /agents /agents/:id /metrics/token-usage /trust /ops, with CORS and host rejection tests]
CK:V2.07k | S:D | PH:V2 | PR:P3 | EF:M | AR:DATA | IN: add exportable CSV/JSON/HTML reporting artifacts for finance/operator review | DOD:[token_roi_csv, memory_health_json, recall_quality_json, trust_report_json, local_dashboard_html, docs/tests] | DEP:[V2.07c,V2.07f,V2.07g,V2.07h] | RSK:[format_sprawl] | NXT:[completed: dashboard export command writes dashboard-html standalone HTML, token-roi CSV/JSON plus memory-health, recall-quality, trust, and alerts JSON artifacts]
CK:V2.07l | S:D | PH:V2 | PR:P3 | EF:M | AR:OBS | IN: add alert threshold model for dashboard warnings without background daemon requirement | DOD:[threshold_config, evaluateDashboardAlerts api, cli_json, docs/tests] | DEP:[V2.07d] | RSK:[noisy_alerts, hidden_defaults] | NXT:[completed: DEFAULT_DASHBOARD_ALERT_THRESHOLDS + evaluateDashboardAlerts + client.evaluateDashboardAlerts + CLI dashboard alerts cover memory health, stale/low-confidence ratios, maintenance due, critical warnings, backup freshness, and database size]
CK:V2.07m | S:D | PH:V2 | PR:P1 | EF:S | AR:OBS | IN: define CEO/CPO/COO dashboard personas, decisions, and panel-to-decision map before UI work | DOD:[persona_matrix, decision_map, panel_acceptance_criteria, docs] | DEP:[V2.07] | RSK:[dashboard_as_wallpaper] | NXT:[completed: docs/executive-dashboard.md maps CEO/CPO/COO/operator panels to decisions and acceptance bars]
CK:V2.07n | S:D | PH:V2 | PR:P1 | EF:M | AR:DATA | IN: define metric confidence labels and provenance for measured vs estimated dashboard values | DOD:[confidence_model, measured_estimated_unknown_labels, cost_model_metadata, schema_examples, docs] | DEP:[V2.07b,V2.07c] | RSK:[estimates_look_like_accounting_facts] | NXT:[completed: docs/executive-dashboard.md defines DashboardMetric, provenance, estimate basis, cost model metadata, and forbidden metric shapes]
CK:V2.07o | S:D | PH:V2 | PR:P1 | EF:M | AR:API | IN: define versioned dashboard snapshot schema contracts for overview/executive/product/operations views | DOD:[schema_version, overview/executive/product/operations snapshot types, validation_helpers, compatibility_notes, tests] | DEP:[V2.07m,V2.07n] | RSK:[ui_locked_to_fragile_shape] | NXT:[completed: src/dashboard exports versioned snapshot contracts and validators; live builders remain deferred to V2.07d after extra_high checkpoint]
CK:V2.07p | S:D | PH:V2 | PR:P1 | EF:M | AR:SEC | IN: define dashboard privacy and access rules before local server or hosted dashboard work | DOD:[privacy_contract, redaction_rules, no_prompt_or_memory_text_defaults, local_server_access_notes, tests] | DEP:[BP:19,BP:22,V2.07o] | RSK:[metrics_leak_private_context] | NXT:[completed: src/dashboard/privacy exports local-first policy defaults and snapshot privacy validation that rejects raw prompt/memory/request/secret fields]
CK:V2.07q | S:D | PH:V2 | PR:P2 | EF:S | AR:DX | IN: add host-app instrumentation guide for recording tokens, latency, cost model, operation, agent, project, and workflow ids | DOD:[docs, examples, field_reference, anti_examples_for_raw_text_logging] | DEP:[V2.07b,V2.07n] | RSK:[bad_or_inconsistent_adoption_data] | NXT:[completed: docs/metrics.md includes client/CLI examples, field reference, backup notes, disable mode, and raw-text anti-examples]
CK:V2.07r | S:D | PH:V2 | PR:P2 | EF:M | AR:TEST | IN: add seeded dashboard fixture/demo dataset so dashboard snapshots and screenshots can be tested before real usage exists | DOD:[fixture_generator, deterministic_seed, dashboard_snapshot_tests, screenshot_demo_data, docs] | DEP:[V2.07d,V2.07o] | RSK:[empty_demo_or_misleading_manual_fixtures] | NXT:[completed: scripts/dashboard-fixture.mjs + npm run demo:dashboard seed synthetic memory, token metrics, trust metadata, dashboard JSON artifacts, token ROI CSV, standalone dashboard HTML, manifest, and fixture test coverage]
CK:V2.07s | S:N | PH:V2 | PR:P2 | EF:S | AR:REL | IN: define OSS vs paid dashboard boundary before Supabase/Postgres/team dashboard work | DOD:[boundary_doc, oss_local_metrics_scope, paid_team_auth_billing_scope, roadmap_alignment] | DEP:[V2.01,V2.07] | RSK:[open_source_confusion_or_premature_saas_scope]
CK:V2.07t | S:D | PH:V2 | PR:P0 | EF:XS | AR:SEC | IN: before starting V2.07a-d implementation, explicitly notify owner to switch reasoning level to extra high | DOD:[chat_notice_before_code, roadmap_reference, no_metrics_schema_patch_before_confirmation] | DEP:[BP:22,V2.07a,V2.07d] | RSK:[high_risk_contract_designed_at_low_reasoning] | NXT:[completed: owner switched reasoning to extra high before metrics storage/token/reporting implementation started]
CK:V2.08 | S:N | PH:V2 | PR:P1 | EF:L | AR:DX | IN: add skill/mcp/tool routing memory so agents can choose the minimal useful execution context for recurring task patterns | DOD:[routing_memory_schema, recommendExecutionContext api, cli_json, docs, tests] | DEP:[recall,bundle_trace,V2.07a] | RSK:[stale_tool_advice, over_pruning_needed_context, tool_surface_drift]
CK:V2.08a | S:N | PH:V2 | PR:P1 | EF:M | AR:DATA | IN: define execution context memory model for task fingerprints, selected skills/tools, skipped tools, outcomes, latency, token/tool-call cost, and confidence | DOD:[types, validation, privacy_rules, retention_policy, docs/tests] | DEP:[V2.08] | RSK:[prompt_leakage, overfitted_task_patterns]
CK:V2.08b | S:N | PH:V2 | PR:P1 | EF:M | AR:API | IN: expose recommendation API that accepts task text, repo/project scope, available skills, available MCP tools, and local tool constraints | DOD:[recommendExecutionContext client api, explainable_result, avoidTools, firstReads, confidence, cli_json, tests] | DEP:[V2.08a] | RSK:[black_box_tool_choice]
CK:V2.08c | S:N | PH:V2 | PR:P2 | EF:M | AR:OBS | IN: record execution context outcomes so successful and wasteful tool paths improve future recommendations | DOD:[recordExecutionOutcome api, metrics.sqlite integration, success/fail/partial states, latency/tool_call/token counters, docs/tests] | DEP:[V2.08a,V2.07a] | RSK:[self_reinforcing_bad_routes]
CK:V2.08d | S:N | PH:V2 | PR:P2 | EF:M | AR:UX | IN: surface tool-routing efficiency in dashboard: tools avoided, useful skills, noisy tools, saved time/tokens, and confidence drift | DOD:[dashboard_panel, dashboard_snapshot_fields, cli_json, docs/tests] | DEP:[V2.08c,V2.07d] | RSK:[vanity_efficiency_claims]
CK:V2.08e | S:N | PH:V2 | PR:P2 | EF:M | AR:RETR | IN: add freshness/degrade behavior when skill names, MCP tool inventories, repo paths, or project conventions change | DOD:[availability_diff, stale_recommendation_warning, fallback_to_normal_discovery, tests/docs] | DEP:[V2.08b] | RSK:[broken_recommendations_after_tool_changes]
```

## Research / Open Questions

```text
CK:RND.01 | S:D | PH:RND | PR:P2 | EF:M | AR:STOR | IN: should full snapshot format and preset bundle format share a common signed container layer? | DOD:[decision note] | DEP:[snapshot trust design] | RSK:[over-unification] | NXT:[decision: keep separate signed containers in v1/v1p; revisit when external distribution pressure increases]
CK:RND.02 | S:D | PH:RND | PR:P2 | EF:S | AR:RETR | IN: should provenance memory always be eligible supporting context, or only when query/review route suggests trust relevance? | DOD:[decision note + tests if chosen] | DEP:[V1p.03] | RSK:[noise vs missing context] | NXT:[decision: provenance remains eligible but route/risk shaping controls inclusion pressure]
CK:RND.03 | S:D | PH:RND | PR:P3 | EF:M | AR:SEC | IN: should signed artifacts move to detached signature files for easier external verification? | DOD:[decision note] | DEP:[current bundle signing usage] | RSK:[DX cost] | NXT:[decision: keep embedded signatures for v1/v1p and defer detached signatures]
CK:RND.04 | S:D | PH:RND | PR:P3 | EF:M | AR:API | IN: should cli `--json` evolve into stable schema-versioned output contracts? | DOD:[decision note] | DEP:[V1.P0.05] | RSK:[maintenance burden] | NXT:[decision: keep `--json` payload stable and add additive `--json-envelope` contract versioning path]
```

## Implementation Suggestions

```text
SG:01 | AR:ALL | NOTE: if adding a new event_type, update: core types, report aggregation, README/docs, tests, and roadmap item if work remains
SG:02 | AR:RETR | NOTE: if adding a new bundle hint, update: annotations, route warnings, auto-route logic, docs, client+cli tests
SG:03 | AR:TRUST | NOTE: if adding a new trust profile, update: cli help, client types, preset bundle validation, docs, negative tests
SG:04 | AR:STOR | NOTE: if touching query parsing, add regression cases for dash, quote, colon, paren, wildcard, and empty-string inputs
SG:05 | AR:DATA | NOTE: for any new portable format, define {format_ver, engine_ver, compat_rule, checksum_rule, signing_rule} together
SG:06 | AR:DX | NOTE: prefer new helper/API names that describe intent not storage internals; keep sqlite detail behind adapters
SG:07 | AR:REL | NOTE: every publish candidate should review this roadmap first; do not publish while P0(V1) open unless explicitly accepted
SG:08 | AR:TEST | NOTE: keep at least one end-to-end path per major subsystem: memory lifecycle, preset lifecycle, trust lifecycle, recall lifecycle
SG:09 | AR:DOC | NOTE: if roadmap % changes materially, update STAT block instead of rewriting narrative prose elsewhere
SG:10 | AR:OPS | NOTE: capture newly discovered implementation suggestions as new SG lines, not ad hoc chat-only notes
SG:11 | AR:OBS | NOTE: dashboard metrics should distinguish measured provider usage from estimated baseline/savings; never present estimates as exact spend
SG:12 | AR:API | NOTE: every dashboard panel should map to a stable client method and CLI JSON or local HTTP route before UI work is considered complete
SG:13 | AR:DATA | NOTE: metrics.sqlite loss should not affect memory correctness; treat metrics as optional telemetry unless operator explicitly configures retention/backup
SG:14 | AR:DX | NOTE: tool-routing memory should recommend and explain, not force; agents must be able to ignore stale or risky recommendations
SG:15 | AR:SEC | NOTE: execution context memory may store tool names and counters, but must not store raw prompts, secrets, tool outputs, or private retrieved content by default
SG:16 | AR:OBS | NOTE: before dashboard metrics implementation starts, tell owner to switch reasoning_level=extra_high; continue only after that checkpoint is acknowledged
SG:17 | AR:DATA | NOTE: dashboard value/cost reports must expose confidence/provenance per metric; every estimate needs a visible basis and cannot be mixed silently with measured usage
SG:18 | AR:REL | NOTE: keep OSS dashboard local-first and metrics-only; reserve Supabase/Postgres, auth, roles, org tenancy, subscriptions, and hosted team dashboards for paid-version validation
```

## Update Protocol

```text
UPD:01 | when work starts => S:A
UPD:02 | when merged locally => S:D + trim NXT if obsolete
UPD:03 | if scope grows => add new CK line; do not overload old line
UPD:04 | if user changes publish bar => update GT first, then CK priorities
UPD:05 | if roadmap and repo diverge => repo wins; fix roadmap same session
```
