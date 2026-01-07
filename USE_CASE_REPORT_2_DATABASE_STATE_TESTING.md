# Use Case Report: Database State Testing Plugin

## Overview

This document details the Claude Code plugin/skill design for **database state testing** using Vers VM branching, based on the [Database State Testing Tutorial](https://docs.vers.sh/tutorials/database-state-testing).

---

## Problem Statement

### Traditional Database Testing Pain Points

1. **Slow Setup:** Loading production-like data takes 10-30 minutes
2. **Destructive Tests:** Schema migrations, data transformations can't be easily undone
3. **Serial Execution:** Must reset database between tests
4. **Environment Drift:** Test database diverges from production schema
5. **Migration Fear:** Teams avoid migrations due to rollback complexity

### Example: Schema Migration Testing

A team needs to test 3 different migration strategies:
- Strategy A: Add column with default (locks table)
- Strategy B: Add nullable column, backfill, add constraint
- Strategy C: Create new table, migrate data, swap

**Traditional approach:**
- Load prod data (20 min)
- Run migration A (5 min)
- Validate
- **Reset database** (20 min)
- Load prod data again
- Run migration B...

Total: **2+ hours**, extremely error-prone

---

## Vers Solution

### Branch-from-Baseline Pattern

```
┌─────────────────────────────────────────────────────────────┐
│                   SETUP PHASE (once)                         │
│  1. Start PostgreSQL                                         │
│  2. Load schema                                              │
│  3. Import production-like data (anonymized)                 │
│  4. Verify data integrity                                    │
│                                                              │
│  ═══════════════ COMMIT CHECKPOINT ═══════════════          │
│                "production-baseline"                         │
└─────────────────────────┬───────────────────────────────────┘
                          │
        ┌─────────────────┼─────────────────┐
        ▼                 ▼                 ▼
   ┌──────────┐     ┌──────────┐     ┌──────────┐
   │ Branch   │     │ Branch   │     │ Branch   │
   │migration-│     │migration-│     │migration-│
   │    A     │     │    B     │     │    C     │
   └────┬─────┘     └────┬─────┘     └────┬─────┘
        │                │                │
        ▼                ▼                ▼
   Run migration    Run migration    Run migration
   Strategy A       Strategy B       Strategy C
        │                │                │
        ▼                ▼                ▼
   Measure time     Measure time     Measure time
   Check locks      Check locks      Check locks
   Validate data    Validate data    Validate data
        │                │                │
        └────────────────┼────────────────┘
                         ▼
              ┌─────────────────────┐
              │  COMPARE RESULTS    │
              │  A: 45s, locks: 30s │
              │  B: 90s, locks: 0   │
              │  C: 120s, locks: 0  │
              │                     │
              │  Recommend: B       │
              └─────────────────────┘
```

**Vers approach:** 20 min setup + instant branching + parallel testing = **25 minutes total**

---

## Plugin Design

### Skill: vers-database-testing

```markdown
---
name: vers-database-testing
description: >
  Database state testing using Vers VM branching. Activate when user
  mentions: database testing, migration testing, schema changes, PostgreSQL
  testing, MySQL testing, data transformation, ETL testing, rollback testing.
globs:
  - "**/migrations/**"
  - "**/*.sql"
  - "**/schema.*"
  - "**/seeds/**"
---

# Database State Testing with Vers

## When to Use This Pattern

Use Vers VM branching for database testing when:
- Testing schema migrations with production-like data
- Comparing multiple migration strategies
- Testing data transformations/ETL
- Need instant rollback capability
- Running destructive tests safely

## Core Workflow

### 1. Setup Phase
Load your database with production-like data:
```bash
# Start services
vers integration up

# Load schema and data
vers execute "psql -f schema.sql"
vers execute "pg_restore -d app production-anonymized.dump"

# Verify
vers execute "psql -c 'SELECT COUNT(*) FROM users;'"
```

### 2. Checkpoint
```bash
vers commit --tag "production-baseline"
```
This captures:
- Complete database state (all tables, indexes, constraints)
- PostgreSQL process state (connections, caches)
- Transaction log position

### 3. Branch & Test
```bash
# Test migration strategy A
vers branch --alias migration-strategy-a
vers checkout migration-strategy-a
vers execute "psql -f migrations/strategy-a.sql"
vers execute "npm run validate-migration"

# Test migration strategy B (from baseline, not A!)
vers checkout production-baseline
vers branch --alias migration-strategy-b
vers checkout migration-strategy-b
vers execute "psql -f migrations/strategy-b.sql"
vers execute "npm run validate-migration"
```

### 4. Compare Results
```bash
# Get metrics from each branch
vers checkout migration-strategy-a
METRICS_A=$(vers execute "npm run migration-metrics")

vers checkout migration-strategy-b
METRICS_B=$(vers execute "npm run migration-metrics")

# Compare
echo "Strategy A: $METRICS_A"
echo "Strategy B: $METRICS_B"
```

## Quick Reference

| Command | Description |
|---------|-------------|
| `vers commit --tag <name>` | Checkpoint database state |
| `vers branch --alias <name>` | Create test branch |
| `vers checkout <tag>` | Return to checkpoint |
| `vers rollback <tag>` | Discard changes, return to tag |
```

### Slash Command: /vers-db-migration-test

```markdown
---
description: Test database migration strategies in parallel
argument-hint: <baseline> <migration1.sql> <migration2.sql> ...
allowed-tools: Bash(vers:*), Read
---

## Task

Test multiple migration strategies from a baseline checkpoint.

Given baseline "$1" and migrations "$2...", this command will:

1. For each migration file:
   ```bash
   # Create branch from baseline
   vers checkout "$1"
   vers branch --alias "migration-$(basename $file .sql)"

   # Run migration
   vers execute "psql -f $file"

   # Collect metrics
   vers execute "psql -c 'SELECT * FROM migration_metrics();'"
   ```

2. Compare results across all branches

3. Recommend optimal strategy based on:
   - Execution time
   - Lock duration
   - Data integrity
```

### MCP Tools

```typescript
// tools/db_checkpoint.ts
server.registerTool("db_checkpoint", {
  description: "Create checkpoint of current database state",
  inputSchema: {
    tag: z.string().describe("Checkpoint tag name"),
    database: z.string().optional().default("postgres"),
    include_stats: z.boolean().optional().default(true)
  }
}, async ({ tag, database, include_stats }) => {
  // Get database statistics before checkpoint
  let stats = {};
  if (include_stats) {
    const { stdout } = await execVers(`execute "psql -d ${database} -c 'SELECT relname, n_live_tup FROM pg_stat_user_tables ORDER BY n_live_tup DESC;'"`);
    stats = { tables: stdout };
  }

  // Commit VM state
  const { stdout: commitOut } = await execVers(`commit --tag "${tag}"`);
  const commitId = JSON.parse(commitOut).commit_id;

  return {
    content: [{
      type: "text",
      text: JSON.stringify({
        status: "checkpoint_created",
        tag,
        commit_id: commitId,
        database_stats: stats,
        usage: {
          branch: `vers branch --alias test-branch --from ${tag}`,
          restore: `vers checkout ${tag}`,
          rollback: `vers rollback ${tag}`
        }
      }, null, 2)
    }]
  };
});

// tools/db_migration_test.ts
server.registerTool("db_migration_test", {
  description: "Test database migration with automatic branching and rollback",
  inputSchema: {
    baseline: z.string().describe("Baseline checkpoint to test from"),
    migration: z.string().describe("Migration SQL file or command"),
    validation: z.string().optional().describe("Validation command to run after migration"),
    collect_metrics: z.boolean().optional().default(true)
  }
}, async ({ baseline, migration, validation, collect_metrics }) => {
  const branchName = `migration-test-${Date.now()}`;

  // Create branch from baseline
  await execVers(`checkout ${baseline}`);
  await execVers(`branch --alias ${branchName}`);
  await execVers(`checkout ${branchName}`);

  const result: any = { branch: branchName, baseline };

  // Run migration
  const startTime = Date.now();
  try {
    if (migration.endsWith('.sql')) {
      await execVers(`execute "psql -f ${migration}"`);
    } else {
      await execVers(`execute "${migration}"`);
    }
    result.migration_time_ms = Date.now() - startTime;
    result.migration_status = "success";
  } catch (error) {
    result.migration_time_ms = Date.now() - startTime;
    result.migration_status = "failed";
    result.migration_error = error.message;
  }

  // Run validation if provided
  if (validation && result.migration_status === "success") {
    try {
      const { stdout } = await execVers(`execute "${validation}"`);
      result.validation_status = "passed";
      result.validation_output = stdout;
    } catch (error) {
      result.validation_status = "failed";
      result.validation_error = error.message;
    }
  }

  // Collect metrics
  if (collect_metrics) {
    const { stdout: metrics } = await execVers(`execute "psql -c 'SELECT * FROM pg_stat_user_tables;'"`);
    result.table_stats = metrics;
  }

  return {
    content: [{
      type: "text",
      text: JSON.stringify(result, null, 2)
    }]
  };
});

// tools/db_compare_branches.ts
server.registerTool("db_compare_branches", {
  description: "Compare database state between branches",
  inputSchema: {
    branches: z.array(z.string()).describe("Branch names to compare"),
    comparison_query: z.string().optional().describe("SQL query to run on each branch")
  }
}, async ({ branches, comparison_query }) => {
  const defaultQuery = `
    SELECT
      schemaname,
      relname as table_name,
      n_live_tup as row_count,
      pg_size_pretty(pg_total_relation_size(relid)) as total_size
    FROM pg_stat_user_tables
    ORDER BY n_live_tup DESC;
  `;

  const query = comparison_query || defaultQuery;
  const results: Record<string, any> = {};

  for (const branch of branches) {
    await execVers(`checkout ${branch}`);
    const { stdout } = await execVers(`execute "psql -c '${query.replace(/'/g, "\\'")}'"`)
    results[branch] = stdout;
  }

  return {
    content: [{
      type: "text",
      text: JSON.stringify({
        branches,
        comparison_query: query,
        results
      }, null, 2)
    }]
  };
});
```

---

## Complete Example: Migration Strategy Testing

### vers-integration.yaml

```yaml
name: migration-testing
version: 1.0.0

