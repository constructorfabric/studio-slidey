# materialize-doc story

This no-LLM story is the pilot conformance fixture for [node artifact
materialization](../../.context/node-artifact-materialization-plan.md): the
`doc` and `tutorial` deliverable types' `materialize:` bindings point at
this story (`stories/materialize-doc`). It stands in for an upstream story that
would call an LLM to actually draft a brief — here every stage is a
deterministic, templated world-state transition, matching the shape of
`stories/product-site`.

Rooms are the stages the portal renders as pills:

```
gather -> draft -> verify -> done
```

World state carries the `materialize.params` (`depth`, `audience`) and an
echoed `gate` value (standing in for the node's machine-gated field the
portal would have validated before invocation), plus the artifact this run
declares: `.artifacts/<node_id>/brief.md`.

Drive it headless with the intents `next` / `restart` / `look`, e.g. via
`kitsoki test flows stories/materialize-doc/app.yaml`.
