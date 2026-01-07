---
name: vers-database-testing
description: Database state testing using Vers VM branching. Use when testing schema migrations, feature branches with database changes, data transformations, or any scenario where database setup is expensive. Activate when user mentions database testing, PostgreSQL, MySQL, MongoDB, schema migration, data seeding, parallel database tests, migration testing, or data integrity testing.
globs:
  - "**/migrations/**"
  - "**/schema.sql"
  - "**/seed*.sql"
  - "**/db/**"
---

# Database State Testing with Vers

Vers enables parallel database testing by capturing complete database state—data, schema, running processes, connections—and branching into isolated test environments. Each branch inherits identical starting data without rebuild overhead.

## Core Mental Model

Traditional database testing:
```
Reset DB → Load Schema → Seed Data → Test A → Teardown
Reset DB → Load Schema → Seed Data → Test B → Teardown  (20 min repeated!)
Reset DB → Load Schema → Seed Data → Test C → Teardown  (20 min repeated!)
```

Vers-enabled testing:
```
Reset DB → Load Schema → Seed Data → [Commit Checkpoint]
                                          ├── Branch → Test A (instant)
                                          ├── Branch → Test B (instant)
                                          └── Branch → Test C (instant)
```

## When This Pattern Applies

**High-value scenarios:**
- Schema migration testing (test multiple strategies)
- Feature branch testing (premium features vs inventory management)
- Data transformation validation
- Performance testing with production-like datasets
- Rollback/recovery testing

**Key indicator:** Database setup (schema + seed data) takes more than 30 seconds.

## Quick Reference

```bash
# Build environment with database
vers build

# Initialize database with schema and seed data
vers connect
> psql -f schema.sql
> psql -f seed-data.sql
> # Database now has baseline e-commerce data

# Checkpoint the state
vers commit --tag "Base e-commerce schema with sample data loaded"

# Create parallel branches for different features
vers branch --alias premium-features-test
vers branch --alias inventory-management-test

# Execute tests in parallel (separate terminals)
vers checkout premium-features-test && vers execute "node premium-test.js"
vers checkout inventory-management-test && vers execute "node inventory-test.js"
```

## Environment Requirements

Your `vers.toml` should allocate sufficient resources:

```toml
[vm]
memory_mib = 2048  # PostgreSQL needs memory for shared buffers
vcpu = 1

[storage]
cluster_mib = 8000  # Database storage
vm_mib = 4000
```

Dockerfile must include:
- PostgreSQL (or your database)
- SSH server
- Startup script that initializes database on boot
- Node.js/Python for test scripts

```dockerfile
FROM ubuntu:22.04

# Install PostgreSQL
RUN apt-get update && apt-get install -y \
    postgresql-15 \
    postgresql-contrib-15 \
    openssh-server \
    iproute2 \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs

# Configure PostgreSQL
USER postgres
RUN /etc/init.d/postgresql start && \
    psql --command "ALTER USER postgres PASSWORD 'postgres';" && \
    psql --command "CREATE DATABASE app;"
USER root

# Configure SSH
RUN mkdir /var/run/sshd
RUN echo 'root:root' | chpasswd

# Startup script
COPY startup.sh /startup.sh
RUN chmod +x /startup.sh

EXPOSE 22 5432
CMD ["/startup.sh"]
```

```bash
#!/bin/bash
# startup.sh
service postgresql start
/usr/sbin/sshd -D
```

## Base Test Class Pattern

```javascript
// db-test.js
const { Pool } = require('pg');

class DatabaseTest {
  constructor() {
    this.pool = new Pool({
      host: 'localhost',
      port: 5432,
      database: 'app',
      user: 'postgres',
      password: 'postgres'
    });
  }

  async getTableCounts() {
    const tables = ['users', 'products', 'orders', 'order_items'];
    const counts = {};

    for (const table of tables) {
      const result = await this.pool.query(
        `SELECT COUNT(*) as count FROM ${table}`
      );
      counts[table] = parseInt(result.rows[0].count);
    }

    return counts;
  }

  async executeInTransaction(fn) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  async verifyIntegrity() {
    // Check foreign key integrity
    const orphanOrders = await this.pool.query(`
      SELECT o.id FROM orders o
      LEFT JOIN users u ON o.user_id = u.id
      WHERE u.id IS NULL
    `);

    if (orphanOrders.rows.length > 0) {
      throw new Error(`Found ${orphanOrders.rows.length} orphan orders`);
    }

    return true;
  }

  async close() {
    await this.pool.end();
  }
}

module.exports = DatabaseTest;
```

## Testing Patterns

### The Feature Branch Pattern

For testing competing feature implementations:

