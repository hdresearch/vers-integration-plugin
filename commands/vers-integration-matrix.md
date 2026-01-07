---
description: Run matrix test across service version combinations
argument-hint: [--filter service=version] [--parallel]
allowed-tools: Bash(vers:*)
---

## Context
Matrix: !`grep -A10 "^matrix:" vers-integration.yaml 2>/dev/null`

## Task

Test all combinations of service versions defined in matrix.

### Steps:
1. Parse matrix configuration
2. Generate all version combinations
3. For each combination:
   - Create branch
   - Update service versions in VM
   - Run tests
   - Record results
4. Report compatibility matrix
