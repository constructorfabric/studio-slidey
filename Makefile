VSCODE_DIR     := tools/vscode-slidey
VSCODE_DIST    := $(VSCODE_DIR)/.slidey-dist
VSCODE_RUNTIME := $(VSCODE_DIR)/.slidey-runtime/src
NPM_USER_PREFIX ?= $(HOME)/.local

.PHONY: setup doctor test test-render test-vscode test-all ci \
        build-web vscode-stage vscode-package vscode-install-local vscode-clean \
        install

# ── Installation ─────────────────────────────────────────────────────────────
setup:
	npm install
	npm run build:render
	$(MAKE) doctor

doctor:
	npm run doctor

install:
	@mkdir -p "$(NPM_USER_PREFIX)/bin" "$(NPM_USER_PREFIX)/lib"
	@set -eu; \
	for entry in "slidey:src/index.js" "slidey-mcp:src/mcp.js"; do \
		name="$${entry%%:*}"; \
		rel="$${entry#*:}"; \
		bin="$(NPM_USER_PREFIX)/bin/$$name"; \
		target="$(CURDIR)/$$rel"; \
		if [ -L "$$bin" ] && [ "$$(readlink "$$bin")" = "$$target" ]; then \
			echo "[install] replacing existing $$bin -> $$target"; \
			rm -f "$$bin"; \
		fi; \
	done
	npm install --global --prefix "$(NPM_USER_PREFIX)" .
	@echo "[install] installed slidey and slidey-mcp into $(NPM_USER_PREFIX)/bin"
	@echo "[install] make sure $(NPM_USER_PREFIX)/bin is on PATH"

# ── Testing ───────────────────────────────────────────────────────────────────
# `make test` is the everyday target: the fast Node unit suite (no browser, no
# build). The browser-backed audit test self-skips unless dist-render exists, so
# `make test-render` builds that bundle first to exercise it. `make test-all`
# (a.k.a. `make ci`) runs everything CI runs.

# Fast unit suite. The injected-audit browser test skips without dist-render.
test:
	npm test

# Full Node suite including the Puppeteer-backed injected-audit test.
test-render:
	npm run build:render
	npm test

# VS Code extension end-to-end suite (builds the web viewer it loads).
test-vscode:
	npm run test:vscode

# Everything CI runs: full Node suite + VS Code e2e.
test-all: test-render test-vscode

ci: test-all

# ── Web / VS Code packaging ──────────────────────────────────────────────────
build-web:
	npm run build:web

# Stage the built web viewer and the tiny Node runtime the preview API needs so
# the VSIX works after installation, not just from this source checkout.
vscode-stage: build-web
	@rm -rf $(VSCODE_DIST) $(VSCODE_DIR)/.slidey-runtime
	@mkdir -p $(VSCODE_DIST) $(VSCODE_RUNTIME)
	cp -R dist/. $(VSCODE_DIST)/
	# Keep the complete transitive runtime for rrweb-viewer.  It imports
	# collections.js for collection/stack deck expansion during activation.
	cp src/schema.js src/trace.js src/rrweb-viewer.js src/collections.js src/narration.js src/narration-preview.js src/feedback-config.js $(VSCODE_RUNTIME)/

# Output: tools/vscode-slidey/slidey-vscode-<version>.vsix.
vscode-package: vscode-stage
	cd $(VSCODE_DIR) && npm_config_cache="$${npm_config_cache:-$${TMPDIR:-/tmp}/slidey-npm-cache}" npm_config_registry="https://registry.npmjs.org/" npx --yes @vscode/vsce@^3 package --no-dependencies
	@echo "[vscode-package] $$(ls -t $(VSCODE_DIR)/*.vsix | head -1)"

# Override CODE_CLI when testing another compatible editor CLI.
CODE_CLI ?= code
vscode-install-local:
	@command -v $(CODE_CLI) >/dev/null 2>&1 || { \
		echo "error: $(CODE_CLI) not found." >&2; \
		echo "To install it from VS Code: open the Command Palette and run \"Shell Command: Install 'code' command in PATH\"." >&2; \
		echo "Then rerun: make vscode-install-local" >&2; \
		echo "Or run: CODE_CLI=/path/to/code make vscode-install-local" >&2; \
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
