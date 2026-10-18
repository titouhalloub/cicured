Here's the document. Paste it into `docs/BUSINESS_MODEL.md` on the VM.

```markdown
# Cicured Business Model

**Status:** strategic anchor, pre-launch
**Last updated:** 2026-10-18
**Supersedes:** the tier discussion in §13 of `EXTENDED_ANALYSIS_PLAN.md`

---

## The pitch, in one sentence

**The PR comment is free forever. The memory behind it is the paid tier.**

Everything else — CLI, MCP server, graph builder, runner, parsers — exists to produce that comment. The comment is the product. Memory is the business.

---

## The two comments

### Free tier — what the user runs

`$ sft run --post-comment` posts this, using the user's own compute, their own BYOK key, their own GitHub token.

```
┌─ cicured · Build failed ─────────────────────────────────────┐
│                                                              │
│  🔴 TS2339  src/auth.ts:42:5                                 │
│  'userProfile' is defined but never used                     │
│                                                              │
│  Context                                                     │
│    Function:  AuthHandler (line 38)                          │
│    Called by: 3 files (login.ts, oauth.ts, api.ts)           │
│    Tests:     2 (auth.spec.ts, api.spec.ts)                  │
│                                                              │
│  Suggested fix · graph-validated · 1 file touched            │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ - const userProfile = await getUser(userId);           │  │
│  │ + return await getUser(userId);                        │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  Confidence: high (deterministic tsc error)                  │
│                                                              │
│  [View in cicured]  [Apply fix]  [Dismiss]                   │
└──────────────────────────────────────────────────────────────┘
```

**Cost to cicured: $0.** The user paid the tokens. The user paid the compute. The user's GitHub App posted the comment.

**Quality:** this comment is structurally better than what CodeRabbit, Greptile, or Dagny post. It has a graph-validated fix, real callers, real tests. Not AI reasoning — measured finding.

---

### Paid tier — what cicured remembers

Same finding. Same graph context. Same fix. **Plus a memory block appended below the comment.**

```
┌─ cicured · Build failed ─────────────────────────────────────┐
│                                                              │
│  🔴 TS2339  src/auth.ts:42:5                                 │
│  'userProfile' is defined but never used                     │
│                                                              │
│  Context                                                     │
│    Function:  AuthHandler (line 38)                          │
│    Called by: 3 files (login.ts, oauth.ts, api.ts)           │
│    Tests:     2 (auth.spec.ts, api.spec.ts)                  │
│                                                              │
│  Suggested fix · graph-validated · 1 file touched            │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ - const userProfile = await getUser(userId);           │  │
│  │ + return await getUser(userId);                        │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  Confidence: high (deterministic tsc error)                  │
│                                                              │
│  [View in cicured]  [Apply fix]  [Dismiss]                   │
└──────────────────────────────────────────────────────────────┘

