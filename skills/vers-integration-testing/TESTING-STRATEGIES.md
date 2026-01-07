# Integration Testing Strategies

Comprehensive testing approaches using Vers VM branching.

## Strategy 1: The Branch-Per-Scenario Pattern

Test multiple scenarios from a single setup point.

### When to Use
- Testing different user paths through the same flow
- Testing error handling and edge cases
- A/B testing different implementations

### Implementation

```yaml
tests:
  checkout:
    command: npm run test:checkout
    branches:
      - name: guest-checkout
        env:
          USER_TYPE: guest

      - name: registered-user
        env:
          USER_TYPE: registered

      - name: premium-user
        env:
          USER_TYPE: premium
          DISCOUNT_PERCENT: 10

      - name: cart-abandonment
        env:
          SCENARIO: abandon_at_payment

      - name: payment-failure
        env:
          STRIPE_CARD: "4000000000000002"
          SCENARIO: payment_declined
```

### Execution Pattern

```bash
# Single command runs all branches in parallel
vers integration test --suite checkout --parallel

# Each branch:
# 1. Forks from checkpoint "ready-for-checkout"
# 2. Sets environment variables
# 3. Runs test command
# 4. Reports results
# 5. Optionally preserves branch for debugging
```

---

## Strategy 2: The Matrix Test

Test all combinations of service versions.

### When to Use
- Verifying compatibility across versions
- Finding version-specific bugs
- Preparing for upgrades

### Implementation

```yaml
matrix:
  postgres: [14, 15, 16]
  redis: [6, 7]
  node: [18, 20, 22]

# Generates 3 × 2 × 3 = 18 combinations
```

### Execution Pattern

```bash
# Test all combinations
vers integration matrix --parallel

# Test subset
vers integration matrix --filter "postgres=15,node=20"

# Continue on failure (test all even if some fail)
vers integration matrix --continue-on-failure
```

### Results Format

```
Matrix Test Results
==================

| postgres | redis | node | status  | duration |
|----------|-------|------|---------|----------|
| 14       | 6     | 18   | passed  | 45s      |
| 14       | 6     | 20   | passed  | 42s      |
| 14       | 7     | 18   | passed  | 44s      |
| 15       | 6     | 18   | passed  | 43s      |
| 15       | 7     | 20   | FAILED  | 38s      | ← Found issue!
| 16       | 7     | 22   | passed  | 41s      |
...

Summary: 17/18 passed, 1 failed
Failed: postgres=15, redis=7, node=20
  Error: Redis 7.x incompatible with current session store
```

---

## Strategy 3: The Chaos Test

Inject failures to test resilience.

### When to Use
- Testing failure handling
- Validating circuit breakers
- Testing recovery procedures

### Available Chaos Actions

| Action | Description | Example |
|--------|-------------|---------|
| `kill` | Stop service immediately | Database crash |
| `pause` | Freeze service | Network partition |
| `network-isolate` | Block all network | Complete isolation |
| `network-delay` | Add latency | Slow network |
| `network-loss` | Drop packets | Unreliable network |
| `cpu-stress` | High CPU load | Resource contention |
| `memory-stress` | High memory usage | Memory pressure |
| `disk-fill` | Fill disk | Storage exhaustion |

### Implementation

```yaml
tests:
  chaos:
    scenarios:
      - name: database-crash
        inject:
          service: postgres
          action: kill
          after: 30s              # Kill after 30s of test running
        expect:
          - app.returns_503       # App should return 503
          - app.reconnects        # App should reconnect when DB returns
          - no_data_loss          # No data should be lost

      - name: redis-unavailable
        inject:
          service: redis
          action: pause
          duration: 60s
        expect:
          - app.degrades_gracefully
          - cache_miss_increases
          - app.recovers_when_redis_returns

      - name: network-partition
        inject:
          service: app
          action: network-isolate
          from: [postgres, redis]
          duration: 30s
        expect:
          - app.queues_writes
          - app.serves_cached_reads
          - app.replays_queue_on_recovery

      - name: slow-database
        inject:
          service: postgres
          action: network-delay
          latency: 500ms
        expect:
          - app.response_time_increases
          - app.no_timeouts          # Should handle gracefully
          - circuit_breaker.not_tripped

      - name: disk-pressure
        inject:
          service: postgres
          action: disk-fill
          percentage: 95
        expect:
          - app.writes_fail
          - app.reads_succeed
          - alerts.triggered
```

### Execution Pattern

```bash
# Run single chaos scenario
vers integration test --suite chaos --scenario database-crash

# Workflow:
# 1. Checkpoint current state as "pre-chaos"
# 2. Start test
# 3. Inject chaos at specified time
# 4. Monitor expectations
# 5. Report results
# 6. Auto-rollback to "pre-chaos" if needed
```