vm:
  memory_mib: 4096
  vcpu: 2
  storage_mib: 16000

services:
  postgres:
    template: postgres@15
    config:
      databases: [app]
      extensions: [uuid-ossp, pg_stat_statements]
      settings:
        shared_buffers: 1GB
        log_lock_waits: on
        deadlock_timeout: 1s

tests:
  migrations:
    setup:
      - psql -f schema/v1.sql
      - pg_restore -d app fixtures/production-sample.dump
    checkpoint: production-baseline

    branches:
      - name: add-column-with-default
        description: "ALTER TABLE ADD COLUMN with DEFAULT (locks table)"
        migration: migrations/v2-strategy-a.sql
        metrics:
          - lock_duration
          - execution_time
          - index_bloat

      - name: add-nullable-backfill
        description: "Add nullable, backfill in batches, add constraint"
        migration: migrations/v2-strategy-b.sql
        metrics:
          - lock_duration
          - execution_time
          - index_bloat

      - name: new-table-swap
        description: "Create new table structure, migrate data, swap"
        migration: migrations/v2-strategy-c.sql
        metrics:
          - lock_duration
          - execution_time
          - index_bloat

checkpoints:
  - name: schema-v1
    after: tests.migrations.setup[0]
  - name: production-baseline
    after: tests.migrations.setup[1]