```bash
# Setup: Base e-commerce schema loaded
vers commit --tag "baseline-schema"

# Branch for premium features
vers branch --alias premium-features
vers checkout premium-features
vers connect
> psql <<EOF
CREATE TABLE premium_features (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  feature_name VARCHAR(100) NOT NULL,
  enabled_at TIMESTAMP DEFAULT NOW()
);
ALTER TABLE users ADD COLUMN is_premium BOOLEAN DEFAULT FALSE;
EOF

# Branch for inventory management (from baseline, not premium)
vers checkout baseline-schema
vers branch --alias inventory-management
vers checkout inventory-management
vers connect
> psql <<EOF
CREATE TABLE inventory_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID REFERENCES products(id),
  quantity_change INTEGER NOT NULL,
  reason VARCHAR(50) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE TABLE stock_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID REFERENCES products(id),
  threshold INTEGER NOT NULL,
  triggered_at TIMESTAMP
);
EOF

# Test both in parallel
vers checkout premium-features && vers execute "node test-premium.js" &
vers checkout inventory-management && vers execute "node test-inventory.js" &
wait
```

### The Migration Testing Pattern

For testing schema migrations safely:

```javascript
// test-migration.js
const DatabaseTest = require('./db-test');

async function testMigration() {
  const db = new DatabaseTest();

  console.log('State before migration:');
  console.log(await db.getTableCounts());

  // Apply migration
  await db.pool.query(`
    ALTER TABLE users ADD COLUMN premium_level INTEGER DEFAULT 0;
    UPDATE users SET premium_level = 1 WHERE created_at < '2024-01-01';
  `);

  console.log('State after migration:');
  console.log(await db.getTableCounts());

  // Verify data integrity
  const premiumUsers = await db.pool.query(`
    SELECT COUNT(*) FROM users WHERE premium_level > 0
  `);
  console.log(`Premium users: ${premiumUsers.rows[0].count}`);

  // Verify constraints still work
  try {
    await db.pool.query(`
      INSERT INTO orders (user_id, total) VALUES ('invalid-uuid', 100)
    `);
    throw new Error('Should have failed on FK constraint');
  } catch (e) {
    if (!e.message.includes('foreign key')) {
      throw e;
    }
    console.log('FK constraints working correctly');
  }

  await db.verifyIntegrity();
  console.log('Migration test passed!');

  await db.close();
}

testMigration();
```

```bash
# Test migration approaches
vers commit --tag "pre-migration-v2.0"

# Approach A: Direct ALTER
vers branch --alias migration-approach-a
vers checkout migration-approach-a
vers execute "node migrations/approach-a.js"
vers execute "node test-migration.js"

# Approach B: New table + migrate + swap
vers checkout pre-migration-v2.0
vers branch --alias migration-approach-b
vers checkout migration-approach-b
vers execute "node migrations/approach-b.js"
vers execute "node test-migration.js"

# Compare results
echo "Approach A:"
vers checkout migration-approach-a
vers execute "psql -c 'SELECT COUNT(*) FROM users'"

echo "Approach B:"
vers checkout migration-approach-b
vers execute "psql -c 'SELECT COUNT(*) FROM users'"
```

### The Data Transformation Pattern

For testing ETL or data migration scripts:

```bash
# Load production-like dataset
vers connect -c "pg_restore -d app production-snapshot.dump"
vers commit --tag "production-data-loaded"

# Test transformation script variants
for variant in conservative aggressive incremental; do
  vers branch --alias "transform-$variant"
  vers checkout "transform-$variant"
  vers execute "node transforms/$variant.js"
  vers execute "node validate-transform.js > /tmp/results-$variant.json"
done

# Compare results
for variant in conservative aggressive incremental; do
  vers checkout "transform-$variant"
  echo "=== $variant ==="
  vers execute "cat /tmp/results-$variant.json"
done
```

### The Rollback Testing Pattern

For testing disaster recovery:

```bash
vers commit --tag "healthy-state"

# Simulate corruption
vers branch --alias simulate-corruption
vers checkout simulate-corruption
vers execute "psql -c 'DELETE FROM orders WHERE id > 100;'"
vers execute "psql -c 'UPDATE users SET email = NULL;'"

# Verify corruption
vers execute "psql -c 'SELECT COUNT(*) FROM orders;'"

# Test rollback
vers rollback healthy-state
vers execute "psql -c 'SELECT COUNT(*) FROM orders;'"  # Should be original count
```

## Integration with vers-integration.yaml

