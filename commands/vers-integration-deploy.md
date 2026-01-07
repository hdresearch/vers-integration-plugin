---
description: Deploy integration stack to Vers.sh hosted environment
argument-hint: <environment> [--branch <name>]
allowed-tools: Bash(vers:*)
---

## Context
Deploy config: !`grep -A15 "^deploy:" vers-integration.yaml 2>/dev/null`
Current branch: !`vers status 2>/dev/null`

## Task

Deploy to "$ARGUMENTS" environment on Vers.sh hosted infrastructure.

### Steps:
1. Validate services are healthy
2. Commit current VM state
3. Push commit to vers.sh hosted
4. Configure networking/SSL/domain
5. Return deployment URL
