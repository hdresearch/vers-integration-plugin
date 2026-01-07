# Vers Integration Service Catalog

Complete reference for all available service templates in the Vers integration testing platform.

## Database Services

### PostgreSQL

The most popular relational database for application development.

```yaml
postgres:
  template: postgres@15  # Versions: 13, 14, 15, 16
  config:
    databases: [app, analytics]          # Databases to create
    extensions:                          # Extensions to enable
      - uuid-ossp
      - pg_trgm
      - pgvector
      - postgis
    users:                               # Additional users
      - name: readonly
        password: ${READONLY_PASSWORD}
        grants: [SELECT]
      - name: app
        password: ${APP_PASSWORD}
        grants: [ALL]
    init_scripts:                        # Scripts to run on init
      - ./sql/schema.sql
      - ./sql/seed.sql
    settings:                            # PostgreSQL settings
      shared_buffers: 256MB
      work_mem: 16MB
      max_connections: 100
  resources:
    memory: 512mb
    storage: 2gb
  healthcheck:
    command: pg_isready -U postgres
    interval: 5s
    timeout: 5s
    retries: 5
```

**Common configurations:**
```yaml
# Production-like settings
postgres:
  template: postgres@15
  config:
    settings:
      shared_buffers: 1GB
      effective_cache_size: 3GB
      maintenance_work_mem: 256MB
      checkpoint_completion_target: 0.9
      wal_buffers: 16MB
      default_statistics_target: 100
      random_page_cost: 1.1
      effective_io_concurrency: 200
```

### MySQL

Popular relational database with InnoDB storage engine.

```yaml
mysql:
  template: mysql@8.0  # Versions: 5.7, 8.0
  config:
    databases: [app]
    users:
      - name: app
        password: ${MYSQL_PASSWORD}
        grants: [ALL PRIVILEGES]
    init_scripts:
      - ./sql/schema.sql
    settings:
      innodb_buffer_pool_size: 256M
      max_connections: 100
  resources:
    memory: 512mb
    storage: 2gb
```

### MongoDB

Document database for flexible schema applications.

```yaml
mongodb:
  template: mongodb@7  # Versions: 5, 6, 7
  config:
    databases: [app]
    replica_set: false           # Enable for transaction support
    auth:
      enabled: true
      root_password: ${MONGO_ROOT_PASSWORD}
    indexes:                     # Pre-create indexes
      app.users:
        - keys: { email: 1 }
          options: { unique: true }
      app.orders:
        - keys: { created_at: -1 }
  resources:
    memory: 512mb
    storage: 2gb
```

## Cache Services

### Redis

In-memory data store for caching, sessions, and queues.

```yaml
redis:
  template: redis@7  # Versions: 6, 7
  config:
    maxmemory: 256mb
    maxmemory_policy: allkeys-lru  # Options: volatile-lru, allkeys-random, etc.
    persistence: false             # AOF/RDB persistence
    cluster: false                 # Redis cluster mode
    databases: 16                  # Number of databases
    requirepass: ${REDIS_PASSWORD} # Optional password
  resources:
    memory: 256mb
```

**Use cases:**
- `maxmemory_policy: allkeys-lru` - Cache with automatic eviction
- `maxmemory_policy: noeviction` - Persistent storage with error on full
- `persistence: true` - Data durability across restarts

### Memcached

Simple, high-performance distributed memory cache.

```yaml
memcached:
  template: memcached@1.6
  config:
    memory: 128          # MB
    max_connections: 1024
    threads: 4
  resources:
    memory: 128mb
```

## Message Queue Services

### Kafka

Distributed event streaming platform.

```yaml
kafka:
  template: kafka@3  # Versions: 3.x
  config:
    topics:
      - name: events
        partitions: 3
        replication: 1
        config:
          retention.ms: 604800000  # 7 days
      - name: notifications
        partitions: 1
    schema_registry: true          # Enable Confluent Schema Registry
    connect: false                 # Enable Kafka Connect
    broker_settings:
      num.partitions: 3
      default.replication.factor: 1
      log.retention.hours: 168
  depends_on:
    - zookeeper                    # Auto-included
  resources:
    memory: 1gb
```

**Testing patterns:**
```yaml
# Consumer group testing
kafka:
  config:
    topics:
      - name: test-events
        partitions: 6              # More partitions = more parallel consumers
    consumer_groups:
      - name: test-group
        topics: [test-events]
```

### RabbitMQ

Message broker with flexible routing.