┌─ 📊 cicured memory ──────────────────────────────────────────┐
│                                                              │
│  Pattern history                                             │
│    First seen      2026-09-15 · 34 days ago                  │
│    Occurrences     12 this month · 47 all-time               │
│    Fixes accepted  11 of 12 · avg 4 min to resolution        │
│                                                              │
│  Team context                                                │
│    3 other repos hit this rule                               │
│      → api-v2 · worker · sdk                                 │
│    Rule marked low-priority by @sam · 2026-09-20             │
│    Related PR #234 by @maya · fixed same rule · 2026-09-02   │
│                                                              │
│  Cost attribution                                            │
│    AI tokens this pattern       ~$0.41                       │
│    Engineer time this pattern   ~3.2 hours                   │
│    Estimated annual cost        ~$4,900                      │
│                                                              │
│  [View pattern →]  [47 occurrences →]  [Mark resolved →]     │
└──────────────────────────────────────────────────────────────┘
```

**Cost to cicured:** ~$0.02–0.05 per run (compute) + storage. Sustainable at $29/dev/month.

**Quality:** identical comment, but with memory that **cannot be generated locally**. It requires cicured to have seen this finding before — across this repo, across this user's other repos, across the org.

---

## Why the split works

### The naive split doesn't work

A common approach is: free tier gets the basic comment, paid tier gets the "extended" comment with graph context and validated fix.

**This fails.** Because:

1. The code is MIT. Anyone can run it.
2. The user has their own `ANTHROPIC_API_KEY` (most power users do).
3. The graph builder, parser, and fix-validation logic all run client-side.
4. So anyone with the CLI can produce the "extended" comment without paying.

Gating the extended comment would require crippling the CLI, which kills the free tier's adoption story. Users see through it.

### The split that works

The split isn't **content vs. no content**. It's **content vs. content + memory**.

The comment itself is generated locally in both cases. The free tier produces it from the user's own run. The paid tier produces it from the same run, plus:

- **History** — every occurrence of this pattern, over time
- **Team context** — who else hit it, what they decided, what fixed it
- **Cost attribution** — what this pattern is costing in tokens and engineer hours
- **Related PRs** — previous fixes for the same rule

**None of that can be generated locally.** It requires cicured to have:

- Run the finding before (once is not enough for "34 days ago")
- Run it across multiple repos (which requires multi-repo access)
- Aggregated cost data from every run (which requires persistence)
- Tracked team decisions (which requires a shared state)

The user cannot reconstruct this from their own laptop. They would have to build the same aggregation infrastructure cicured is offering. Which is exactly what they came to cicured to avoid.

---

## The three tiers

### Free · $0 forever

**What it includes:**
- `sft run` — 8-task pipeline (typecheck, lint, build, tests, security, Python, Go, Rust)
- `sft graph` — code graph across 5 languages
- `sft explain` — BYOK, graph-aware explanation
- `sft fix` — BYOK, graph-validated patch
- `sft run --post-comment` — posts the full structured comment to PR
- **MCP server** — IDE agents call cicured tools locally, no key needed for graph/findings
- MIT licensed, no account, no telemetry

**Who it's for:** Solo developers, small teams, anyone who wants to try cicured.

**Why it's free:** It costs cicured $0. The user provides the compute, the tokens, the GitHub access. Cicured provides the code.

**What the comment contains:** Structured finding, real graph context (callers, callees, tests), graph-validated fix, confidence.

---

### Team · $29/dev/month

**What it adds:**
- **Webhook-driven runs** — cicured runs on every PR push. No CI config, no CLI invocation.
- **Memory block in comments** — pattern history, team context, cost attribution (the paid tier comment above)
- **Cross-run ledger** — every LLM call tracked, costed, attributed
- **Team dashboard** — spend by user, by repo, by category, trending over time
- **90-day retention** — findings, runs, comments persist
- **Cached fixes** — repeat findings get the previously-validated fix instantly
- **Economic layer** — "Your team spent $47 on AI tokens this month; 40% was preventable"

**What it doesn't add:** different or better comment content. The comment is the same.

**Why it's paid:** Cicured runs the compute. Cicured keeps the history. Cicured does the aggregation.

---

### Enterprise · $30k+/year

**What it adds:**
- **Self-hosted** — runs inside the customer's VPC
- **SSO** — SAML, OIDC, or SCIM
- **Audit log** — every action by every user
- **Custom rule packs** — organization-specific Semgrep rules
- **Forever history** — no retention limit
- **SLA** — uptime guarantees
- **Support** — direct line to the team

**Why it exists:** Procurement requires it. Security teams won't allow a SaaS reading their code. The customer is willing to pay to keep everything internal.

---

## Cost math

### Free tier

| Cost | Amount |
|---|---|
| Compute (user's machine) | $0 |
| LLM tokens (user's BYOK) | $0 |
| GitHub API (user's App) | $0 |
| Storage (local) | $0 |
| **Total to cicured** | **$0** |

### Team tier

For a 10-dev team running 40 PRs/month:

| Cost | Amount |
|---|---|
| Compute (~$0.03/run × 160 runs) | ~$5 |
| LLM tokens (cicured-procured, ~$0.02/run × 160 runs) | ~$3 |
| Storage (90 days, ~400 runs) | ~$2 |
| **Total cost to cicured** | **~$10/month** |
| **Revenue** | **$290/month** |
| **Gross margin** | **~97%** |

### Enterprise tier

| Cost | Amount |
|---|---|
| Infrastructure for customer | ~$500/month |
| Support (2 hrs/week × $75/hr) | ~$600/month |
| **Total cost to cicured** | **~$1,100/month** |
| **Revenue** | **~$2,500/month** (per customer at $30k/yr) |
| **Gross margin** | **~56%** |

Enterprise margin is lower because support is high-touch. But the contract value is 10× the Team tier, so the absolute gross profit is far higher.

---

## Upgrade paths

### Free → Team

**Trigger:** A solo dev runs cicured on their own repo. It works. They love the comment. They want it to run automatically on every PR push without having to invoke the CLI.

**What they're buying:** automation. The comment is the same. The memory layer is the difference.

**Pricing anchor:** $29/dev/month is less than one hour of a dev's time per month. If cicured saves one hour of manual debugging per dev per month, the ROI is positive.

### Team → Enterprise

**Trigger:** Security review, procurement, or a specific compliance requirement. Usually surfaces within the first year of Team usage.

**What they're buying:** self-host, SSO, audit. Not new features — the same product, inside their infrastructure.

**Pricing anchor:** $30k/year is standard for self-hosted developer tools. Less than half the cost of a mid-level engineer.

---

## Roadmap

### Already shipped

- ✅ 8-task pipeline (typecheck, lint, build, tests, security, Python, Go, Rust)
- ✅ Code graph across 5 languages (TS, TSX, Python, Go, Rust)
- ✅ BYOK `sft explain` / `sft fix`
- ✅ Semgrep integration (1,073 rules, offline)
- ✅ Config + auto-detection merge
- ✅ Sandbox image (vendored, offline-buildable)

### Next · 4 sessions

1. **Provider abstraction** — Anthropic + OpenAI-compatible (one adapter covers 40+ providers)
2. **Ledger instrumentation** — track every LLM call, cost it, store it
3. **Ledger display** — CLI output + dashboard card
4. **Memory block** — the paid tier's differentiator in PR comments

### V2 · 3 sessions

5. **PR comments** — GitHub App webhook, inline review, memory block
6. **Team dashboard** — cross-run, cross-user aggregation
7. **Economic layer** — "you spent $X, saved $Y" framing

### V3 · 4 sessions

8. **Self-hosted** — Docker Compose bundle + license check
9. **SSO** — SAML/OIDC
10. **Audit log**

---

## What we're not building

**Diff-scoped review.** CodeRabbit, Greptile, Dagny, Bugbot — all do this. Five established competitors. Cicured would arrive sixth with a worse version. We stay in the execution lane.

**The 40+ language linters that CodeRabbit advertises.** Semgrep covers 30+ languages for security. For typecheck/lint/test, we cover 8 languages natively (TS, TSX, Python, Go, Rust, plus generic lint/test). Adding RuboCop, PHPStan, SwiftLint etc. is not differentiation — it's parity. Parity is a maintenance burden, not a moat.

**A hosted code review dashboard that looks like CodeRabbit.** Cicured's dashboard is a cost ledger, not a review UI. Different product. Different audience.

**The AI-vs-AI pitch.** We don't claim our LLM is better than CodeRabbit's. We claim our input is better — structured findings, not prose guesses. Different bet.

---

## The positioning

> **CodeRabbit reviews your diff. Cicured runs your build.**
>
> Free tier: the best code review comment on your PR. Findings, graph context, validated fixes. MIT. Run it yourself.
>
> Paid tier: the same comment, but now it knows your history. "This pattern fired 12 times this month, here's the cached fix, here's what it costs you."

Two different products:
- **Free:** the comment itself (execution, not reasoning)
- **Paid:** the memory behind it (aggregation, not gating)

Neither is a paywall on the comment. The comment is free forever. The memory is the subscription.

---

## Known risks

1. **The free tier is so good it kills the paid tier.** Mitigated by: the memory block is genuinely impossible to replicate locally. If it turns out users *can* replicate it, the paid tier is dead — but that's a real audit of the product's value, not a marketing problem.

2. **The memory block is expensive to generate.** Requires a per-finding query on every comment post. Mitigated by: 90% of runs hit cached memory (same fingerprint), and the cache is cheap to serve.

3. **Self-hosted pulls users off the SaaS.** Mitigated by: self-hosted is 10× the price. Any user who chooses self-hosted was never going to be a $29/month customer.

4. **A competitor copies the memory block.** Harder than it looks — requires their own multi-customer aggregation, which takes years to build. By the time they have it, cicured has 3 years of trend data.

---

## Status

This document is the strategic anchor for the next 6 months of product work. Every feature decision should be evaluated against one question:

> **Does this make the free comment better, or make the paid memory better?**

If it does neither, it doesn't ship.

---

*Last reviewed: 2026-10-18. Next review: after Memory Block ships.*
```

---

## To save it

On the VM:

```bash
cd ~/cicured
mkdir -p docs
```

Then create the file. Since it's long, easiest is to save it locally in an editor and `scp` it, or paste it into a heredoc. Either works — but if you're on Windows, save it as `E:\cicured\docs\BUSINESS_MODEL.md` directly (Cline or VSCode can handle it), then commit from Windows.

Then:

```bash
cd ~/cicured  # or E:\cicured if saving from Windows
git add docs/BUSINESS_MODEL.md
git commit -m "docs: business model — free comment, paid memory"
git push
```

---

## What this document is

Not a spec. A **reference**. When you're deciding whether to build a feature, read the status section at the bottom:

> **Does this make the free comment better, or make the paid memory better?**

If it does neither, it doesn't ship.

The free tier is `sft run --post-comment` with BYOK. The paid tier is the same command driven by a webhook, with a memory block appended. Same comment, different amount of history.

Everything else — the ledger, the provider abstraction, the config dashboard — is infrastructure for those two things.