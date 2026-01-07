# Vers Integration Deployment Guide

Deploy tested integration stacks to Vers.sh hosted environments.

## Deployment Targets

### 1. Vers.sh Hosted (Recommended)

Deploy directly to Vers.sh managed infrastructure with zero configuration.

```bash
# Deploy to staging
vers integration deploy staging

# Deploy specific branch to production
vers integration deploy production --branch tested-and-approved

# Deploy with custom domain
vers integration deploy production --domain api.myapp.com
```

**Configuration in vers-integration.yaml:**
```yaml
deploy:
  staging:
    target: vers.sh/hosted
    domain: staging.myapp.vers.sh
    resources:
      memory: 2gb
      vcpu: 1
    auto_deploy:
      branch: develop
      on: push

  production:
    target: vers.sh/hosted
    domain: api.myapp.com
    resources:
      memory: 4gb
      vcpu: 2
    scaling:
      min_instances: 2
      max_instances: 10
      target_cpu: 70%
    ssl:
      provider: letsencrypt
      force_https: true
```

### 2. Self-Hosted Vers Cluster

Deploy to your own infrastructure running Vers:

```bash
vers integration deploy --target my-cluster.internal
```

```yaml
deploy:
  on-prem:
    target: self-hosted
    cluster: my-cluster.internal
    credentials: ${VERS_CLUSTER_TOKEN}
    resources:
      memory: 8gb
      vcpu: 4
```

### 3. Export for External Deployment

Export the VM image for deployment to any cloud:

```bash
# Export as OCI image (Docker-compatible)
vers integration export --format oci --output ./deploy/image.tar

# Export as raw disk image
vers integration export --format raw --output ./deploy/disk.img

# Export as cloud-specific format
vers integration export --format ami --region us-east-1
vers integration export --format gce --project my-project
vers integration export --format azure --subscription my-sub
```

---

## Deployment Workflows

### Preview Environments

Create ephemeral environments for PR review:

```yaml
deploy:
  preview:
    target: vers.sh/hosted
    domain: pr-${PR_NUMBER}.preview.myapp.vers.sh
    lifecycle:
      create_on: pull_request.opened
      update_on: pull_request.synchronize
      destroy_on: pull_request.closed
      max_age: 7d
    resources:
      memory: 1gb
      vcpu: 1
    notifications:
      - type: github-comment
        template: |
          ## Preview Environment Ready

          URL: https://pr-${PR_NUMBER}.preview.myapp.vers.sh

          **Services:**
          {{#each services}}
          - {{name}}: {{status}}
          {{/each}}
```

**GitHub Actions Integration:**
```yaml
# .github/workflows/preview.yml
name: Preview Environment

on:
  pull_request:
    types: [opened, synchronize, closed]

jobs:
  deploy-preview:
    if: github.event.action != 'closed'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Vers
        uses: hdresearch/setup-vers@v1
        with:
          api-key: ${{ secrets.VERS_API_KEY }}

      - name: Deploy Preview
        id: deploy
        run: |
          URL=$(vers integration deploy preview \
            --branch ${{ github.head_ref }} \
            --env PR_NUMBER=${{ github.event.number }} \
            --output-url)
          echo "url=$URL" >> $GITHUB_OUTPUT

      - name: Comment PR
        uses: actions/github-script@v6
        with:
          script: |
            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: `## Preview Deployed

              URL: ${{ steps.deploy.outputs.url }}

              This preview will be automatically deleted when the PR is closed.`
            })

  cleanup-preview:
    if: github.event.action == 'closed'
    runs-on: ubuntu-latest
    steps:
      - name: Delete Preview
        run: |
          vers integration preview delete pr-${{ github.event.number }}
```

### Blue-Green Deployment

Zero-downtime deployments with instant rollback:

```yaml
deploy:
  production:
    strategy: blue-green

    # Health check before switching traffic
    health_check:
      path: /health
      interval: 5s
      timeout: 10s
      healthy_threshold: 3

    # Canary rollout
    canary:
      enabled: true
      initial_percent: 10
      increment: 10
      interval: 5m
      success_metrics:
        error_rate: < 1%
        p99_latency: < 200ms

    # Automatic rollback
    rollback:
      automatic: true
      triggers:
        - error_rate > 5%
        - p99_latency > 500ms
        - health_check_failures > 3
      keep_previous: 2  # Versions to retain for rollback
```

**Deployment flow:**
```
1. Deploy new version as "green" (inactive)
2. Run health checks on green
3. Route 10% traffic to green (canary)
4. Monitor metrics for 5 minutes
5. If healthy, increment to 20%, 30%, ... 100%
6. If unhealthy, rollback to "blue" instantly
7. Keep blue available for instant rollback
```

