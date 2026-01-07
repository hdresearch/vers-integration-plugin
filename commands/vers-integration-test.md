---
description: Run integration tests across VM branches
argument-hint: [--suite <name>] [--parallel]
allowed-tools: Bash(vers:*)
---

## Context
Status: !`vers status 2>/dev/null`
Tests: !`grep -A20 "^tests:" vers-integration.yaml 2>/dev/null`

## Task

Run integration tests using Vers branching for parallel execution.

### Steps:
1. Commit baseline checkpoint
2. For each test suite/branch:
   - Create VM branch (instant, copy-on-write)
   - Set environment variables
   - Execute test command via SSH
   - Capture results
3. Aggregate and report results
