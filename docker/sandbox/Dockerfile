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
RUN apk add --no-cache git bash ca-certificates curl \
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

# Go toolchain (Phase 3d-3): official tarball, not apk. Alpine's apk go package
# pulls gcc as a phantom cgo dependency (~250 MB compressed for a 70 MB runtime)
# and stalled the image build twice, ~3 hours each time on the gcc download.
# The tarball is ~70 MB, single download, no gcc. CGO_ENABLED=0 makes the
# pure-Go assumption explicit. No warm module cache — the first sandbox run on
# a Go repo downloads modules from the network (known limitation, deferred like
# the pnpm store cache).
RUN set -e; \
      url_primary="https://go.dev/dl/go1.23.3.linux-amd64.tar.gz"; \
      url_mirror="https://mirrors.aliyun.com/golang/go1.23.3.linux-amd64.tar.gz"; \
      if ! wget -q --tries=20 --timeout=300 --waitretry=10 --continue -O /tmp/go.tgz "$url_primary"; then \
        wget -q --tries=20 --timeout=300 --waitretry=10 --continue -O /tmp/go.tgz "$url_mirror"; \
      fi; \
      tar -C /usr/local -xzf /tmp/go.tgz && \
      rm /tmp/go.tgz
ENV PATH="/usr/local/go/bin:${PATH}"
ENV CGO_ENABLED=0

# Semgrep (Phase 3a): multi-language SAST. Installed via pip because Alpine's
# apk repos don't carry a current semgrep package. The version is pinned —
# Semgrep's rule registry evolves, and a floating version would change findings
# without a cicured commit. --break-system-packages is required on Alpine 3.19+
# (PEP 668), same as the Python toolchain install. --config auto fetches rules
# on first run and caches them in the container tmpfs (destroyed on exit); a
# future phase may mount a rule cache, same pattern as the pnpm store.
RUN pip install --no-cache-dir --break-system-packages \
        --retries 10 --timeout 300 \
        semgrep==1.173.0 \
    || pip install --no-cache-dir --break-system-packages \
        --retries 10 --timeout 300 \
        -i https://pypi.tuna.tsinghua.edu.cn/simple \
        semgrep==1.173.0

# Bake a pinned Semgrep rule set as plain yaml. Fetching the bundle
# directly from the registry avoids depending on semgrep's internal
# cache layout, which changes between versions. World-readable so the
# sandbox user can read it on a read-only rootfs.
RUN curl --retry 10 --retry-delay 5 --retry-all-errors -sSL \
      https://semgrep.dev/c/p/ci -o /opt/sft/semgrep-rules.yaml && \
    chmod a+r /opt/sft/semgrep-rules.yaml

# Rust toolchain (Phase 3d-4): rustup installer, not apk. Alpine's apk rust
# package lags upstream and pulls a phantom gcc dependency. build-base +
# musl-dev are the only apk prerequisites needed for linking. rustup-init
# installs the current stable toolchain (~70 MB) non-interactively with the
# minimal profile (no rust-docs/rustfmt). Clippy is added explicitly after.
# --no-modify-path keeps rustup out of .profile; PATH is set via ENV below.
# CARGO_HOME/RUSTUP_HOME are moved off /root so the sandbox user (uid 1001) can
# read the toolchain, and made world-readable for the same reason. No cargo
# registry cache — the first sandbox run on a Rust repo downloads crates from
# crates.io (known limitation, deferred like the pnpm store).
ENV CARGO_HOME=/usr/local/cargo
ENV RUSTUP_HOME=/usr/local/rustup
ENV PATH="/usr/local/cargo/bin:${PATH}"

RUN apk add --no-cache build-base musl-dev curl && \
    ( \
      curl --retry 10 --retry-delay 5 --retry-all-errors --connect-timeout 30 -sSf https://sh.rustup.rs | \
        sh -s -- -y --default-toolchain stable --profile minimal --no-modify-path \
    ) || ( \
      RUSTUP_DIST_SERVER="https://mirrors.ustc.edu.cn/rust-static" \
      RUSTUP_UPDATE_ROOT="https://mirrors.ustc.edu.cn/rust-static/rustup" \
      curl --retry 10 --retry-delay 5 --retry-all-errors --connect-timeout 30 -sSf https://sh.rustup.rs | \
        sh -s -- -y --default-toolchain stable --profile minimal --no-modify-path \
    ) && \
    rustup component add clippy
RUN chmod -R a+rX /usr/local/cargo /usr/local/rustup

COPY docker/sandbox/entrypoint.sh /opt/sft/entrypoint.sh
RUN chmod +x /opt/sft/entrypoint.sh

# Never root: the workspace tmpfs is mounted with the container user's uid.
USER sandbox
WORKDIR /workspace

# /opt/sft/sft-dev.mjs (the pinned runner) is bind-mounted read-only by the
# worker at container start. It is never copied from the user's repo.
ENTRYPOINT ["/opt/sft/entrypoint.sh"]