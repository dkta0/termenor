#!/usr/bin/env bash
# Termenor — classic one-line installer.
#   curl -fsSL https://raw.githubusercontent.com/dkta0/termenor/main/install.sh | bash
#
# Downloads the prebuilt client binary for your platform from the latest GitHub release
# and installs it to ~/.local/bin/termenor. Override the source repo with TERMENOR_REPO
# and the install dir with TERMENOR_BIN_DIR.
set -euo pipefail

REPO="${TERMENOR_REPO:-dkta0/termenor}"
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
base_url="https://github.com/${REPO}/releases/latest/download"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

echo "Installing termenor (${os}-${arch}) from ${REPO}…"
if ! curl -fSL --progress-bar "${base_url}/${asset}" -o "${tmp}/${asset}" \
  || ! curl -fSL --progress-bar "${base_url}/SHA256SUMS" -o "${tmp}/SHA256SUMS"; then
  echo "Download failed from ${base_url}" >&2
  echo "No prebuilt binary for ${os}-${arch}? Run from source: git clone https://github.com/${REPO} && cd termenor && bun run play" >&2
  exit 1
fi

expected=""
while read -r digest name; do
  case "$name" in
    "$asset"|*/"$asset") expected="$digest"; break ;;
  esac
done < "${tmp}/SHA256SUMS"
[ -n "$expected" ] || { echo "Release checksum is missing ${asset}" >&2; exit 1; }
if command -v sha256sum >/dev/null 2>&1; then
  actual="$(sha256sum "${tmp}/${asset}")"; actual="${actual%% *}"
else
  actual="$(shasum -a 256 "${tmp}/${asset}")"; actual="${actual%% *}"
fi
[ "$actual" = "$expected" ] || { echo "Checksum verification failed for ${asset}" >&2; exit 1; }

mkdir -p "$BIN_DIR"
install -m 0755 "${tmp}/${asset}" "$BIN_DIR/termenor"

echo "Installed: $BIN_DIR/termenor"
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) echo "Note: add $BIN_DIR to your PATH, e.g. echo 'export PATH=\"$BIN_DIR:\$PATH\"' >> ~/.bashrc" ;;
esac
echo "Play now:  termenor        (connects to the official server)"
echo "Dev server: termenor --server ws://localhost:3000"