```

### Migration Files

**Strategy A: Direct ALTER (migrations/v2-strategy-a.sql)**
```sql
-- Fast but locks table for duration
ALTER TABLE users
ADD COLUMN premium_level INTEGER DEFAULT 0 NOT NULL;

-- Add index
CREATE INDEX CONCURRENTLY idx_users_premium ON users(premium_level);
```

**Strategy B: Nullable + Backfill (migrations/v2-strategy-b.sql)**
```sql
-- Step 1: Add nullable column (instant)
ALTER TABLE users ADD COLUMN premium_level INTEGER;

-- Step 2: Backfill in batches (no lock)
DO $$
DECLARE
  batch_size INTEGER := 10000;
  total_rows INTEGER;
  offset_val INTEGER := 0;
BEGIN
  SELECT COUNT(*) INTO total_rows FROM users WHERE premium_level IS NULL;

  WHILE offset_val < total_rows LOOP
    UPDATE users
    SET premium_level = 0
    WHERE id IN (
      SELECT id FROM users
      WHERE premium_level IS NULL
      ORDER BY id
      LIMIT batch_size
    );
    offset_val := offset_val + batch_size;
    COMMIT;
  END LOOP;
END $$;

-- Step 3: Add constraint (brief lock)
ALTER TABLE users
ALTER COLUMN premium_level SET NOT NULL,
ALTER COLUMN premium_level SET DEFAULT 0;

