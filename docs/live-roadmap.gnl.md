# GlialNode Live Roadmap (GNL)

`GNL` = `GlialNode Notation Language`.
Goal: low-token review, easy append-only updates, fast diffing, compact roadmap maintenance.

## Snapshot

```text
STAT: date=2026-04-12; v1=0.90; vision=0.68; core=0.93; stor=0.85; recall=0.89; trust=0.93; dx=0.90; ops=0.85; docs=0.91
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
GT:V1.STAB | S:N | IN: v1_stable tag only if concurrency_story documented; snapshot story versioned; json automation path present
GT:V1.SEC | S:N | IN: public trust workflows only if key handling docs + trust store docs + revoke/rotate tests are all current
GT:V2.START | S:N | IN: do not start multi-backend or vector-first expansion until V1.P0 and V1.P1 storage/dx items are closed or consciously deferred
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
CK:V1.P0.01 | S:N | PH:V1 | PR:P0 | EF:M | AR:STOR | IN: formalize sqlite write_mode contract; expose mode=single_writer|serialized_local; document exact guarantees and non-goals | DOD:[status_cmd, docs, 2proc_stress, no_breaking_api] | DEP:[sqlite_conn] | RSK:[lock_fail, false_safety_claim] | NXT:[design small write broker or explicit non-goal wording]
CK:V1.P0.02 | S:N | PH:V1 | PR:P0 | EF:M | AR:DATA | IN: version + checksum full memory snapshots/export/import same way preset bundles are versioned | DOD:[snapshot_meta, compat_check, checksum_check, tests] | DEP:[export_import_path] | RSK:[corrupt_import, incompatible_restore] | NXT:[define snapshot_format_v1]
CK:V1.P0.03 | S:N | PH:V1 | PR:P0 | EF:L | AR:TRUST | IN: optional signature + trust policy for full memory snapshots; keep separate from preset bundle trust model unless later unified | DOD:[sign_export, verify_import, cli+client, docs, tests] | DEP:[V1.P0.02] | RSK:[confused_format, operator_misuse] | NXT:[reuse Ed25519 helpers]
CK:V1.P0.04 | S:N | PH:V1 | PR:P0 | EF:S | AR:STOR | IN: harden FTS query handling; auto escape/quote risky chars; add hyphen/symbol/phrase regression tests | DOD:[safe_query_builder, test_matrix, note_in_arch] | DEP:[search_repo] | RSK:[fts_parse_fail, weird_match_loss] | NXT:[centralize query normalization]
CK:V1.P0.05 | S:N | PH:V1 | PR:P0 | EF:M | AR:DX | IN: add stable machine-readable output mode for high-value CLI flows (`space show/report`, `memory search/recall/trace/bundle`, `preset bundle-show/import`) | DOD:[--json, docs, tests, no_current_text_break] | DEP:[cli_output] | RSK:[automation_fragility] | NXT:[start with read/report cmds]
CK:V1.P0.06 | S:N | PH:V1 | PR:P0 | EF:M | AR:SEC | IN: key handling hardening; verify local key/trust files use safe write path + documented permission guidance + zero secret echo | DOD:[fs_notes, secure_write_review, tests where possible] | DEP:[key_registry] | RSK:[secret_leak, operator_copy_error] | NXT:[document expected file perms by OS]
CK:V1.P0.07 | S:N | PH:V1 | PR:P0 | EF:M | AR:DOC | IN: operator guide for backup/restore/trust/import/export/rotation; one place for safe operational flows | DOD:[docs/operator-guide.md or equivalent, linked from README] | DEP:[V1.P0.02,V1.P0.03] | RSK:[unsafe_ops, hidden_workflows] | NXT:[collect exact flows first]
CK:V1.P0.08 | S:N | PH:V1 | PR:P0 | EF:S | AR:REL | IN: define semver + compatibility policy for CLI/API/schema/snapshot/preset bundle formats | DOD:[compat_notes, README, changelog note] | DEP:[none] | RSK:[publish_confusion] | NXT:[state what may break in 0.x]

CK:V1.P1.01 | S:N | PH:V1 | PR:P1 | EF:M | AR:DX | IN: effective policy inspection; show merged space settings + preset/channel/provenance origin in one read path | DOD:[space show/report enhancement, docs, tests] | DEP:[settings_merge] | RSK:[opaque_config] | NXT:[separate raw_vs_effective view]
CK:V1.P1.02 | S:N | PH:V1 | PR:P1 | EF:M | AR:OPS | IN: `doctor`/`status` workflow for db runtime, schema ver, preset dir, trust store, signer store, WAL state, path sanity | DOD:[cli cmd, client helper maybe later, docs, smoke test] | DEP:[status surfaces] | RSK:[hard_support, hidden_misconfig] | NXT:[CLI first]
CK:V1.P1.03 | S:N | PH:V1 | PR:P1 | EF:M | AR:DATA | IN: define import collision semantics for presets/snapshots/records; overwrite vs merge vs rename policy | DOD:[policy doc, validation, tests] | DEP:[import paths] | RSK:[data_dup, accidental_overwrite] | NXT:[start with snapshot + preset import]
CK:V1.P1.04 | S:N | PH:V1 | PR:P1 | EF:M | AR:OBS | IN: richer space report: event counts by type, provenance summary count, latest maintenance timestamps | DOD:[report ext, docs, tests] | DEP:[space_report] | RSK:[opaque_ops] | NXT:[counts_by_event_type]
CK:V1.P1.05 | S:N | PH:V1 | PR:P1 | EF:M | AR:PERF | IN: add benchmark harness for search, recall, bundle build, compaction, report on realistic dataset sizes | DOD:[bench script, baseline numbers, doc note] | DEP:[seed data] | RSK:[perf regressions unseen] | NXT:[bench 1k/10k/50k records]
CK:V1.P1.06 | S:N | PH:V1 | PR:P1 | EF:M | AR:DX | IN: add example integration app/service that embeds GlialNodeClient in realistic loop | DOD:[examples/ app, docs, smoke path] | DEP:[client API] | RSK:[adoption friction] | NXT:[simple memory service wrapper example]
CK:V1.P1.07 | S:N | PH:V1 | PR:P1 | EF:S | AR:DOC | IN: create troubleshooting matrix for common failures: lock contention, trust validation fail, signer revoke, query parse, snapshot import fail | DOD:[troubleshooting doc + README link] | DEP:[known failure list] | RSK:[support load] | NXT:[harvest from test cases]
CK:V1.P1.08 | S:N | PH:V1 | PR:P1 | EF:M | AR:TEST | IN: long-run lifecycle tests covering repeated maintain/compact/retain/decay loops over same dataset | DOD:[durable state test suite, no flake] | DEP:[maintenance flows] | RSK:[state drift] | NXT:[48-step deterministic fixture]

CK:V1.P2.01 | S:N | PH:V1 | PR:P2 | EF:M | AR:API | IN: expose lower-level safe query builder + route reasoning helpers for host apps | DOD:[client exports, docs, tests] | DEP:[retrieval] | RSK:[duplicate downstream logic] | NXT:[export pure helpers]
CK:V1.P2.02 | S:N | PH:V1 | PR:P2 | EF:M | AR:UX | IN: better operator ergonomics for trust review: diff trusted signer sets, show why bundle failed policy in denser table/json | DOD:[bundle-show/report polish] | DEP:[trust report] | RSK:[ops friction] | NXT:[trust explain mode]
CK:V1.P2.03 | S:N | PH:V1 | PR:P2 | EF:S | AR:REL | IN: add release checklist link chain: README -> live roadmap -> launch checklist -> publish guide | DOD:[doc links aligned] | DEP:[this file] | RSK:[doc drift] | NXT:[simple doc wiring]
CK:V1.P2.04 | S:N | PH:V1 | PR:P2 | EF:S | AR:SEC | IN: explicit data classification note for spaces/records/events/preset secrets | DOD:[security doc section] | DEP:[ops guide] | RSK:[wrong storage assumptions] | NXT:[mark secret-bearing artifacts]
CK:V1.P2.05 | S:N | PH:V1 | PR:P2 | EF:M | AR:OBS | IN: maintenance summaries should expose last_run and delta counts in report/status without search | DOD:[report fields, docs, tests] | DEP:[report ext] | RSK:[ops blind spots] | NXT:[space report extension]
```

