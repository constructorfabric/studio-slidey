# PM reviews the roadmap as a computed diff — storyboard

A PM watches the roadmap as the computed delta between desired and current subgraphs, drilling into decision provenance.

**Trigger:** A tracked node's status or gate changes (a work item lands, a decision is recorded, a changeset applies).
**Outcome:** The PM sees exactly what moved since last look, with provenance for every change, and can drill into any node's history.
**Stakes:** Without a computed diff the PM either re-reads the whole graph every time or misses a status flip that should have prompted a decision.

## Scenes

1. Open the portal; the catalog view loads the current graph.
2. Switch to the roadmap diff view; desired vs current subgraphs render as a computed delta, not a hand-maintained list.
3. Drill into a changed node; its decision/changeset provenance is one click away.
