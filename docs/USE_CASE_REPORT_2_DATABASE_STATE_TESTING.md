# Use Case Report: Database State Testing Plugin

## Overview

This document details the Claude Code plugin/skill design for **database state testing** using Vers VM branching, based on the [Database State Testing Tutorial](https://docs.vers.sh/tutorials/database-state-testing).

---

## Problem Statement

### Traditional Database Testing Pain Points

1. **Expensive Seeding:** Loading production-like data takes 10-30 minutes
2. **Reset Overhead:** Each test requires database reset → schema rebuild → data reload
3. **Migration Risk:** Testing schema migrations on production data is dangerous
4. **Serial Execution:** Can't test multiple migration strategies simultaneously
5. **State Corruption:** Failed tests leave databases in inconsistent states

### Example: Schema Migration Testing

Testing a database migration that adds a `premium_level` column to users table:

**Traditional approach:**
```
Load production data (20 min) → Test migration A → Reset
Load production data (20 min) → Test migration B → Reset
Load production data (20 min) → Test rollback → Reset
Total: 60+ minutes, sequential, high risk
```

---

## Vers Solution

### Snapshot-and-Branch Pattern

```
┌─────────────────────────────────────────────────────────────┐
│                   SETUP PHASE (once)                         │
│  1. Start PostgreSQL                                         │
│  2. Load schema                                              │
│  3. Restore production-like data (anonymized)                │
│  4. Verify data integrity                                    │
│                                                              │
│  ═══════════════ COMMIT CHECKPOINT ═══════════════          │
│                  "production-loaded"                         │
└─────────────────────────┬───────────────────────────────────┘
                          │
        ┌─────────────────┼─────────────────┐
        ▼                 ▼                 ▼
   ┌─────────┐      ┌─────────┐      ┌─────────┐
   │ Branch  │      │ Branch  │      │ Branch  │
   │migration│      │migration│      │rollback │
   │   -v1   │      │   -v2   │      │  -test  │
   └────┬────┘      └────┬────┘      └────┬────┘
        │                │                │
        ▼                ▼                ▼
   Run migration    Run alternative   Test rollback
   strategy v1      strategy v2       procedure
        │                │                │
        ▼                ▼                ▼
   ┌─────────────────────────────────────────┐
   │         COMPARE RESULTS                  │
   │  - Schema correctness                    │
   │  - Data integrity                        │
   │  - Performance impact                    │
   │  - Rollback safety                       │
   └─────────────────────────────────────────┘
```

**Vers approach:** 20 min setup + instant branching + parallel testing = **25 minutes total**

---

## Plugin Design

### Skill: vers-database-testing

**File:** `skills/vers-database-testing/SKILL.md`

```yaml
---
name: vers-database-testing
description: >
  Database state testing using Vers VM branching. Activate when user mentions:
  database testing, PostgreSQL, MySQL, schema migration, data seeding,
  migration testing, database snapshot, production data testing, ETL testing.
globs:
  - "**/migrations/**"
  - "**/*.sql"
  - "**/schema.*"
  - "**/seeds/**"
---
```

**Core Knowledge:**
- When to checkpoint database state
- How to branch for migration testing
- How to compare database states across branches
- Safe rollback procedures

### MCP Tools

#### `db_checkpoint`
Captures complete PostgreSQL state including memory buffers.

#### `db_migration_test`
Tests a migration in an isolated branch with automatic rollback capability.

#### `db_compare_branches`
Compares database state (row counts, schema) between two branches.

---

## Complete Example: E-Commerce Schema Migration

### Test Configuration

```yaml
name: ecommerce-migration-test
version: 1.0.0

vm:
  memory_mib: 4096
  vcpu: 2

services:
  postgres:
    template: postgres@15
    config:
      databases: [ecommerce]

tests:
  migration:
    checkpoint: production-loaded
    branches:
      - name: add-column-with-default
        command: psql -f migrations/v2-strategy-a.sql
      - name: add-column-backfill
        command: psql -f migrations/v2-strategy-b.sql
      - name: rollback-test
        command: psql -f migrations/v2-up.sql && psql -f migrations/v2-down.sql
```

### Expected Output

```
Migration Tests
===============

Branch: add-column-with-default
  Duration: 45s (table locked for 43s)
  Row count: 1,000,000 users
  Validation: ✓ passed

Branch: add-column-backfill
  Duration: 180s (0s lock time)
  Row count: 1,000,000 users
  Validation: ✓ passed

Branch: rollback-test
  Schema after rollback: matches original ✓

Recommendation: Use Strategy B for production (zero-downtime)
```

---

## Business Value

| Metric | Traditional | With Vers | Improvement |
|--------|-------------|-----------|-------------|
| Migration test setup | 20 min/test | 20 min once | 80% reduction |
| Parallel strategy testing | Not possible | Instant | Enables A/B |
| Risk of data corruption | High | Zero | Instant rollback |
| Debug time | Hours | Minutes | Exact state restore |

---

## Implementation Status

### Phase 1: Core Database Support
- [x] Skill documentation
- [ ] `db_checkpoint` MCP tool
- [ ] `db_migration_test` MCP tool
- [ ] `db_compare_branches` MCP tool

### Phase 2: Advanced Features
- [ ] Schema diff visualization
- [ ] Performance comparison
- [ ] MySQL/MongoDB support

### Phase 3: Production Integration
- [ ] Anonymized snapshot workflow
- [ ] Scheduled regression testing
