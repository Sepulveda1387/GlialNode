# GlialNode Live Roadmap (GNL)

`GNL` = `GlialNode Notation Language`.
Goal: low-token review, easy append-only updates, fast diffing, compact roadmap maintenance.

## Snapshot

```text
STAT: date=2026-04-20; v1=1.00; vision=0.95; core=0.99; stor=0.94; recall=0.98; trust=1.00; dx=1.00; ops=1.00; docs=1.00
CTX: mode=local_first; db=sqlite; retr=lexical_first; pri=pub_v1>hardening>dx>scale
STATE: repo=strong_v1; publish=hold_user_approval; tests=green; pack=green; ci=ready
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
```

## Release Gates

```text
GT:V1.PUB | S:N | IN: public_v1_allowed only if all P0(V1)=D; tests=green; pack=green; docs=aligned; publish_docs reviewed; tree=clean
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
```

## Update Protocol

```text
UPD:01 | when work starts => S:A
UPD:02 | when merged locally => S:D + trim NXT if obsolete
UPD:03 | if scope grows => add new CK line; do not overload old line
UPD:04 | if user changes publish bar => update GT first, then CK priorities
UPD:05 | if roadmap and repo diverge => repo wins; fix roadmap same session
```