## V1 Soon After

```text
CK:V1p.01 | S:N | PH:V1p | PR:P1 | EF:L | AR:STOR | IN: optional serialized write broker or lightweight write queue for safer local multi-process use | DOD:[adapter path, contention tests, docs] | DEP:[V1.P0.01] | RSK:[complexity creep] | NXT:[prototype wrapper not backend rewrite]
CK:V1p.02 | S:N | PH:V1p | PR:P1 | EF:M | AR:DATA | IN: snapshot restore preview/dry-run showing counts, conflicts, schema version, trust status before apply | DOD:[preview cmd/api, docs, tests] | DEP:[snapshot meta/trust] | RSK:[unsafe_restore] | NXT:[import preview JSON]
CK:V1p.03 | S:N | PH:V1p | PR:P1 | EF:M | AR:RETR | IN: provenance-sensitive pruning policy so executor bundles keep only critical trust context while reviewer bundles preserve more | DOD:[policy knob, tests, docs] | DEP:[provenance routing/hints] | RSK:[bundle bloat or missing trust context] | NXT:[keep min 1 provenance item when trust-critical]
CK:V1p.04 | S:N | PH:V1p | PR:P1 | EF:M | AR:RETR | IN: route-aware bundle shaping should prefer provenance summaries for reviewer bundles and de-prioritize them for executor bundles unless explicit risk present | DOD:[ranking tweak, tests] | DEP:[V1p.03] | RSK:[review noise] | NXT:[profile-specific provenance weighting]
CK:V1p.05 | S:N | PH:V1p | PR:P2 | EF:M | AR:TEST | IN: retrieval eval corpus with expected primary/support/route outcomes for core scenarios | DOD:[fixture set, golden assertions] | DEP:[bundle behavior stabilizing] | RSK:[regressions hidden] | NXT:[10 scenario pack]
CK:V1p.06 | S:N | PH:V1p | PR:P2 | EF:M | AR:DX | IN: add `examples/agent-loop` or `examples/service` with trust+recall+maintenance cycle | DOD:[realistic sample, docs] | DEP:[V1.P1.06] | RSK:[adoption lag] | NXT:[local orchestrator example]
CK:V1p.07 | S:N | PH:V1p | PR:P2 | EF:S | AR:OBS | IN: include provenance memory counts/hints in bundle trace summary for reviewer path | DOD:[trace text update, tests] | DEP:[provenance hints] | RSK:[opaque review context] | NXT:[summary sentence extension]
CK:V1p.08 | S:N | PH:V1p | PR:P2 | EF:M | AR:PERF | IN: index review for provenance-heavy spaces; ensure added audit memory does not distort normal retrieval too aggressively | DOD:[bench + tuning notes] | DEP:[bench harness] | RSK:[audit noise ranking] | NXT:[measure after 1k audit records]
```

