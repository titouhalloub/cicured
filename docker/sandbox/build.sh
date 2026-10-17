#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")/../.."

echo "[build.sh] building @sft/parser graph bundle"
pnpm --filter @sft/parser build:graph
stage=docker/sandbox/.graph-stage
nm=packages/parser/node_modules
rm -rf "$stage"
mkdir -p "$stage/node_modules" "$stage/grammars"
cp packages/parser/bin/build-graph.js "$stage/"
cp -rL "$nm/web-tree-sitter" "$stage/node_modules/"
cp -L "$nm/tree-sitter-go/tree-sitter-go.wasm" \
      "$nm/tree-sitter-python/tree-sitter-python.wasm" \
      "$nm/tree-sitter-rust/tree-sitter-rust.wasm" \
      "$nm/tree-sitter-typescript/tree-sitter-typescript.wasm" \
      "$nm/tree-sitter-typescript/tree-sitter-tsx.wasm" \
      "$stage/grammars/"
echo "[build.sh] graph stage ready: $(ls "$stage/grammars" | wc -l) grammars"

docker build -f docker/sandbox/Dockerfile -t cicured/sandbox:node20 .