-- Step 4: Add index
CREATE INDEX CONCURRENTLY idx_users_premium ON users(premium_level);
```

**Strategy C: New Table Swap (migrations/v2-strategy-c.sql)**
```sql
-- Step 1: Create new table with desired schema
CREATE TABLE users_v2 (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL,
  name TEXT,
  premium_level INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Step 2: Copy data
INSERT INTO users_v2 (id, email, name, premium_level, created_at)
SELECT id, email, name, 0, created_at FROM users;

-- Step 3: Swap tables (brief lock)
BEGIN;
ALTER TABLE users RENAME TO users_old;
ALTER TABLE users_v2 RENAME TO users;
COMMIT;

-- Step 4: Create indexes on new table
CREATE INDEX idx_users_premium ON users(premium_level);
CREATE INDEX idx_users_email ON users(email);

-- Step 5: Drop old table (can be deferred)
-- DROP TABLE users_old;
```

### Running the Test

```bash
# Initialize project
vers build
vers integration up

# Load baseline data
vers execute "psql -f schema/v1.sql"
vers execute "pg_restore -d app fixtures/production-sample.dump"
vers commit --tag production-baseline

# Run migration tests in parallel
vers integration test --suite migrations --parallel

# Output:
# Migration Strategy Comparison
# ============================
#
# | Strategy              | Time    | Lock Duration | Bloat  | Rec |
# |-----------------------|---------|---------------|--------|-----|
# | add-column-with-default| 45s    | 42s          | 0%     | ❌  |
# | add-nullable-backfill | 180s    | <1s          | 2%     | ✓   |
# | new-table-swap        | 240s    | <1s          | 0%     | ✓   |
#
# Recommendation: add-nullable-backfill
# - Minimal locking for production safety
# - Acceptable execution time
# - Low bloat impact
```

---

## Advanced Patterns

### Pattern 1: Rollback Testing

```yaml
tests:
  rollback:
    branches:
      - name: test-rollback
        steps:
          - migration: migrations/v2-up.sql
          - validation: npm run validate-v2
          - rollback: migrations/v2-down.sql
          - validation: npm run validate-v1
        expect:
          - data_preserved: true
          - schema_matches: v1
```

### Pattern 2: Data Transformation Testing

```yaml
tests:
  etl:
    checkpoint: source-data-loaded
    branches:
      - name: etl-full
        command: python etl/full_sync.py
        metrics: [row_count, data_quality_score]

      - name: etl-incremental
        command: python etl/incremental_sync.py
        metrics: [row_count, data_quality_score, sync_time]

      - name: etl-cdc
        command: python etl/cdc_sync.py
        metrics: [row_count, data_quality_score, lag_time]
```

### Pattern 3: Performance Regression Testing

```yaml
tests:
  performance:
    checkpoint: production-baseline
    branches:
      - name: current-schema
        queries: benchmarks/queries.sql
        metrics: [p50, p95, p99, qps]

      - name: with-new-index
        setup: CREATE INDEX idx_new ON orders(customer_id, created_at);
        queries: benchmarks/queries.sql
        metrics: [p50, p95, p99, qps]

    compare:
      baseline: current-schema
      threshold:
        p99: "+10%"  # Fail if p99 increases more than 10%
```

---

## Business Value

### Quantified Benefits

| Metric | Traditional | With Vers | Improvement |
|--------|-------------|-----------|-------------|
| Migration test cycle | 2+ hours | 25 min | 80% faster |
| Strategy comparisons | 1 at a time | Parallel | Instant comparison |
| Rollback confidence | Low (manual) | High (instant) | Risk eliminated |
| Production incidents | Common | Prevented | Measurable reduction |

### Risk Reduction

- **Before:** "We're afraid to run migrations on Friday"
- **After:** "We tested 5 strategies in 20 minutes, deploying the safest one"

### Developer Confidence

- Test with production-scale data safely
- Try experimental approaches without fear
- Instant rollback if anything goes wrong

---

## Implementation Priority

### Phase 1: Core Functionality
- [x] Skill documentation
- [ ] `db_checkpoint` MCP tool
- [ ] `db_migration_test` MCP tool
- [ ] `db_compare_branches` MCP tool

### Phase 2: Database Support
- [ ] PostgreSQL integration
- [ ] MySQL support
- [ ] MongoDB support

### Phase 3: Advanced Features
- [ ] Automatic lock detection
- [ ] Performance regression alerts
- [ ] Schema diff visualization
