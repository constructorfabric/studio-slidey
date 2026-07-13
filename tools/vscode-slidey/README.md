# Slidey VS Code Extension

Preview Slidey `.slidey.json` and `.readonly.slidey.json` presentations, raw
`*.rrweb.json` / `rrweb.json` session logs, and generated `.jsonl` trace decks
in a VS Code webview editor tab using the same built web viewer that
`slidey <file>` serves in a browser. Plain `.json` specs can also be opened
explicitly with the command; the Explorer and editor-title menus only
auto-surface for `.slidey.json` decks, rrweb logs, and `.jsonl` traces so
ordinary JSON files do not clutter the UI.

## Use

Install the extension into local VS Code from the repo root:

```sh
make vscode-install-local
```

Then open a spec and run `Slidey: Preview Deck or Replay`, or use the editor title
or Explorer context menu on a `.slidey.json` / `.readonly.slidey.json` /
`*.rrweb.json` / `rrweb.json` / `.jsonl` file.

The preview opens beside the JSON file. It embeds the Slidey viewer in single-file
mode, hides the workspace file tree, serves spec and asset reads through the VS
Code webview bridge, and reloads from disk when the source file changes. Use the
preview to step through the deck with the normal Slidey HUD and navigation, or edit
text directly on the slide (see below). `.readonly.slidey.json` opens in
Browse/Present mode only, since it is treated as an authoritative artifact.

### In-place editing

The floating control in the preview's upper-left toggles **Edit** / **Present**,
mirroring the web viewer's mode toggle (the web viewer's third mode, Browse, has
no file tree to browse here, so the embedded preview omits it).
In Edit mode, hover any text on a slide — including SVG diagram labels — and click
to edit it where it sits. Enter commits, Shift+Enter inserts a newline in
multi-line fields, Esc cancels. The upper-left **Save** button writes the edited
spec back to the file: the write goes through VS Code's editor model, so it lands
in the document's undo history and normal save lifecycle (you can ⌘Z it like any
edit). The **Revert** button beside it discards unsaved edits and restores the
last saved version. While you have unsaved edits the preview will not auto-reload over them; the
upper-right ⟳ pulls the on-disk version when you're ready.

The side-form scene editor from the CLI viewer (`slidey <file>`) is not shown in
the embedded preview — VS Code editing is in-place only. Edit structural fields
(enums, numbers, scene order) in the JSON itself.

The preview supports the same scene/runtime surface as the web viewer, including:

- `.slidey.json` specs, generated `.jsonl` trace decks, raw rrweb replay logs, and read-only `.readonly.slidey.json` artifacts.
- Local image assets resolved relative to the spec.
- Mermaid scenes rendered as themed SVG.
- `video` scenes that reference MP4 or rrweb sources, including the live rrweb
  player in the interactive viewer.

## Development

Build the viewer bundle before launching the extension:

```sh
npm run build:web
code --extensionDevelopmentPath=tools/vscode-slidey .
```

## Test

```sh
npm run test:vscode
```

The e2e test rebuilds the web viewer, mounts the extension-generated webview HTML,
bridges the preview API, and verifies that `examples/hello.slidey.json` renders with the
interactive Slidey HUD.

## Package and Install

`make vscode-install-local` is the normal local refresh command. It:

1. Runs `npm run build:web`.
2. Stages `dist/` into `.slidey-dist`.
3. Stages the small runtime modules needed by the preview API into
   `.slidey-runtime`.
4. Packages `slidey-vscode-<version>.vsix`.
5. Installs the newest VSIX with `code --install-extension --force`.

Use `CODE_CLI=/path/to/code-compatible-cli` to install into a different editor:

```sh
make vscode-install-local CODE_CLI=/path/to/code-compatible-cli
```

`make vscode-package` builds the VSIX without installing it. `make vscode-clean`
removes staged viewer/runtime assets and generated VSIX files.
