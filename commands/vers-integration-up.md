---
description: Start all services in the integration stack
argument-hint: [--build] [--checkpoint <name>]
allowed-tools: Bash(vers:*), Read
---

## Context
Manifest: !`cat vers-integration.yaml 2>/dev/null | head -30`
Status: !`vers status 2>/dev/null || echo "Not in Vers environment"`

## Task

Start all services defined in vers-integration.yaml.

### Steps:
1. Build VM if `--build` specified or no VM exists
2. Start services in dependency order via SSH into VM
3. Wait for all health checks to pass
4. Create checkpoint if `--checkpoint` specified
5. Report service status and endpoints
