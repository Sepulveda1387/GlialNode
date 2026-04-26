# Dashboard Demo Fixture

GlialNode includes a synthetic dashboard fixture so operators can preview dashboard JSON/CSV artifacts before real host-app telemetry exists.

Run it from the repository root:

```bash
npm run demo:dashboard
```

By default the script writes to:

```text
.glialnode/dashboard-demo/
```

The generated directory contains:

- `manifest.json`
- `glialnode.dashboard-demo.sqlite`
- `glialnode.dashboard-demo.metrics.sqlite`
- `presets/`
- `artifacts/dashboard-overview.json`
- `artifacts/dashboard-executive.json`
- `artifacts/dashboard-operations.json`
- `artifacts/dashboard-memory-health.json`
- `artifacts/dashboard-recall-quality.json`
- `artifacts/dashboard-trust.json`
- `artifacts/dashboard-alerts.json`
- `artifacts/token-roi.csv`

You can override the output directory:

```bash
node scripts/dashboard-fixture.mjs --output-dir ./tmp/dashboard-demo
```

The fixture is local-only and synthetic. It intentionally uses sample memory records, sample token metrics, and sample provenance metadata. Do not treat the numbers as production benchmarks or accounting data.

The fixture is useful for:

- validating dashboard parser integrations
- checking CLI JSON and CSV artifact shapes
- preparing screenshots without exposing private memory
- testing alert, recall-quality, trust, and executive overview panels
