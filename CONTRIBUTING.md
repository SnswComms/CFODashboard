# Contributing

## Workflow

1. Create a feature branch.
2. Keep changes small and reviewable.
3. Do not commit generated financial outputs.
4. Use synthetic sample data for tests.
5. Open a pull request for review before merging.

## Code standards

- Prefer plain Python with minimal dependencies.
- Keep dashboard pages local-first and fast.
- Parameterise private local paths rather than hardcoding them in new code.
- Preserve evidence/source references in the UI, but do not expose confidential source content in the repo.

## Recommended next refactors

- Move absolute local paths into config/environment variables.
- Split data extraction from rendering.
- Add small synthetic fixtures for each generator.
- Add CI checks for Python syntax and secret scanning.
