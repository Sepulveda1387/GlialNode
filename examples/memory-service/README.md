# Memory Service Example

This example shows a realistic service-style loop that embeds `GlialNodeClient`:

- bootstraps a dedicated memory space with policy defaults
- ingests session events and durable records
- prepares reply context for a planner-style response
- runs maintenance
- inspects report telemetry
- exports a snapshot artifact

Run it from the repository root:

```bash
npm run example:service
```

Artifacts written during the run:
- `.glialnode/example-service.sqlite`
- `.glialnode/example-service-export.json`
