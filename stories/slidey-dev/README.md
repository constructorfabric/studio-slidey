# slidey-dev

Kitsoki dev-story instance for the Slidey checkout.

Run from the Slidey repo root:

```sh
kitsoki run stories/slidey-dev/app.yaml
```

This instance imports `@kitsoki/dev-story`, starts in the workbench, and seeds
the project onboarding profile for Slidey. It is supervised by default and does
not require a real LLM for deterministic flow tests.

Useful first checks:

```sh
node src/index.js examples/hello.slidey.json --validate
npm test
npm run build
```