### Rolling Deployment

Gradual rollout for scaled services:

```yaml
deploy:
  production:
    strategy: rolling
    scaling:
      instances: 5
    rolling:
      max_unavailable: 1    # At most 1 instance down
      max_surge: 1          # At most 1 extra instance

    # Per-instance health check
    health_check:
      path: /health
      initial_delay: 30s
      period: 10s
```

### Scheduled Deployments

Deploy at specific times:

```yaml
deploy:
  production:
    schedule:
      allowed_days: [monday, tuesday, wednesday, thursday]
      allowed_hours: "09:00-17:00"
      timezone: America/New_York
      blackout_dates:
        - 2024-12-25
        - 2024-01-01
        - 2024-11-28  # Thanksgiving

    # Require manual approval outside schedule
    require_approval_outside_schedule: true
```

---

## Environment Management

### Secrets Management

```yaml
deploy:
  production:
    secrets:
      # Vault
      provider: vault
      path: secret/myapp/production
      inject:
        - DATABASE_PASSWORD
        - STRIPE_SECRET_KEY
        - JWT_SECRET

      # Or AWS Secrets Manager
      provider: aws-secrets
      region: us-east-1
      secrets:
        - arn:aws:secretsmanager:us-east-1:123456789:secret:myapp/db
        - arn:aws:secretsmanager:us-east-1:123456789:secret:myapp/api-keys

      # Or environment variables (for simple cases)
      provider: env
      vars:
        DATABASE_PASSWORD: ${DATABASE_PASSWORD}
        STRIPE_SECRET_KEY: ${STRIPE_SECRET_KEY}
```

### Environment Variables

```yaml
deploy:
  staging:
    env:
      NODE_ENV: staging
      LOG_LEVEL: debug
      FEATURE_FLAGS: experimental,beta
      API_URL: https://staging-api.myapp.com

  production:
    env:
      NODE_ENV: production
      LOG_LEVEL: info
      FEATURE_FLAGS: stable
      API_URL: https://api.myapp.com

    # Computed values
    env_from:
      - configmap: app-config
      - secret: app-secrets
```

### Resource Limits

```yaml
deploy:
  production:
    resources:
      # Per-instance resources
      memory:
        request: 2gb    # Guaranteed
        limit: 4gb      # Maximum
      cpu:
        request: 1      # Guaranteed vCPUs
        limit: 2        # Maximum vCPUs

      # Storage
      storage:
        size: 20gb
        class: ssd      # Options: ssd, hdd

      # Network
      network:
        bandwidth: 1gbps

    # Instance scaling
    scaling:
      min: 2
      max: 10
      target_cpu: 70%
      target_memory: 80%
      scale_up_cooldown: 3m
      scale_down_cooldown: 5m
```

---

## Monitoring & Observability

### Built-in Metrics

Every deployment automatically includes:

```yaml
monitoring:
  metrics:
    # Request metrics
    - http_requests_total
    - http_request_duration_seconds
    - http_request_size_bytes
    - http_response_size_bytes

    # System metrics
    - process_cpu_seconds_total
    - process_resident_memory_bytes
    - process_open_fds

    # Custom metrics (if exposed)
    - custom_*

  dashboards:
    - name: Overview
      panels:
        - request_rate
        - error_rate
        - latency_percentiles
        - cpu_usage
        - memory_usage
```

**Access metrics:**
```bash
# View live metrics
vers integration metrics production

# Export to Prometheus format
vers integration metrics production --format prometheus --output metrics.txt

# View in Grafana (if configured)
vers integration dashboard production
```

### Logging

```yaml
deploy:
  production:
    logging:
      # Built-in log aggregation
      driver: vers
      retention: 30d

      # Or external logging
      driver: datadog
      api_key: ${DATADOG_API_KEY}
      tags:
        - env:production
        - service:myapp

      # Or Elasticsearch
      driver: elasticsearch
      endpoint: https://logs.myapp.com
      index: myapp-production
```

**Access logs:**
```bash
# Tail logs
vers integration logs production --follow

# Search logs
vers integration logs production --search "error" --since 1h

# Export logs
vers integration logs production --since 24h --output logs.json
```

### Alerts