```yaml
rabbitmq:
  template: rabbitmq@3
  config:
    vhosts: [app, celery]
    users:
      - name: app
        password: ${RABBITMQ_PASSWORD}
        vhost: app
        tags: [management]
    exchanges:
      - name: events
        type: topic
        vhost: app
    queues:
      - name: tasks
        durable: true
        vhost: app
      - name: notifications
        durable: false
        vhost: app
    bindings:
      - exchange: events
        queue: tasks
        routing_key: "task.*"
    management: true               # Enable management UI on :15672
    plugins:
      - rabbitmq_delayed_message_exchange
  resources:
    memory: 512mb
```

### Amazon SQS (via LocalStack)

AWS SQS for queue testing.

```yaml
localstack:
  template: localstack
  config:
    services: [sqs]
    sqs_queues:
      - name: processing-queue
        attributes:
          VisibilityTimeout: 30
          MessageRetentionPeriod: 86400
      - name: dead-letter-queue
        is_dlq: true
```

## Search Services

### Elasticsearch

Distributed search and analytics engine.

```yaml
elasticsearch:
  template: elasticsearch@8  # Versions: 7, 8
  config:
    indices:
      - name: products
        mappings: ./mappings/products.json
        settings:
          number_of_shards: 1
          number_of_replicas: 0
      - name: logs
        mappings: ./mappings/logs.json
    security: false                # Disable security for testing
    plugins:
      - analysis-icu
  resources:
    memory: 1gb
    storage: 5gb
  env:
    discovery.type: single-node
    ES_JAVA_OPTS: -Xms512m -Xmx512m
```

### OpenSearch

AWS-compatible search engine (Elasticsearch fork).

```yaml
opensearch:
  template: opensearch@2
  config:
    indices:
      - name: products
        mappings: ./mappings/products.json
    security: false
  resources:
    memory: 1gb
```

### Meilisearch

Fast, typo-tolerant search engine.

```yaml
meilisearch:
  template: meilisearch@1
  config:
    master_key: ${MEILI_MASTER_KEY}
    indexes:
      - name: products
        primary_key: id
        settings:
          searchableAttributes: [name, description]
          filterableAttributes: [category, price]
  resources:
    memory: 256mb
```

## Mock Services

### Stripe Mock

Official Stripe API mock server.

```yaml
stripe:
  template: stripe-mock
  config:
    port: 12111
    webhook_endpoint: http://app:3000/webhooks/stripe
    webhook_secret: whsec_test_secret
    fixtures:                      # Pre-create test data
      customers:
        - id: cus_test_premium
          email: premium@test.com
          metadata:
            tier: premium
        - id: cus_test_free
          email: free@test.com
      products:
        - id: prod_monthly
          name: Monthly Plan
          prices:
            - id: price_monthly_1999
              unit_amount: 1999
              currency: usd
              recurring:
                interval: month
      payment_methods:
        - id: pm_card_visa
          type: card
          card:
            brand: visa
            last4: "4242"
  resources:
    memory: 128mb
```

**Testing payment flows:**
```yaml
# Test different card scenarios
stripe:
  config:
    test_cards:
      success: "4242424242424242"
      decline: "4000000000000002"
      insufficient_funds: "4000000000009995"
      expired: "4000000000000069"
```

### OAuth Mock

Mock OAuth providers for auth testing.

```yaml
oauth:
  template: oauth-mock
  config:
    providers:
      google:
        client_id: mock_google_client
        client_secret: mock_google_secret
        users:
          - sub: "google-123"
            email: test@gmail.com
            name: Test User
            picture: https://placekitten.com/200/200
            email_verified: true
      github:
        client_id: mock_github_client
        client_secret: mock_github_secret
        users:
          - id: 12345
            login: testuser
            email: test@github.com
            name: Test User
            avatar_url: https://placekitten.com/200/200
      apple:
        client_id: mock_apple_client
        users:
          - sub: "apple-123"
            email: test@icloud.com
    callback_urls:
      - http://localhost:3000/auth/callback
      - http://app:3000/auth/callback
    issuer: http://oauth-mock:8080
  resources:
    memory: 64mb
```

### LocalStack (AWS Mock)

Mock AWS services for local testing.

```yaml
localstack:
  template: localstack
  config:
    services:
      - s3
      - sqs
      - sns
      - dynamodb
      - lambda
      - ses
      - secretsmanager
    s3_buckets:
      - name: uploads
        acl: private
        cors:
          - AllowedOrigins: ["*"]
            AllowedMethods: [GET, PUT, POST]
      - name: public-assets
        acl: public-read
    sqs_queues:
      - name: processing-queue
      - name: notification-queue
    sns_topics:
      - name: events
        subscriptions:
          - protocol: sqs
            endpoint: processing-queue
    dynamodb_tables:
      - name: sessions
        hash_key: id
        range_key: timestamp
        attributes:
          id: S
          timestamp: N
      - name: cache
        hash_key: key
        attributes:
          key: S
    lambda_functions:
      - name: processor
        handler: index.handler
        runtime: nodejs18.x
        code: ./lambdas/processor
  resources:
    memory: 2gb
```

