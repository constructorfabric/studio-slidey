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
node src/index.js examples/hello.slidey.json --port 5000 --no-open
node src/index.js bundle examples/hello.slidey.json .artifacts/hello.html
npm test
npm run build
```

Use the web player for normal deck review. Use the single-file HTML bundle when
you need a portable review artifact. Render MP4 only when you need fixed video
evidence, narration, or a source for a `video` scene.