### Custom Chaos Script

```bash
#!/bin/bash
# scripts/chaos/database-failover.sh

# Checkpoint before chaos
vers commit --tag "pre-failover-test"

# Start monitoring
vers execute "npm run monitor:start" &
MONITOR_PID=$!

# Wait for stable state
sleep 10

# Kill primary database
vers chaos inject --service postgres-primary --action kill

# Wait for failover
sleep 5

# Verify replica promoted
RESULT=$(vers execute "psql -h postgres-replica -c 'SELECT pg_is_in_recovery();'")
if [[ $RESULT == *"f"* ]]; then
  echo "Failover successful: replica is now primary"
else
  echo "Failover FAILED: replica still in recovery mode"
  vers rollback pre-failover-test
  exit 1
fi

# Verify application recovered
HTTP_STATUS=$(vers execute "curl -s -o /dev/null -w '%{http_code}' http://app:3000/health")
if [[ $HTTP_STATUS == "200" ]]; then
  echo "Application recovered successfully"
else
  echo "Application NOT healthy after failover"
  exit 1
fi

# Stop monitoring and collect results
kill $MONITOR_PID
vers execute "npm run monitor:report"
```

---

## Strategy 4: The Contract Test

Verify API contracts between services.

### When to Use
- Microservices integration
- API versioning
- Consumer-driven contracts

### Implementation with Pact

```yaml
tests:
  contracts:
    provider: order-service
    consumers:
      - name: frontend
        pact: ./pacts/frontend-order-service.json
      - name: analytics-service
        pact: ./pacts/analytics-order-service.json
      - name: mobile-app
        pact: ./pacts/mobile-order-service.json

    branches:
      - name: current-contract
        description: "Verify current contracts are satisfied"

      - name: v2-proposal
        description: "Test proposed v2 API changes"
        env:
          API_VERSION: v2
          ENABLE_NEW_FIELDS: true
        expect:
          - frontend.contract.satisfied       # Must not break
          - analytics.contract.satisfied      # Must not break
          - mobile.contract.check_only        # Informational
```

### Execution

```bash
# Verify all consumer contracts
vers integration test --suite contracts

# Test breaking change impact
vers integration test --suite contracts --scenario v2-proposal
```

---

## Strategy 5: The Performance Test

Baseline and regression testing.

### When to Use
- Establishing performance baselines
- Detecting performance regressions
- Comparing optimizations

### Implementation

```yaml
tests:
  performance:
    tool: k6
    script: ./load-tests/api.js

    baseline:
      branch: main
      metrics:
        - p99_latency < 100ms
        - throughput > 1000rps
        - error_rate < 0.1%

    scenarios:
      - name: ramp-up
        config:
          stages:
            - duration: 1m
              target: 10
            - duration: 3m
              target: 100
            - duration: 1m
              target: 0

      - name: sustained-load
        config:
          vus: 100
          duration: 10m

      - name: spike
        config:
          stages:
            - duration: 1m
              target: 50
            - duration: 10s
              target: 500      # Spike!
            - duration: 1m
              target: 50

      - name: stress
        config:
          stages:
            - duration: 2m
              target: 100
            - duration: 2m
              target: 200
            - duration: 2m
              target: 300
            - duration: 2m
              target: 400      # Find breaking point

    branches:
      - name: baseline
        description: "Establish baseline metrics"
        tag: performance-baseline

      - name: with-caching
        env:
          ENABLE_CACHE: true
        compare: baseline

      - name: with-connection-pool
        env:
          DB_POOL_SIZE: 50
        compare: baseline

      - name: with-all-optimizations
        env:
          ENABLE_CACHE: true
          DB_POOL_SIZE: 50
          ENABLE_COMPRESSION: true
        compare: baseline
```

### Execution

```bash
# Establish baseline
vers integration test --suite performance --scenario baseline

# Compare optimization
vers integration test --suite performance --scenario with-caching --compare baseline
```

### Results Format

```
Performance Comparison: with-caching vs baseline
================================================

Metric          | baseline | with-caching | Change
----------------|----------|--------------|--------
p50 latency     | 45ms     | 12ms         | -73% ✓
p95 latency     | 89ms     | 34ms         | -62% ✓
p99 latency     | 156ms    | 67ms         | -57% ✓
throughput      | 1,234rps | 3,456rps     | +180% ✓
error rate      | 0.02%    | 0.01%        | -50% ✓
CPU usage       | 78%      | 45%          | -42% ✓
Memory usage    | 1.2GB    | 1.4GB        | +17%

Recommendation: APPROVE - significant improvement with minimal memory overhead
```

---

## Strategy 6: The Migration Test

Test database migrations safely.