```yaml
name: database-testing
version: 1.0.0

vm:
  memory_mib: 2048
  vcpu: 1
  storage_mib: 10000

services:
  postgres:
    template: postgres@15
    config:
      databases: [app, test]
      extensions: [uuid-ossp, pg_trgm]
      settings:
        shared_buffers: 256MB
        work_mem: 16MB

tests:
  schema:
    command: npm run test:schema
    depends_on: [postgres]

  migrations:
    command: npm run test:migrations
    depends_on: [postgres]
    branches:
      - name: migration-up
        env:
          MIGRATION_DIRECTION: up
      - name: migration-down
        env:
          MIGRATION_DIRECTION: down
      - name: migration-idempotent
        env:
          MIGRATION_RUNS: 2

  data-integrity:
    command: npm run test:integrity
    depends_on: [postgres]
    branches:
      - name: with-constraints
        env:
          ENABLE_CONSTRAINTS: true
      - name: without-constraints
        env:
          ENABLE_CONSTRAINTS: false

  performance:
    command: npm run test:perf
    depends_on: [postgres]
    branches:
      - name: indexed
        before: psql -f add-indexes.sql
      - name: unindexed

checkpoints:
  - name: schema-loaded
    after: psql -f schema.sql
  - name: seeded
    after: psql -f seed.sql
  - name: production-like
    after: pg_restore -d app production-anonymized.dump
```

## Performance Testing

```javascript
// test-performance.js
const DatabaseTest = require('./db-test');

async function testQueryPerformance() {
  const db = new DatabaseTest();

  const queries = [
    {
      name: 'Simple select',
      sql: 'SELECT * FROM users WHERE id = $1',
      params: ['user-1']
    },
    {
      name: 'Join query',
      sql: `
        SELECT u.*, COUNT(o.id) as order_count
        FROM users u
        LEFT JOIN orders o ON o.user_id = u.id
        GROUP BY u.id
        LIMIT 100
      `,
      params: []
    },
    {
      name: 'Aggregation',
      sql: `
        SELECT DATE_TRUNC('month', created_at) as month,
               SUM(total) as revenue
        FROM orders
        GROUP BY 1
        ORDER BY 1
      `,
      params: []
    }
  ];

  const results = [];

  for (const query of queries) {
    // Warm up
    await db.pool.query(query.sql, query.params);

    // Measure
    const times = [];
    for (let i = 0; i < 100; i++) {
      const start = process.hrtime.bigint();
      await db.pool.query(query.sql, query.params);
      const end = process.hrtime.bigint();
      times.push(Number(end - start) / 1_000_000); // ms
    }

    times.sort((a, b) => a - b);
    results.push({
      name: query.name,
      p50: times[50],
      p95: times[95],
      p99: times[99]
    });
  }

  console.log('Performance Results:');
  console.table(results);

  await db.close();
}

testQueryPerformance();
```

```bash
# Compare indexed vs unindexed performance
vers checkout seeded

# Test without indexes
vers branch --alias perf-no-index
vers checkout perf-no-index
vers execute "node test-performance.js" > results-no-index.json

# Test with indexes
vers checkout seeded
vers branch --alias perf-with-index
vers checkout perf-with-index
vers execute "psql -f add-indexes.sql"
vers execute "node test-performance.js" > results-with-index.json

# Compare
echo "Without indexes:"
cat results-no-index.json
echo "With indexes:"
cat results-with-index.json
```

## What Gets Preserved

When you commit a Vers checkpoint, you capture:

- **Complete filesystem** - Database files, configs, logs
- **Memory state** - PostgreSQL shared buffers, connection pools
- **Running processes** - Database server, background workers
- **Network configuration** - Ports, connections

Each branch inherits ALL of this instantly via copy-on-write.

## Common Issues

### PostgreSQL won't start after branch
```bash
# Check PostgreSQL status
vers execute "pg_isready"

# If not ready, check logs
vers execute "cat /var/log/postgresql/postgresql-15-main.log | tail -50"

# Manual start if needed
vers execute "pg_ctl start -D /var/lib/postgresql/15/main"
```

### Connection refused errors
```bash
# Verify PostgreSQL is listening
vers execute "ss -tlnp | grep 5432"

# Check pg_hba.conf
vers execute "cat /etc/postgresql/15/main/pg_hba.conf"

# Allow local connections
vers execute "echo 'local all all trust' >> /etc/postgresql/15/main/pg_hba.conf"
vers execute "pg_ctl reload -D /var/lib/postgresql/15/main"
```

### Permission denied on tables
```bash
vers execute "psql -c 'GRANT ALL ON ALL TABLES IN SCHEMA public TO postgres;'"
vers execute "psql -c 'GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO postgres;'"
```

### Out of disk space
```bash
# Check disk usage
vers execute "df -h"

# Clean up old WAL files
vers execute "psql -c 'SELECT pg_switch_wal();'"

# Vacuum to reclaim space
vers execute "psql -c 'VACUUM FULL;'"
```

## Best Practices

1. **Create checkpoints after expensive operations** - Schema loads, bulk inserts
2. **Use transactions in tests** - Rollback on failure without affecting other tests
3. **Name branches descriptively** - `migration-v2-approach-a` not `test-1`
4. **Clean up test branches** - `vers branch delete test-*` after testing
5. **Include validation in checkpoints** - Verify data integrity before committing
