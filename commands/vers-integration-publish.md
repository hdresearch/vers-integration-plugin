---
description: Publish integration stack to Vers.sh registry for sharing
argument-hint: <name> [--public]
allowed-tools: Bash(vers:*)
---

## Context
Project: !`grep "^name:" vers-integration.yaml 2>/dev/null`

## Task

Publish current integration stack to Vers.sh registry as "$ARGUMENTS".

### Steps:
1. Validate configuration (no secrets)
2. Commit current state
3. Upload to vers.sh registry
4. Generate documentation
5. Return registry URL
