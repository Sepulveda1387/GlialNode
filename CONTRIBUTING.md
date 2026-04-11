# Contributing

Thanks for contributing to GlialNode.

## Development Flow

1. Install dependencies with `npm install`.
2. Run `npm run check` before opening a change.
3. Run `npm run test` before opening a change.
4. Keep changes scoped and update docs when behavior changes.

## Project Expectations

- Prefer small, composable modules.
- Keep storage, policy, and CLI concerns separated.
- Add tests for new commands and lifecycle behavior.
- Preserve ASCII unless a file already requires Unicode.

## Pull Request Notes

- Summarize the user-facing outcome.
- Mention any schema or CLI surface changes.
- Call out follow-up work or known limitations.
