# Integration Composition Patterns

Recommended service combinations and architectural patterns for common use cases.

## Pattern 1: The SaaS Starter Stack

For typical B2B SaaS applications with authentication, payments, and email.

```yaml
name: saas-starter
version: 1.0.0

vm:
  memory_mib: 4096
  vcpu: 2
  storage_mib: 10000

services:
  postgres:
    template: postgres@15
    config:
      databases: [app, analytics]
      extensions: [uuid-ossp, pg_trgm]

  redis:
    template: redis@7
    config:
      maxmemory: 256mb
      maxmemory_policy: allkeys-lru

  stripe:
    template: stripe-mock
    config:
      webhook_endpoint: http://app:3000/webhooks/stripe
      fixtures:
        products:
          - id: prod_starter
            name: Starter Plan
            prices:
              - id: price_starter_monthly
                unit_amount: 999
                recurring: { interval: month }
          - id: prod_pro
            name: Pro Plan
            prices:
              - id: price_pro_monthly
                unit_amount: 2999
                recurring: { interval: month }

  oauth:
    template: oauth-mock
    config:
      providers: [google, github]
      callback_urls:
        - http://localhost:3000/auth/callback

  smtp:
    template: mailhog

  app:
    build: .
    depends_on: [postgres, redis, stripe, oauth, smtp]
    env:
      DATABASE_URL: postgres://postgres@postgres/app
      REDIS_URL: redis://redis:6379
      STRIPE_SECRET_KEY: sk_test_mock
      STRIPE_WEBHOOK_SECRET: whsec_test
      SMTP_HOST: smtp
      SMTP_PORT: 1025

tests:
  unit:
    command: npm run test:unit
    parallel: true

  auth:
    command: npm run test:auth
    depends_on: [postgres, redis, oauth]
    branches:
      - name: google-oauth
        env: { OAUTH_PROVIDER: google }
      - name: github-oauth
        env: { OAUTH_PROVIDER: github }
      - name: email-password
        env: { AUTH_METHOD: email }

  billing:
    command: npm run test:billing
    depends_on: [postgres, stripe]
    branches:
      - name: subscription-create
        env: { BILLING_SCENARIO: create }
      - name: subscription-upgrade
        env: { BILLING_SCENARIO: upgrade }
      - name: subscription-cancel
        env: { BILLING_SCENARIO: cancel }
      - name: payment-failure
        env: { BILLING_SCENARIO: card_declined }

  email:
    command: npm run test:email
    depends_on: [smtp]
    branches:
      - name: welcome-email
      - name: password-reset
      - name: invoice-email

checkpoints:
  - name: services-ready
    after: services.*.healthcheck
  - name: db-seeded
    after: scripts/seed.sh
  - name: users-created
    after: scripts/create-test-users.sh

deploy:
  staging:
    target: vers.sh/hosted
    domain: staging.myapp.vers.sh
  production:
    target: vers.sh/hosted
    domain: myapp.vers.sh
    scaling:
      min: 2
      max: 10
```

**Testing workflow:**
```bash
# Start services and seed
vers integration up --checkpoint db-seeded

# Run all test suites in parallel
vers integration test --parallel

# Results show:
# - auth: 3/3 branches passed
# - billing: 4/4 branches passed
# - email: 3/3 branches passed
```

---

## Pattern 2: The Event-Driven Microservices Architecture

For microservices communicating via events.

