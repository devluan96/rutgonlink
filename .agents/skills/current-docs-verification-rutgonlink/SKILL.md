---
name: current-docs-verification-rutgonlink
description: Verify version-sensitive framework, browser, SDK, deploy, and API behavior against current primary documentation before changing this repo. Use for Vercel, Supabase, OpenAI, browser APIs, npm upgrades, and third-party integrations.
---

# Current Docs Verification

Use this skill when correctness depends on behavior that may have changed since model training.

## Quick Start

1. Identify the exact behavior that matters.
2. Prefer primary docs over memory, blogs, or forum answers.
3. Capture only the doc facts needed for the change.
4. State the version or date when it matters.
5. Mark any inference as inference.

## When to Use

Use this skill for:

- browser APIs and event behavior
- iframe, popup, redirect, visibility, or attribution flows
- Vercel deployment or runtime configuration
- Supabase client, auth, or database behavior
- OpenAI, Codex, MCP, or model-specific configuration
- npm package upgrades or new package adoption
- any task where the user asks for the latest or current behavior

## Workflow

### 1. Narrow the question

Turn the task into one concrete verification target, such as:

- exact config key or supported value
- API method shape
- browser support or event timing
- auth or cookie behavior
- CLI command or install surface

### 2. Use the highest-trust source available

Order of preference:

1. official product or framework docs
2. official package README or source repo docs
3. primary release notes or changelog

If a docs MCP is available, use it.
If not, browse official docs directly.

### 3. Pull only what the code change needs

Do not over-research.
Verify the minimum facts needed to unblock a correct implementation.

Examples:

- supported `config.toml` key names
- browser restrictions around `window.open`, iframes, or user gestures
- SDK option names and defaults
- deployment environment variable behavior

### 4. Apply the result carefully

If docs and local code disagree:

- preserve current behavior if the task is a bug fix
- migrate deliberately if the task is an upgrade
- call out the compatibility risk when a docs-driven change may alter production behavior

## Output Rules

- Link the source you used.
- Include exact versions or dates when relevant.
- Say when something is inferred rather than directly documented.
- If you could not verify a claim from a primary source, do not present it as settled.
