# Slidey VS Code Extension

Preview Slidey `.json` and `.jsonl` presentations in a VS Code webview editor tab
using the same built web viewer that `slidey <file>` serves in a browser.

## Development

Build the viewer bundle before launching the extension:

```sh
npm run build:web
code --extensionDevelopmentPath=tools/vscode-slidey .
```

Open a Slidey spec and run `Slidey: Preview Presentation`, or use the editor title
or Explorer context menu on a `.json` / `.jsonl` file.

## Test

```sh
npm run test:vscode
```

The e2e test rebuilds the web viewer, mounts the extension-generated webview HTML,
bridges the preview API, and verifies that `examples/hello.json` renders with the
interactive Slidey HUD.

To package and install into local VS Code:

```sh
make vscode-install-local
```

Use `CODE_CLI=/path/to/code-compatible-cli` to install into a different editor.