```yaml
name: event-driven-microservices
version: 1.0.0

vm:
  memory_mib: 6144
  vcpu: 4
  storage_mib: 15000

services:
  # Message broker
  kafka:
    template: kafka@3
    config:
      topics:
        - name: user-events
          partitions: 6
          config:
            retention.ms: 86400000
        - name: order-events
          partitions: 6
        - name: inventory-events
          partitions: 3
        - name: notification-events
          partitions: 1
        - name: dead-letter
          partitions: 1
      schema_registry: true

  # Service databases (each service owns its data)
  postgres-users:
    template: postgres@15
    config:
      databases: [users]

  postgres-orders:
    template: postgres@15
    config:
      databases: [orders]

  mongodb-inventory:
    template: mongodb@7
    config:
      databases: [inventory]

  redis:
    template: redis@7
    config:
      maxmemory: 512mb

  # Microservices
  user-service:
    build: ./services/user
    depends_on: [postgres-users, kafka, redis]
    env:
      DATABASE_URL: postgres://postgres@postgres-users/users
      KAFKA_BROKERS: kafka:9092
      REDIS_URL: redis://redis:6379
    replicas: 2

  order-service:
    build: ./services/order
    depends_on: [postgres-orders, kafka, redis]
    env:
      DATABASE_URL: postgres://postgres@postgres-orders/orders
      KAFKA_BROKERS: kafka:9092
    replicas: 2

  inventory-service:
    build: ./services/inventory
    depends_on: [mongodb-inventory, kafka]
    env:
      MONGODB_URL: mongodb://mongodb-inventory/inventory
      KAFKA_BROKERS: kafka:9092
    replicas: 2

  notification-service:
    build: ./services/notification
    depends_on: [kafka, smtp]
    env:
      KAFKA_BROKERS: kafka:9092
      SMTP_HOST: smtp

  smtp:
    template: mailhog

  # API Gateway
  gateway:
    template: kong@3
    config:
      routes:
        - paths: [/api/users]
          service: user-service
        - paths: [/api/orders]
          service: order-service
        - paths: [/api/inventory]
          service: inventory-service

tests:
  unit:
    command: npm run test:unit --workspaces

  service-integration:
    command: npm run test:integration
    branches:
      - name: user-service
        env: { TEST_SERVICE: user }
      - name: order-service
        env: { TEST_SERVICE: order }
      - name: inventory-service
        env: { TEST_SERVICE: inventory }

  event-flow:
    command: npm run test:events
    depends_on: [kafka, user-service, order-service, inventory-service]
    branches:
      - name: order-created-flow
        description: "Order created → Inventory reserved → Notification sent"
      - name: order-cancelled-flow
        description: "Order cancelled → Inventory released → Notification sent"
      - name: inventory-low-flow
        description: "Inventory low → Alert triggered → Reorder notification"

  resilience:
    command: npm run test:resilience
    branches:
      - name: kafka-down
        before: vers chaos inject --service kafka --action pause --duration 30s
      - name: database-slow
        before: vers chaos inject --service postgres-orders --action network-delay --latency 500ms
      - name: service-crash
        before: vers chaos inject --service order-service --action kill

checkpoints:
  - name: infrastructure-ready
    after: services.[kafka,postgres-*,mongodb-*,redis].healthcheck
  - name: services-ready
    after: services.[user-service,order-service,inventory-service].healthcheck
  - name: seeded
    after: scripts/seed-all-services.sh
```

**Testing event flows:**
```bash
# Test that order creation triggers correct event cascade
vers integration test --suite event-flow --scenario order-created-flow

# Test resilience when Kafka is temporarily unavailable
vers integration test --suite resilience --scenario kafka-down
```

---

## Pattern 3: The Data Pipeline Architecture

For ETL, data processing, and analytics.

