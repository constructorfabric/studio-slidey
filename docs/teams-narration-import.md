# Teams Narration Import

Use this workflow when a live Teams presentation has the natural narration you
want to reuse in a Slidey deck.

## Export from Teams

Prefer WebVTT (`.vtt`) over Word/docx. VTT keeps timestamps, and Teams/Stream
usually includes speaker labels. The recording MP4 is useful for checking slide
start/end anchors, but the VTT is the input Slidey needs.

Manual path:

1. Open the past meeting chat or calendar recap in Teams.
2. Open the recording in the Microsoft 365 video/Stream player.
3. Open **Video settings**.
4. Expand **Transcript and captions**.
5. Use the transcript's menu to download the WebVTT captions/transcript.

If you have the recording but not captions yet, generate captions/transcript from
the same Stream video settings page first.

## Align to a Deck

The importer maps Teams transcript time to Slidey deck time, then groups each VTT
cue into the scene active at that time.

```sh
node tools/teams-vtt-to-narration.js \
  --deck ~/code/kitsoki/docs/decks/pet-dev-story-hybrid.slidey.json \
  --vtt ~/Downloads/teams-transcript.vtt \
  --speaker "Brad Smith"
```

If the deck starts 2 minutes 13 seconds into the Teams recording:

```sh
node tools/teams-vtt-to-narration.js \
  --deck ~/code/kitsoki/docs/decks/pet-dev-story-hybrid.slidey.json \
  --vtt ~/Downloads/teams-transcript.vtt \
  --speaker "Brad Smith" \
  --offset 00:02:13
```

If live presentation timing drifted from Slidey's generated timing, use two or
more anchors. The left side is a Slidey scene index; the right side is the Teams
recording timestamp where that scene starts.

```sh
node tools/teams-vtt-to-narration.js \
  --deck ~/code/kitsoki/docs/decks/kitsoki-pitch.slidey.json \
  --vtt ~/Downloads/teams-transcript.vtt \
  --speaker "Brad Smith" \
  --anchor 0=00:02:13.500 \
  --anchor 88=00:18:20.000 \
  --patch-out /tmp/kitsoki-pitch-narration.patch.json
```

Write an updated copy for review:

```sh
node tools/teams-vtt-to-narration.js \
  --deck ~/code/kitsoki/docs/decks/kitsoki-pitch.slidey.json \
  --vtt ~/Downloads/teams-transcript.vtt \
  --speaker "Brad Smith" \
  --out /tmp/kitsoki-pitch.real-narration.slidey.json
```

Rewrite the deck in place only after reviewing the proposed scene mapping:

```sh
node tools/teams-vtt-to-narration.js \
  --deck ~/code/kitsoki/docs/decks/kitsoki-pitch.slidey.json \
  --vtt ~/Downloads/teams-transcript.vtt \
  --speaker "Brad Smith" \
  --apply
```

Use `--list-speakers` if you need the exact speaker label from the VTT.
