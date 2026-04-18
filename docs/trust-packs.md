# Trust Policy Packs

Trust policy packs let teams define named, reusable trust rules beyond built-in profiles (`permissive`, `signed`, `anchored`).

Packs can be inherited and then selectively overridden by command flags.

## CLI Management

```bash
glialnode preset trust-pack-register --name strict-signed --base-profile signed --allow-origin production
glialnode preset trust-pack-register --name strict-signed-anchor --inherits strict-signed --trust-signer team-anchor
glialnode preset trust-pack-list --json
glialnode preset trust-pack-show --name strict-signed-anchor --json
```

## Applying Packs

Use `--trust-pack <name>` on trust-sensitive workflows:

```bash
glialnode preset bundle-show --input ./team-executor.bundle.json --trust-pack strict-signed-anchor
glialnode preset bundle-import --input ./team-executor.bundle.json --trust-pack strict-signed-anchor
glialnode import --input ./space.snapshot.json --trust-pack strict-signed-anchor
```

Resolution order:

1. built-in trust profile defaults (`--trust-profile` or pack `baseProfile`)
2. trust-pack resolved policy (including inherited packs)
3. explicit command flags (`--allow-origin`, `--allow-signer`, `--allow-key-id`, `--trust-signer`, `--require-*`)

Explicit flags always win.

## Environment Default

You can set a default pack for automation:

```bash
GLIALNODE_TRUST_POLICY_PACK=strict-signed-anchor
```

When set, trust-sensitive CLI commands use that pack unless `--trust-pack` is explicitly provided.

## Storage

Trust packs are stored in the preset directory at:

- `.trust-packs/*.json`

They are policy configuration artifacts, not secret key material.
