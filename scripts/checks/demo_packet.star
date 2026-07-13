# demo_packet.star — the demo type's type-provided gate check
# (materialization-first taxonomy, .context/materialization-first.md): a
# demo deliverable is REAL iff its committed packet holds together as data —
# the manifest exists, parses, and declares at least one state; every clip
# the node declares exists, parses as a non-empty rrweb event list, and has
# its chapters sidecar (<clip>.chapters.json) with at least one chapter.
# Pure validation over committed files: capture is host.demo's job
# (stories/demo-packet), judging the captured packet is this script's job.
# Freshness/tour-shape checks stay with demo-doctor (an exec tool, so it
# cannot run in this sandbox); this assertion is the deterministic core the
# engine enforces on every materialize run.
#
# Reproduce by hand:
#   kitsoki starlark run scripts/checks/demo_packet.star \
#     --inputs '{"manifest":"stories/demo-packet/fixtures/pilot/demo-packet.demo.json","clips":["..."]}' \
#     --capabilities '{"fs":{"read":["stories/**",".artifacts/**"]}}'

def _check_manifest(ctx, path, evidence, reasons):
    if path == "" or not ctx.fs.exists(path):
        reasons.append("manifest %s does not exist" % path)
        evidence.append({"path": path, "ok": False, "reason": "missing manifest"})
        return
    manifest = json.decode(ctx.fs.read(path))
    states = manifest.get("states", [])
    mockup = manifest.get("mockup", "")
    if len(states) == 0 and mockup == "":
        reasons.append("manifest %s declares neither states (real-app mode) nor mockup" % path)
        evidence.append({"path": path, "ok": False, "reason": "no states/mockup"})
        return
    evidence.append({"path": path, "ok": True, "reason": "manifest parses, %d state(s)" % len(states), "states": len(states)})

def _check_clip(ctx, path, evidence, reasons):
    if not ctx.fs.exists(path):
        reasons.append("clip %s does not exist (materialize this node to capture it)" % path)
        evidence.append({"path": path, "ok": False, "reason": "missing clip"})
        return
    events = json.decode(ctx.fs.read(path))
    if type(events) == "dict":
        # Productized capture envelope (mockup-packet/tour recorder output):
        # {schemaVersion, source, viewport, startTime, endTime, durationMs,
        # events: [...]}. The envelope carries provenance the bare-list form
        # lacks; judge its embedded event list the same way.
        events = events.get("events", [])
    if type(events) != "list" or len(events) == 0:
        reasons.append("clip %s is not a non-empty rrweb event list (bare list or capture envelope with events)" % path)
        evidence.append({"path": path, "ok": False, "reason": "empty or malformed clip"})
        return
    chapters_path = path + ".chapters.json"
    if not ctx.fs.exists(chapters_path):
        reasons.append("clip %s has no chapters sidecar" % path)
        evidence.append({"path": path, "ok": False, "reason": "missing chapters sidecar"})
        return
    chapters = json.decode(ctx.fs.read(chapters_path))
    if len(chapters) == 0:
        reasons.append("clip %s chapters sidecar is empty" % path)
        evidence.append({"path": path, "ok": False, "reason": "empty chapters"})
        return
    evidence.append({"path": path, "ok": True, "reason": "%d rrweb event(s), %d chapter(s)" % (len(events), len(chapters))})

def main(ctx):
    evidence = []
    reasons = []
    _check_manifest(ctx, ctx.inputs.get("manifest", ""), evidence, reasons)
    clips = ctx.inputs.get("clips", [])
    if len(clips) == 0:
        reasons.append("inputs.clips is empty — a demo must declare at least one clip")
    for clip in clips:
        _check_clip(ctx, clip, evidence, reasons)
    return {"ok": len(reasons) == 0, "reasons": reasons, "evidence": evidence}
