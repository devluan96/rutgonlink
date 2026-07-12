---
name: research-before-build-rutgonlink
description: Check the existing RutGonLink code, tests, packages, and current docs before adding new utilities, integrations, or dependencies. Use for new features, helper abstractions, tracking work, and third-party service changes.
---

# Research Before Build

Use this skill when a request might already be solved by existing repo code, a maintained package, or a platform feature.

## Quick Start

1. Search the repo first with `rg`.
2. Read the nearest tests before changing runtime code.
3. Check package or platform options before writing new helpers.
4. Choose one path: adopt, extend, or build.
5. Say which channels you actually checked.

## Workflow

### 1. Search the repo before inventing structure

Start with `rg --files` and targeted `rg` queries in the most likely surfaces:

- `api/` for server behavior and HTML templates
- `public/` for browser runtime code
- `tests/` for current behavior and edge cases
- `scripts/` for operational tooling

Prefer extending a nearby implementation over creating a parallel utility.

### 2. Let tests show the real behavior

In this repo, tests are often the fastest way to understand intent.

For article-funnel work, inspect the closest files first:

- `tests/article-funnel-*.test.js`
- `api/templates/`
- `public/article-funnel-*`

If a behavior is already covered by tests, preserve that behavior unless the task explicitly changes it.

### 3. Check whether the problem is already solved elsewhere

Before adding code, check whether the need is better handled by:

- an existing dependency already in `package.json`
- a small maintained package
- a browser or Node built-in
- a platform feature already supported by Vercel, Supabase, or the target SDK

Do not add a dependency if a small local change is clearer and safer.
Do not build a custom wrapper if the platform primitive is already enough.

### 4. Decide deliberately

Use this decision rule:

- **Adopt** when an existing repo module or maintained package already fits.
- **Extend** when something close exists and only needs a thin layer.
- **Build** only when repo search and docs search still leave a real gap.

### 5. Keep the result thin

If you do build:

- keep new abstractions narrow
- avoid generic helper layers for one call site
- prefer naming tied to the actual product behavior
- add or update tests with the change

## Guardrails

- Do not claim package or docs coverage you did not verify.
- For version-sensitive behavior, verify against primary documentation.
- If the search surface is incomplete, say so plainly.
- If two options are both reasonable, prefer the one with less hidden maintenance.