```yaml
name: data-pipeline
version: 1.0.0

vm:
  memory_mib: 8192
  vcpu: 4
  storage_mib: 20000

services:
  # Source database (simulates production)
  postgres-source:
    template: postgres@15
    config:
      databases: [production_mirror]
      settings:
        wal_level: logical          # Enable logical replication
        max_replication_slots: 4

  # Data warehouse
  postgres-warehouse:
    template: postgres@15
    config:
      databases: [warehouse]
      extensions: [pg_trgm, btree_gin, tablefunc]
      settings:
        shared_buffers: 1GB
        work_mem: 256MB
        maintenance_work_mem: 512MB

  # Redis for job queues and caching
  redis:
    template: redis@7
    config:
      maxmemory: 1gb
      persistence: true

  # Elasticsearch for search and analytics
  elasticsearch:
    template: elasticsearch@8
    config:
      indices:
        - name: products
          mappings: ./mappings/products.json
        - name: orders
          mappings: ./mappings/orders.json
        - name: analytics
          mappings: ./mappings/analytics.json

  # ETL Workers
  etl-extract:
    build: ./etl/extract
    depends_on: [postgres-source, redis]
    env:
      SOURCE_DATABASE_URL: postgres://postgres@postgres-source/production_mirror
      REDIS_URL: redis://redis:6379

  etl-transform:
    build: ./etl/transform
    depends_on: [redis]
    replicas: 3
    env:
      REDIS_URL: redis://redis:6379

  etl-load:
    build: ./etl/load
    depends_on: [postgres-warehouse, elasticsearch, redis]
    env:
      WAREHOUSE_DATABASE_URL: postgres://postgres@postgres-warehouse/warehouse
      ELASTICSEARCH_URL: http://elasticsearch:9200
      REDIS_URL: redis://redis:6379

tests:
  extraction:
    command: npm run test:extraction
    depends_on: [postgres-source, etl-extract]
    branches:
      - name: full-extraction
        env: { EXTRACTION_MODE: full }
      - name: incremental-extraction
        env: { EXTRACTION_MODE: incremental }
      - name: cdc-extraction
        env: { EXTRACTION_MODE: cdc }

  transformation:
    command: npm run test:transformation
    depends_on: [etl-transform]
    branches:
      - name: customer-aggregation
      - name: order-metrics
      - name: product-analytics

  loading:
    command: npm run test:loading
    depends_on: [postgres-warehouse, elasticsearch, etl-load]
    branches:
      - name: warehouse-load
      - name: elasticsearch-sync
      - name: full-pipeline

  data-quality:
    command: npm run test:data-quality
    branches:
      - name: row-counts-match
      - name: aggregations-correct
      - name: no-duplicates
      - name: referential-integrity

checkpoints:
  - name: sources-loaded
    after: scripts/load-source-data.sh
    description: "Production-like data loaded into source database"
  - name: etl-complete
    after: scripts/run-full-etl.sh
    description: "Full ETL pipeline completed"
  - name: validated
    after: scripts/validate-data.sh
    description: "Data quality checks passed"

matrix:
  postgres: [14, 15, 16]
  elasticsearch: [7, 8]
```

**Testing data pipelines:**
```bash
# Load production-like data and checkpoint
vers integration up
vers execute "scripts/load-production-snapshot.sh"
vers commit --tag "production-data-loaded"

# Test different extraction strategies
vers integration test --suite extraction --parallel

# Test full pipeline with data quality validation
vers integration test --suite data-quality

# Test across database version combinations
vers integration matrix --filter "elasticsearch=8"
```

---

## Pattern 4: The E-Commerce Platform

Full e-commerce with inventory, payments, search, and storage.

```yaml
name: ecommerce-platform
version: 1.0.0

vm:
  memory_mib: 6144
  vcpu: 4
  storage_mib: 15000

services:
  postgres:
    template: postgres@15
    config:
      databases: [ecommerce, inventory, analytics]
      extensions: [uuid-ossp, pg_trgm]

  redis:
    template: redis@7
    config:
      maxmemory: 512mb

  elasticsearch:
    template: elasticsearch@8
    config:
      indices:
        - name: products
          settings:
            analysis:
              analyzer:
                product_analyzer:
                  type: custom
                  tokenizer: standard
                  filter: [lowercase, snowball]

  stripe:
    template: stripe-mock
    config:
      fixtures:
        products:
          - id: prod_physical
            name: Physical Product
          - id: prod_digital
            name: Digital Product
        shipping_rates:
          - id: shr_standard
            display_name: Standard Shipping
            amount: 500
          - id: shr_express
            display_name: Express Shipping
            amount: 1500

  s3:
    template: localstack
    config:
      services: [s3]
      s3_buckets:
        - name: product-images
          cors:
            - AllowedOrigins: ["*"]
              AllowedMethods: [GET, PUT]
        - name: order-invoices
          acl: private

  smtp:
    template: mailhog

  app:
    build: .
    depends_on: [postgres, redis, elasticsearch, stripe, s3, smtp]

tests:
  catalog:
    command: npm run test:catalog
    branches:
      - name: product-crud
      - name: category-management
      - name: search-indexing
      - name: inventory-tracking

  checkout:
    command: npm run test:checkout
    branches:
      - name: cart-operations
      - name: shipping-calculation
      - name: tax-calculation
      - name: promo-codes

  payment:
    command: npm run test:payment
    branches:
      - name: card-success
        env: { CARD: "4242424242424242" }
      - name: card-declined
        env: { CARD: "4000000000000002" }
      - name: 3ds-required
        env: { CARD: "4000002760003184" }
      - name: insufficient-funds
        env: { CARD: "4000000000009995" }

  fulfillment:
    command: npm run test:fulfillment
    branches:
      - name: physical-product
      - name: digital-product
      - name: mixed-order
      - name: partial-shipment

  search:
    command: npm run test:search
    depends_on: [elasticsearch]
    branches:
      - name: basic-search
      - name: faceted-search
      - name: autocomplete
      - name: typo-tolerance

checkpoints:
  - name: catalog-seeded
    after: scripts/seed-catalog.sh
  - name: users-created
    after: scripts/create-test-users.sh
  - name: orders-placed
    after: scripts/place-test-orders.sh
```