## V2

```text
CK:V2.01 | S:H | PH:V2 | PR:P2 | EF:XL | AR:STOR | IN: Postgres backend or server-backed source-of-truth for heavier concurrency/team deployments | DOD:[adapter contract, migration path, docs] | DEP:[V1 storage hardening] | RSK:[premature scale work] | NXT:[defer until proven need]
CK:V2.02 | S:H | PH:V2 | PR:P2 | EF:L | AR:RETR | IN: optional semantic retrieval module with eval-gated enablement and hybrid ranking | DOD:[plugin design, eval set, docs] | DEP:[retrieval eval corpus] | RSK:[semantic noise] | NXT:[prototype only after lexical plateau]
CK:V2.03 | S:H | PH:V2 | PR:P2 | EF:L | AR:UX | IN: local dashboard / TUI / web inspector for spaces, policies, trust stores, reports, recall traces | DOD:[inspect flows, screenshots, docs] | DEP:[json outputs] | RSK:[ux drag] | NXT:[consider read-only dashboard first]
CK:V2.04 | S:H | PH:V2 | PR:P2 | EF:L | AR:TRUST | IN: org-level trust policy packs, named trust profiles beyond permissive/signed/anchored, environment inheritance | DOD:[policy registry, docs, tests] | DEP:[snapshot trust story] | RSK:[policy sprawl] | NXT:[spec before code]
CK:V2.05 | S:H | PH:V2 | PR:P3 | EF:L | AR:DATA | IN: graph export / visualization path for record-event-link topology | DOD:[exporter, docs] | DEP:[stable schema] | RSK:[extra maintenance] | NXT:[json graph first]
CK:V2.06 | S:H | PH:V2 | PR:P3 | EF:XL | AR:CORE | IN: richer learning loops: controlled auto-reinforcement, confidence calibration from repeated successful use, contradiction resolution suggestions | DOD:[policy, explainability, tests] | DEP:[eval corpus] | RSK:[untrusted self-rewrite] | NXT:[design only]
```

## Research / Open Questions

```text
CK:RND.01 | S:N | PH:RND | PR:P2 | EF:M | AR:STOR | IN: should full snapshot format and preset bundle format share a common signed container layer? | DOD:[decision note] | DEP:[snapshot trust design] | RSK:[over-unification] | NXT:[compare container vs separate format]
CK:RND.02 | S:N | PH:RND | PR:P2 | EF:S | AR:RETR | IN: should provenance memory always be eligible supporting context, or only when query/review route suggests trust relevance? | DOD:[decision note + tests if chosen] | DEP:[V1p.03] | RSK:[noise vs missing context] | NXT:[measure on example datasets]
CK:RND.03 | S:N | PH:RND | PR:P3 | EF:M | AR:SEC | IN: should signed artifacts move to detached signature files for easier external verification? | DOD:[decision note] | DEP:[current bundle signing usage] | RSK:[DX cost] | NXT:[defer unless external distribution grows]
CK:RND.04 | S:N | PH:RND | PR:P3 | EF:M | AR:API | IN: should cli `--json` evolve into stable schema-versioned output contracts? | DOD:[decision note] | DEP:[V1.P0.05] | RSK:[maintenance burden] | NXT:[start minimal]
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
