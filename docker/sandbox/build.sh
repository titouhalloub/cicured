#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")/../.."
docker build -f docker/sandbox/Dockerfile -t cicured/sandbox:node20 .
