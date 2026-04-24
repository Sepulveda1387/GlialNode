# Release Readiness

`glialnode release readiness` turns the `GT:V1.PUB` roadmap gate into a concrete report.

The command is read-only. It checks the source tree for release-critical docs, the package surface, the V1/P0 roadmap status, and the SQLite storage contract. It also requires explicit manual confirmations for checks that should not be guessed by the library, such as whether tests passed in the current environment, the package dry-run is green, docs were reviewed, the git tree is clean, and publishing has been approved.

## CLI

```bash
glialnode release readiness --json
```

The default report is intentionally blocked until manual confirmations are provided:

```bash
glialnode release readiness \
  --tests-green true \
  --pack-green true \
  --docs-reviewed true \
  --tree-clean true \
  --user-approved true \
  --json
```

Use `--root <path>` when running the command from outside the repository root.

## Client

```ts
import { GlialNodeClient } from "glialnode";

const client = new GlialNodeClient();
const report = client.buildReleaseReadinessReport({
  rootDirectory: process.cwd(),
  testsGreen: true,
  packGreen: true,
  docsReviewed: true,
  treeClean: true,
  userApproved: true,
});
```

The report returns:

- `status`: `ready` or `blocked`
- `checks`: one row per gate check
- `blockers`: failed checks with short explanations
- `manualInputs`: the confirmations used to build the report

## Release Discipline

This command is a guardrail, not a substitute for judgment. `userApproved` should only be set after the release owner has reviewed the final diff, confirmed CI, and decided the package should be published.
