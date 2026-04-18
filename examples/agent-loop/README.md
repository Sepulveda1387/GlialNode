# Agent Loop Example

This example runs a trust-aware local agent loop with `GlialNodeClient`:

- creates a source memory space
- writes actionable + provenance memory
- builds a route-aware recall bundle
- runs maintenance
- exports a signed snapshot
- previews anchored import into a target database
- imports and verifies recall on the target side

Run from the repository root:

```bash
npm run example:agent-loop
```

Artifacts written during the run:
- `.glialnode/agent-loop-source.sqlite`
- `.glialnode/agent-loop-target.sqlite`
- `.glialnode/agent-loop-presets/`
- `.glialnode/agent-loop-snapshot.json`