### When to Use
- Schema changes
- Data migrations
- Version upgrades

### Implementation

```yaml
tests:
  migration:
    checkpoints:
      - name: pre-migration
        tag: "schema-v1"
      - name: post-migration
        after: npm run migrate
        tag: "schema-v2"

    branches:
      - name: migration-up
        from: pre-migration
        command: npm run migrate:up
        verify:
          - schema_matches: ./expected/v2-schema.sql
          - data_integrity_check: passes
          - row_counts: preserved

      - name: migration-down
        from: post-migration
        command: npm run migrate:down
        verify:
          - schema_matches: ./expected/v1-schema.sql
          - no_data_loss: true

      - name: migration-idempotent
        from: pre-migration
        command: |
          npm run migrate:up
          npm run migrate:up   # Should be no-op
        verify:
          - no_errors: true
          - schema_unchanged_after_second_run: true

      - name: rollback-safety
        from: post-migration
        command: |
          # Simulate some data written after migration
          npm run seed:post-migration-data
          # Now rollback
          npm run migrate:down
        verify:
          - new_data_preserved_or_migrated: true

    production_simulation:
      - name: with-production-data
        before:
          - pg_restore -d app production-anonymized.dump
        command: npm run migrate:up
        verify:
          - completes_within: 5m
          - no_locking_issues: true
```

### Execution

```bash
# Test migration up and down
vers integration test --suite migration

# Test with production-like data
vers integration test --suite migration --scenario with-production-data

# Safe rollback workflow
vers commit --tag "before-production-migration"
vers integration test --suite migration --scenario migration-up
# If successful, apply to production
# If failed, investigate in isolated branch
```

---

## Strategy 7: The Snapshot Test

Compare system state before/after operations.

### When to Use
- Verifying side effects
- Regression testing
- Audit trails

### Implementation

```yaml
tests:
  snapshots:
    capture:
      database:
        - query: SELECT * FROM users ORDER BY id
          name: users
        - query: SELECT * FROM orders ORDER BY id
          name: orders
        - query: SELECT COUNT(*), status FROM orders GROUP BY status
          name: order_stats

      redis:
        - pattern: "session:*"
          name: sessions
        - pattern: "cache:*"
          name: cache

      elasticsearch:
        - index: products
          query: { "query": { "match_all": {} } }
          name: products

      files:
        - path: /var/log/app/audit.log
          name: audit_log
        - path: /var/data/uploads/
          name: uploads

    scenarios:
      - name: user-signup
        before: checkpoints.clean-state
        actions:
          - POST /api/auth/signup
            body: { email: "new@test.com", password: "test123" }
          - POST /api/auth/verify
            body: { token: "${verification_token}" }
        verify:
          - database.users.count: +1
          - database.users.contains:
              email: "new@test.com"
              verified: true
          - redis.sessions.count: +1
          - files.audit_log.contains: "USER_CREATED"

      - name: order-placed
        before: checkpoints.user-logged-in
        actions:
          - POST /api/cart/add
            body: { product_id: "prod_1", quantity: 2 }
          - POST /api/orders/create
          - POST /api/orders/${order_id}/pay
            body: { payment_method: "pm_card_visa" }
        verify:
          - database.orders.count: +1
          - database.order_stats.processing: +1
          - elasticsearch.products.inventory_changed: true
          - files.audit_log.contains: "ORDER_CREATED"
```

---

## Test Organization Best Practices

### 1. Layered Testing

```yaml
tests:
  # Layer 1: Unit tests (no services needed)
  unit:
    command: npm run test:unit
    parallel: true

  # Layer 2: Component tests (single service)
  component:
    command: npm run test:component
    depends_on: [postgres]

  # Layer 3: Integration tests (multiple services)
  integration:
    command: npm run test:integration
    depends_on: [postgres, redis, stripe]

  # Layer 4: E2E tests (full stack)
  e2e:
    command: npm run test:e2e
    depends_on: [all]
```

### 2. Test Isolation

```yaml
# Each test branch should be independent
tests:
  user-flows:
    branches:
      - name: signup
        env:
          TEST_EMAIL: signup-test-${BRANCH_ID}@test.com
      - name: login
        env:
          TEST_EMAIL: login-test-${BRANCH_ID}@test.com
```

### 3. Deterministic Data

```yaml
checkpoints:
  - name: seeded
    after: scripts/seed.sh
    description: "Known test data state"

# seed.sh should be idempotent and create known data
# Use fixed IDs, timestamps, etc. for reproducibility
```

### 4. Fast Feedback

```yaml
# Run fast tests first
tests:
  smoke:
    command: npm run test:smoke
    timeout: 30s
    run_first: true

  full:
    command: npm run test:full
    depends_on: [smoke]  # Only run if smoke passes
```