---

## Pattern 5: The Multi-Tenant SaaS

Architecture for multi-tenant applications.

```yaml
name: multi-tenant-saas
version: 1.0.0

vm:
  memory_mib: 4096
  vcpu: 2

services:
  # Shared database with schema-per-tenant
  postgres:
    template: postgres@15
    config:
      databases: [saas]
      extensions: [uuid-ossp]
      init_scripts:
        - ./sql/create-tenant-schemas.sql

  redis:
    template: redis@7

  app:
    build: .
    depends_on: [postgres, redis]
    env:
      TENANT_ISOLATION: schema  # Options: schema, database, row

tests:
  tenant-isolation:
    command: npm run test:isolation
    branches:
      - name: data-isolation
        description: "Verify tenant A cannot see tenant B data"
      - name: schema-isolation
        description: "Verify schema boundaries"
      - name: connection-pooling
        description: "Verify connections route to correct tenant"

  tenant-lifecycle:
    command: npm run test:tenant-lifecycle
    branches:
      - name: tenant-provisioning
      - name: tenant-migration
      - name: tenant-deletion
      - name: tenant-export

  cross-tenant:
    command: npm run test:cross-tenant
    branches:
      - name: shared-resources
      - name: admin-access
      - name: usage-metering

checkpoints:
  - name: tenants-created
    after: scripts/create-test-tenants.sh
    description: "Test tenants: acme-corp, globex-inc, initech"
```

---

## Composition Best Practices

### 1. Service Dependencies

Always declare explicit dependencies:

```yaml
services:
  app:
    depends_on:
      - postgres    # Hard dependency - won't start without
      - redis       # Hard dependency
    soft_depends_on:
      - elasticsearch  # Soft dependency - can start without
```

### 2. Health Check Ordering

Services start in dependency order, each waiting for health check:

```yaml
services:
  postgres:
    healthcheck:
      command: pg_isready
      interval: 2s
      retries: 30      # Wait up to 60s for postgres

  app:
    depends_on: [postgres]
    healthcheck:
      command: curl -f localhost:3000/health
      start_period: 30s  # Grace period before checking
```

### 3. Resource Allocation

Size services appropriately:

```yaml
# Development/testing defaults
services:
  postgres:
    resources:
      memory: 512mb

  elasticsearch:
    resources:
      memory: 1gb     # ES needs more memory

  app:
    resources:
      memory: 256mb
```

### 4. Environment Separation

Use checkpoints to separate concerns:

```yaml
checkpoints:
  - name: infrastructure
    after: services.[postgres,redis,kafka].healthcheck

  - name: services
    after: services.[app,worker].healthcheck

  - name: seeded
    after: scripts/seed.sh

  - name: ready-for-testing
    after: scripts/final-setup.sh
```

### 5. Parallel Test Design

Design tests to run in isolation:

```yaml
tests:
  # Good: Each branch is independent
  user-flows:
    branches:
      - name: signup
        env: { TEST_USER: new_user_1 }
      - name: login
        env: { TEST_USER: existing_user_1 }
      - name: password-reset
        env: { TEST_USER: reset_user_1 }

  # Bad: Branches depend on shared state
  # (This would cause race conditions in parallel)
```
