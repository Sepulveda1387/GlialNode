# Decision Notes

This file records compact architectural decisions that were tracked as roadmap research items.

## DN-01: Snapshot And Preset Bundle Container Unification

Roadmap: `CK:RND.01`

Decision:

- keep snapshot and preset bundle formats as separate signed containers in v1/v1p.

Reasoning:

- snapshots and preset bundles have different operational lifecycles and trust intents
- unifying now would add migration and tooling complexity without clear operator gain
- both formats already carry explicit metadata (`formatVersion`, runtime metadata, checksum, optional signature)

Consequence:

- maintain separate format version numbers (`snapshotFormatVersion`, `bundleFormatVersion`)
- revisit only if external distribution needs one universal artifact pipeline

## DN-02: Provenance Supporting-Context Eligibility

Roadmap: `CK:RND.02`

Decision:

- provenance memory remains eligible supporting context, but route and risk shaping determine weight and retention.

Reasoning:

- always excluding provenance can hide trust-critical context during review
- always including provenance bloats executor handoffs and dilutes action focus
- current shaping policy (`bundleProvenanceMode`, route-aware ranking/penalties, risk floor) provides balanced behavior validated by retrieval corpus and provenance benchmark flows

Consequence:

- keep reviewer routes context-rich by default
- keep executor routes lean unless stale/contested/provenance risk hints are present
- continue regression checks through retrieval corpus + provenance benchmark

## DN-03: Embedded vs Detached Signatures

Roadmap: `CK:RND.03`

Decision:

- keep embedded signatures for snapshots and preset bundles in v1/v1p; defer detached signature files.

Reasoning:

- embedded signatures minimize operator steps for local-first workflows
- detached signatures improve external verification ergonomics but add artifact management overhead
- current project priority favors low-friction local trust workflows over distribution-scale signature tooling

Consequence:

- retain current signing/export/import paths
- reconsider detached signatures when external distribution volume or third-party verification requirements materially increase