```yaml
deploy:
  production:
    alerts:
      - name: high-error-rate
        condition: error_rate > 5%
        duration: 5m
        severity: critical
        notify:
          - channel: slack
            webhook: ${SLACK_WEBHOOK}
            template: |
              :red_circle: High error rate in production
              Current: {{value}}%
              Threshold: 5%
          - channel: pagerduty
            routing_key: ${PAGERDUTY_KEY}

      - name: high-latency
        condition: p99_latency > 500ms
        duration: 10m
        severity: warning
        notify:
          - channel: slack
            webhook: ${SLACK_WEBHOOK}

      - name: instance-down
        condition: healthy_instances < min_instances
        duration: 1m
        severity: critical
        notify:
          - channel: pagerduty
            routing_key: ${PAGERDUTY_KEY}

      - name: disk-usage-high
        condition: disk_usage > 80%
        duration: 30m
        severity: warning
        notify:
          - channel: email
            to: ops@myapp.com
```

---

## Rollback & Recovery

### Instant Rollback

```bash
# Rollback to previous version
vers integration rollback production

# Rollback to specific version
vers integration rollback production --to v1.2.3

# Rollback to specific checkpoint
vers integration rollback production --to checkpoint:pre-migration

# Rollback to specific time
vers integration rollback production --to "2024-01-15T10:30:00Z"
```

### Version History

```bash
# List deployment history
vers integration history production

# Output:
# Version  | Branch     | Deployed At          | Status  | Duration
# ---------|------------|---------------------|---------|----------
# v1.3.0   | main       | 2024-01-15 10:30:00 | current | 2h 15m
# v1.2.5   | main       | 2024-01-14 14:00:00 | rolled  | 20h 30m
# v1.2.4   | hotfix/123 | 2024-01-14 12:00:00 | rolled  | 2h
# v1.2.3   | main       | 2024-01-13 09:00:00 | rolled  | 27h

# View specific version details
vers integration history production --version v1.2.3
```

### Disaster Recovery

```yaml
deploy:
  production:
    backup:
      enabled: true
      schedule: "0 */6 * * *"  # Every 6 hours
      retention: 30d
      destination:
        type: s3
        bucket: myapp-backups
        region: us-east-1
        encryption: AES256

      # What to backup
      include:
        - database: postgres
          method: pg_dump
        - storage: /var/data
          method: snapshot
        - config: /etc/myapp
          method: archive

    recovery:
      rpo: 6h    # Recovery Point Objective (max data loss)
      rto: 15m   # Recovery Time Objective (max downtime)

      # Recovery procedures
      procedures:
        - name: database-recovery
          steps:
            - restore_latest_backup
            - replay_wal_logs
            - verify_integrity
        - name: full-recovery
          steps:
            - provision_new_infrastructure
            - restore_all_backups
            - update_dns
            - verify_services
```

**Recovery commands:**
```bash
# List available backups
vers integration backups production

# Restore from backup
vers integration restore production --backup backup-2024-01-15-0600

# Test recovery (creates temporary environment)
vers integration restore production --backup latest --test-only
```

---

## CI/CD Integration

### GitHub Actions

```yaml
# .github/workflows/deploy.yml
name: Deploy

on:
  push:
    branches: [main]
  workflow_dispatch:
    inputs:
      environment:
        description: 'Environment to deploy to'
        required: true
        default: 'staging'
        type: choice
        options:
          - staging
          - production

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: hdresearch/setup-vers@v1

      - name: Run Integration Tests
        run: |
          vers integration up --checkpoint tested
          vers integration test --parallel

  deploy-staging:
    needs: test
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    environment: staging
    steps:
      - uses: actions/checkout@v4
      - uses: hdresearch/setup-vers@v1

      - name: Deploy to Staging
        run: vers integration deploy staging

  deploy-production:
    needs: deploy-staging
    if: github.event_name == 'workflow_dispatch' && github.event.inputs.environment == 'production'
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: actions/checkout@v4
      - uses: hdresearch/setup-vers@v1

      - name: Deploy to Production
        run: vers integration deploy production --require-approval
```

### GitLab CI

```yaml
# .gitlab-ci.yml
stages:
  - test
  - deploy

test:
  stage: test
  script:
    - vers integration up --checkpoint tested
    - vers integration test --parallel

deploy-staging:
  stage: deploy
  environment: staging
  script:
    - vers integration deploy staging
  only:
    - main

deploy-production:
  stage: deploy
  environment: production
  script:
    - vers integration deploy production
  when: manual
  only:
    - main
```

---

## Troubleshooting Deployments

### Common Issues

**Deployment stuck in "deploying" state:**
```bash
# Check deployment logs
vers integration deploy-logs production

# Force cancel stuck deployment
vers integration deploy production --cancel

# Retry deployment
vers integration deploy production --retry
```

**Health checks failing:**
```bash
# Check service health
vers integration health production

# View health check logs
vers integration logs production --filter "health"

# SSH into running instance
vers integration connect production
```

**Scaling issues:**
```bash
# View current scale
vers integration scale production

# Manual scale
vers integration scale production --instances 5

# View scaling events
vers integration events production --type scaling
```
