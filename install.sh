#!/usr/bin/env bash
# Termenor — classic one-line installer.
#   curl -fsSL https://raw.githubusercontent.com/dakota/termenor/main/install.sh | bash
#
# Downloads the prebuilt client binary for your platform from the latest GitHub release
# and installs it to ~/.local/bin/termenor. Override the source repo with TERMENOR_REPO
# and the install dir with TERMENOR_BIN_DIR.
set -euo pipefail

REPO="${TERMENOR_REPO:-dakota/termenor}"
BIN_DIR="${TERMENOR_BIN_DIR:-$HOME/.local/bin}"

os="$(uname -s)"
arch="$(uname -m)"
case "$os" in
  Linux)  os="linux" ;;
  Darwin) os="darwin" ;;
  *) echo "Unsupported OS: $os (use 'bun run play' from source instead)" >&2; exit 1 ;;
esac
case "$arch" in
  x86_64|amd64) arch="x64" ;;
  aarch64|arm64) arch="arm64" ;;
  *) echo "Unsupported architecture: $arch" >&2; exit 1 ;;
esac

asset="termenor-${os}-${arch}"
url="https://github.com/${REPO}/releases/latest/download/${asset}"

echo "Installing termenor (${os}-${arch}) from ${REPO}…"
mkdir -p "$BIN_DIR"
if ! curl -fSL --progress-bar "$url" -o "$BIN_DIR/termenor"; then
  echo "Download failed: $url" >&2
  echo "No prebuilt binary for ${os}-${arch}? Run from source: git clone https://github.com/${REPO} && cd termenor && bun run play" >&2
  exit 1
fi
chmod +x "$BIN_DIR/termenor"

echo "Installed: $BIN_DIR/termenor"
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) echo "Note: add $BIN_DIR to your PATH, e.g. echo 'export PATH=\"$BIN_DIR:\$PATH\"' >> ~/.bashrc" ;;
esac
echo "Play now:  termenor        (connects to the official server)"
echo "Dev server: termenor --server ws://localhost:3000"
