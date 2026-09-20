#!/bin/sh
# Build the static demo on Forge. Does not start Node, PM2, or PHP.
# Uses a user-local Node 24 so /usr/bin/node (and docs.frontierz.com) stay unchanged.
set -eu
cd "$(dirname "$0")/.."
NODE_VERSION="${ANNIE_NODE_VERSION:-24.8.0}"
NODE_DIR="${HOME}/.local/node-v${NODE_VERSION}"
if [ ! -x "${NODE_DIR}/bin/node" ]; then
  mkdir -p "${HOME}/.local"
  curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz" |
    tar -xJ -C "${HOME}/.local"
  rm -rf "${NODE_DIR}"
  mv "${HOME}/.local/node-v${NODE_VERSION}-linux-x64" "${NODE_DIR}"
fi
export PATH="${NODE_DIR}/bin:${PATH}"
npm ci
npm run build:demo