### Mailhog (SMTP Mock)

Email testing server.

```yaml
smtp:
  template: mailhog
  config:
    smtp_port: 1025
    api_port: 8025
    ui_port: 8025
    storage: memory               # Or "maildir" for persistence
  resources:
    memory: 64mb
```

**Access emails via API:**
```bash
# Get all messages
curl http://mailhog:8025/api/v2/messages

# Search messages
curl "http://mailhog:8025/api/v2/search?kind=to&query=test@example.com"
```

## Observability Services

### Monitoring Stack

Complete monitoring with Prometheus, Grafana, and Jaeger.

```yaml
monitoring:
  template: monitoring-stack
  includes:
    - prometheus
    - grafana
    - jaeger
  config:
    grafana:
      admin_password: ${GRAFANA_PASSWORD}
      dashboards:
        - ./dashboards/app.json
        - ./dashboards/database.json
      datasources:
        - name: prometheus
          type: prometheus
          url: http://prometheus:9090
        - name: jaeger
          type: jaeger
          url: http://jaeger:16686
    prometheus:
      scrape_interval: 15s
      scrape_configs:
        - job_name: app
          static_configs:
            - targets: ['app:3000']
        - job_name: postgres
          static_configs:
            - targets: ['postgres-exporter:9187']
    jaeger:
      sampling_rate: 1.0           # Sample all traces in testing
  resources:
    memory: 1gb
```

### Logging Stack

ELK-style logging with Loki.

```yaml
logging:
  template: logging-stack
  includes:
    - loki
    - promtail
  config:
    loki:
      retention_period: 24h
    promtail:
      scrape_configs:
        - job_name: app
          static_configs:
            - targets: [localhost]
              labels:
                job: app
                __path__: /var/log/app/*.log
```

## API Gateway Services

### Kong

API Gateway with plugins.

```yaml
kong:
  template: kong@3
  config:
    database: postgres            # Or "off" for DB-less mode
    routes:
      - name: api
        paths: [/api]
        service: app
        plugins:
          - name: rate-limiting
            config:
              minute: 100
          - name: jwt
          - name: cors
    services:
      - name: app
        url: http://app:3000
  depends_on:
    - postgres
```

### Traefik

Modern reverse proxy.

```yaml
traefik:
  template: traefik@2
  config:
    entrypoints:
      web:
        address: ":80"
      websecure:
        address: ":443"
    routers:
      app:
        rule: "Host(`app.localhost`)"
        service: app
        entrypoints: [web]
    services:
      app:
        loadBalancer:
          servers:
            - url: "http://app:3000"
```

## Custom Service Definition

Create your own service templates:

```yaml
# templates/services/my-custom-service.vers.yaml
apiVersion: vers.sh/v1
kind: ServiceTemplate
metadata:
  name: my-custom-service
  version: 1.0.0
  description: My custom service for testing

spec:
  # Use existing image
  image: my-registry/my-service:latest

  # Or build from Dockerfile
  build:
    dockerfile: ./Dockerfile
    context: ./my-service
    args:
      NODE_ENV: development

  ports:
    - containerPort: 8080
      hostPort: 8080

  environment:
    LOG_LEVEL: debug
    CONFIG_PATH: /etc/myservice/config.yaml

  volumes:
    - host: ./config
      container: /etc/myservice/config
      readonly: true
    - host: ./data
      container: /var/lib/myservice

  healthcheck:
    command: curl -f http://localhost:8080/health
    interval: 10s
    timeout: 5s
    retries: 3
    start_period: 30s

  resources:
    memory: 256mb
    cpu: 0.5

  depends_on:
    - postgres
    - redis

  lifecycle:
    postStart:
      command: /scripts/init.sh
    preStop:
      command: /scripts/cleanup.sh
```

## Service Compatibility Matrix

| Service | Works With | Notes |
|---------|------------|-------|
| postgres | All | Universal compatibility |
| mysql | All | Check driver support |
| mongodb | Node, Python, Go | Native drivers available |
| redis | All | Universal caching layer |
| kafka | Java, Node, Python | Full client support |
| elasticsearch | All | REST API access |
| stripe-mock | All | REST API |
| localstack | AWS SDK compatible | Same as real AWS |
