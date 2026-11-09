# Cicured PR regression benchmark: OCR_VERSION override

Status: benchmark definition; not yet executed against a live Cicured deployment.

## Purpose

Verify that Cicured's pull-request review catches a behavioural regression that can pass ordinary type-check, lint, build, and existing test gates.

Target: `alibaba/open-code-review#1820`  
Review finding: the install script returns for a `0.0.0` source checkout before resolving an explicit `OCR_VERSION` override.

## Bug contract

Given a source checkout whose package version is `0.0.0`, no pre-existing native binary, and `OCR_VERSION=v1.2.3`:

1. Installation must resolve the explicit override.
2. Installation must download and install the requested release binary.
3. The installed CLI must not fail because the binary is missing.

Control case: when the package version is `0.0.0` and `OCR_VERSION` is unset, the development-checkout path may skip downloading a prebuilt binary and explain that a local build is required.

The regression is present when the installer takes the development-checkout early return even though `OCR_VERSION` is explicitly set.

## Reproduction

Run in a disposable checkout/container, never on a developer's working tree:

```sh
rm -f bin/ocr
OCR_VERSION=v1.2.3 npm install
test -x bin/ocr
```

The fixture must control the package version and download endpoint so the test is deterministic and does not depend on a live release asset. Record the installer exit code, requested version, download invocation, installed binary path, and final CLI smoke-test result.

Run the control case separately with `OCR_VERSION` unset. Do not let the two cases share an installed binary or npm cache state.

## Cicured execution requirements

1. Register `alibaba/open-code-review` as a Cicured GitHub project and confirm that the GitHub App installation has access to it.
2. Confirm the API has a GitHub webhook secret and the diff-review LLM is enabled (`OPENROUTER_API_KEY`, `LLM_API_BASE`, and `LLM_REVIEW_MODEL` configured).
3. Submit the vulnerable PR revision through a `pull_request` event with action `opened` or `synchronize`. The API's PR path only processes registered projects and the configured installation.
4. Capture the AI review result, inline comments, model, token usage, and review status. A background sandbox run is a separate pipeline; its ordinary project test commands are not a substitute for this behavioural reproduction.
5. Submit the corrected revision and verify that Cicured does not report the same issue as still present.

## Pass/fail criteria

A passing detection requires all of the following:

- Cicured identifies the early return as incorrect when `OCR_VERSION` is set.
- The finding explains that `resolveVersion(pkg)` (or equivalent effective-version resolution) must happen before the skip decision, or that the skip must be conditional on the override being absent.
- The finding is anchored to a changed line in `scripts/install.js` and is posted as a valid GitHub review comment.
- The independent reproduction fails on the vulnerable revision and passes on the corrected revision.
- The corrected revision no longer receives the same finding.

A generic comment about missing binaries, an unanchored summary, a hallucinated line position, or a review that silently skips the hunk is not a pass.

## What this benchmark measures

This benchmark primarily measures Cicured's diff-scoped semantic PR reviewer. The deterministic SFT-Dev gates and report parsers remain useful, but they cannot infer this specific environment-variable contract unless a test or custom command encodes it.

The current PR reviewer sends each diff hunk to the configured LLM and posts validated inline comments. It is bounded by the configured review-hunk/comment caps. The worker's sandbox run is queued separately. Therefore, record both pipelines independently; do not conflate a successful sandbox run with a successful semantic review.

## Evidence to retain

- Target repository, PR number, head SHA, and webhook delivery ID
- Cicured webhook response status and run ID, if created
- Raw diff/hunk supplied to the reviewer (with secrets removed)
- Model identifier, prompt version, token counts, duration, and review status
- Posted review URL and inline comment positions
- Vulnerable/control/fixed reproduction results and logs

## Current limitations / honest reporting

This file defines the benchmark; it does not claim the target PR has been run through Cicured. A live run requires the target repository to be registered with the Cicured GitHub App and the deployment's webhook/LLM configuration to be active. The GitHub source inspection alone cannot prove those runtime conditions.
