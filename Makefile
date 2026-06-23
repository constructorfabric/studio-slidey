VSCODE_DIR     := tools/vscode-slidey
VSCODE_DIST    := $(VSCODE_DIR)/.slidey-dist
VSCODE_RUNTIME := $(VSCODE_DIR)/.slidey-runtime/src

.PHONY: build-web vscode-stage vscode-package vscode-install-local vscode-clean

build-web:
	npm run build:web

# Stage the built web viewer and the tiny Node runtime the preview API needs so
# the VSIX works after installation, not just from this source checkout.
vscode-stage: build-web
	@rm -rf $(VSCODE_DIST) $(VSCODE_DIR)/.slidey-runtime
	@mkdir -p $(VSCODE_DIST) $(VSCODE_RUNTIME)
	cp -R dist/. $(VSCODE_DIST)/
	cp src/schema.js src/trace.js $(VSCODE_RUNTIME)/

# Output: tools/vscode-slidey/slidey-vscode-<version>.vsix.
vscode-package: vscode-stage
	cd $(VSCODE_DIR) && npm_config_cache="$${npm_config_cache:-$${TMPDIR:-/tmp}/slidey-npm-cache}" npx --yes @vscode/vsce@^3 package --no-dependencies
	@echo "[vscode-package] $$(ls -t $(VSCODE_DIR)/*.vsix | head -1)"

# Override CODE_CLI when testing another compatible editor CLI.
CODE_CLI ?= code
vscode-install-local:
	@command -v $(CODE_CLI) >/dev/null 2>&1 || { \
		echo "error: $(CODE_CLI) not found — install the VS Code shell command or run CODE_CLI=/path/to/code make vscode-install-local." >&2; \
		exit 1; \
	}
	@rm -f $(VSCODE_DIR)/*.vsix
	$(MAKE) vscode-package
	@vsix="$$(ls -t $(VSCODE_DIR)/*.vsix | head -1)"; \
	if [ -z "$$vsix" ]; then \
		echo "error: vscode-package did not produce a .vsix" >&2; \
		exit 1; \
	fi; \
	$(CODE_CLI) --install-extension "$$vsix" --force; \
	echo "[vscode-install-local] installed $$vsix"

vscode-clean:
	rm -rf $(VSCODE_DIST) $(VSCODE_DIR)/.slidey-runtime $(VSCODE_DIR)/*.vsix
