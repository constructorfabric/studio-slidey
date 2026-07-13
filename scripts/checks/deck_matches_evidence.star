# deck_matches_evidence.star — the deck deliverable type's TYPE-PROVIDED gate
# check (POG materialization-first taxonomy): a deck generated from
# deterministic data is REAL iff it is 1:1 with its evidence. Concretely:
# every record in the evidence registry has exactly one scene in the deck
# whose `template` names it, and the deck contains no meme scene whose
# template is absent from the registry — no missing coverage, no phantom
# scenes. Pure validation over committed JSON: generation is the deck
# builder's job (scripts/build-meme-gallery-deck.js via the render-deck
# story), judging the generated deck against its source data is this
# script's job.
#
# Reproduce by hand:
#   kitsoki starlark run scripts/checks/deck_matches_evidence.star \
#     --inputs '{"deck":"examples/meme-gallery-all.slidey.json","registries":["data/meme-templates.json","data/meme-templates.custom.json"]}' \
#     --capabilities '{"fs":{"read":["examples/**","data/**"]}}'
#
# `registries` is a list because the runtime registry is a union: the
# vendored memegen catalog plus curated extras (src/memes/registry.js
# overlays data/meme-templates.custom.json over data/meme-templates.json).
# The deck must be 1:1 with that same union — judging against only one
# half found real drift on first contact (a curated clown-makeup scene
# that a single-registry premise called phantom).

def main(ctx):
    deck_path = ctx.inputs["deck"]
    registry_paths = ctx.inputs["registries"]
    reasons = []
    evidence = []

    if len(registry_paths) == 0:
        return {"ok": False, "reasons": ["inputs.registries is empty"], "evidence": []}
    for rp in registry_paths:
        if not ctx.fs.exists(rp):
            return {"ok": False, "reasons": ["registry %s does not exist" % rp], "evidence": []}
    if not ctx.fs.exists(deck_path):
        return {"ok": False, "reasons": ["deck %s does not exist (run the render-deck story to generate it)" % deck_path], "evidence": []}

    registry_ids = {}
    for rp in registry_paths:
        registry = json.decode(ctx.fs.read(rp))
        templates = registry.get("templates", registry if type(registry) == "list" else [])
        for t in templates:
            registry_ids[t["id"]] = True

    deck = json.decode(ctx.fs.read(deck_path))
    scene_ids = {}
    for scene in deck.get("scenes", []):
        if scene.get("type") != "meme":
            continue
        tid = scene.get("template", "")
        scene_ids[tid] = scene_ids.get(tid, 0) + 1

    missing = [tid for tid in registry_ids if tid not in scene_ids]
    phantom = [tid for tid in scene_ids if tid not in registry_ids]
    duplicated = [tid for tid in scene_ids if scene_ids[tid] > 1]

    if len(missing) > 0:
        reasons.append("%d registry template(s) have no deck scene (first: %s)" % (len(missing), missing[0]))
    if len(phantom) > 0:
        reasons.append("%d deck scene(s) reference templates absent from the registry (first: %s)" % (len(phantom), phantom[0]))
    if len(duplicated) > 0:
        reasons.append("%d template(s) appear in more than one scene (first: %s)" % (len(duplicated), duplicated[0]))

    evidence.append({
        "registries": registry_paths,
        "deck": deck_path,
        "registry_templates": len(registry_ids),
        "deck_meme_scenes": len(scene_ids),
        "missing": len(missing),
        "phantom": len(phantom),
        "duplicated": len(duplicated),
    })
    if len(reasons) == 0:
        reasons_out = []
    else:
        reasons_out = reasons
    return {"ok": len(reasons) == 0, "reasons": reasons_out, "evidence": evidence}
