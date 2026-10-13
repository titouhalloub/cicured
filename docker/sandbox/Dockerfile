# SFT-Dev sandbox image (Spec §2 worker pre-flight, §8 sandbox security).
#
# The worker launches one container per run through the Docker API (dockerode)
# with these flags, set per container and NOT baked into the image:
#   ReadonlyRootfs, Tmpfs /workspace:1g, SecurityOpt no-new-privileges,
#   CapDrop ALL, Memory 4 GiB, NanoCpus 2e9.
#
# Build from the REPOSITORY ROOT (the COPY path is repo-relative):
#   docker build -f docker/sandbox/Dockerfile -t cicured/sandbox:node20 .
FROM node:20-alpine

# git: clone the run's repo - bash: entrypoint + toolchain scripts -
# ca-certificates: TLS to the git host and the package registry.
# Corepack is NOT installed here: node:20-alpine already bundles the binary, so
# `corepack enable` below is all it takes to get pnpm/yarn (Spec §2 pre-flight).
RUN apk add --no-cache git bash ca-certificates \
    && corepack enable \
    && adduser -D -u 1001 -h /home/sandbox sandbox \
    && mkdir -p /workspace /opt/sft \
    && chown -R sandbox:sandbox /workspace

# Python toolchain (Phase 3d-1): python3 + pip, then pytest and ruff so the
# runner's "Python Tests" / "Python Lint" tasks find their tools on PATH.
# --break-system-packages: Alpine 3.19+ marks the system site-packages as
# externally managed (PEP 668); the sandbox is disposable, so install anyway.
RUN apk add --no-cache python3 py3-pip && \
    pip install --no-cache-dir --break-system-packages pytest ruff

# Go toolchain (Phase 3d-3): the Go binary only. No module cache is warmed
# here — the first sandbox run on a Go repo downloads modules from the network
# (known limitation, deferred to a future phase; same pattern as pnpm store).
RUN apk add --no-cache go

# Go toolchain (Phase 3d-3): `go` on PATH for the runner's "Go Vet" /
# "Go Tests" tasks. No warm module cache — the first sandbox run on a Go repo
# downloads modules from the network (known limitation, deferred like the
# pnpm store cache).
RUN apk add --no-cache go

# Semgrep (Phase 3a): multi-language SAST. Installed via pip because Alpine's
# apk repos don't carry a current semgrep package. The version is pinned —
# Semgrep's rule registry evolves, and a floating version would change findings
# without a cicured commit. --break-system-packages is required on Alpine 3.19+
# (PEP 668), same as the Python toolchain install. --config auto fetches rules
# on first run and caches them in the container tmpfs (destroyed on exit); a
# future phase may mount a rule cache, same pattern as the pnpm store.
RUN pip install --no-cache-dir --break-system-packages semgrep==1.173.0

COPY docker/sandbox/entrypoint.sh /opt/sft/entrypoint.sh
RUN chmod +x /opt/sft/entrypoint.sh

# Never root: the workspace tmpfs is mounted with the container user's uid.
USER sandbox
WORKDIR /workspace

# /opt/sft/sft-dev.mjs (the pinned runner) is bind-mounted read-only by the
# worker at container start. It is never copied from the user's repo.
ENTRYPOINT ["/opt/sft/entrypoint.sh"]