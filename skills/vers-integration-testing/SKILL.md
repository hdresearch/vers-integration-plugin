---
name: vers-integration-testing
description: Integration testing platform using Vers VM branching. Use when user needs to test service integrations, compose multi-service stacks, run integration test matrices, deploy integrated systems, or manage complex testing environments. Activate for keywords: integration testing, service composition, microservices testing, API integration, end-to-end testing, staging environment, deployment, preview environments, chaos testing.
globs:
  - "**/vers-integration.yaml"
  - "**/vers-integration.yml"
  - "**/vers.toml"
---

# Vers Integration Testing Platform

Vers transforms integration testing from a slow, painful process into a fast, parallelizable workflow. By capturing complete system state—multiple services, their data, network connections, and running processes—you can branch at any point and test integrations in parallel.

## Core Mental Model

Traditional integration testing:
```
Start Postgres → Start Redis → Start App → Seed Data → Test A → Teardown ALL
Start Postgres → Start Redis → Start App → Seed Data → Test B → Teardown ALL
(15 minutes repeated per test suite!)
```

Vers integration testing:
```
Start All Services → Seed Data → [Checkpoint: "integration-ready"]
                                      ├── Branch → Test Suite A (instant)
                                      ├── Branch → Test Suite B (instant)
                                      ├── Branch → Test Suite C (instant)
                                      └── Branch → Deploy to Staging (instant)
```

## The Integration Testing Lifecycle

### Phase 1: Define Your Stack

```bash
/vers-integration-init my-saas-app --template saas-starter
```

This creates `vers-integration.yaml` where you declare:
- Services needed (databases, caches, queues, mocks)
- Dependencies between services
- Health checks for each service
- Test suites to run
- Deployment targets

### Phase 2: Compose Services

```bash
/vers-integration-add postgres@15 --databases app,analytics
/vers-integration-add redis@7 --maxmemory 256mb
/vers-integration-add stripe-mock --webhook http://localhost:3000/hooks
```

Each service is added to your manifest and validated for compatibility.

### Phase 3: Build & Start

```bash
vers integration up
```

This:
1. Builds the VM with all service dependencies
2. Starts services in dependency order
3. Waits for all health checks to pass
4. Creates automatic checkpoint: `services-ready`

### Phase 4: Seed & Checkpoint

```bash
vers connect
> npm run db:seed
> npm run setup:test-users
> exit

vers commit --tag "seeded-ready-for-testing"
```

### Phase 5: Branch & Test in Parallel

```bash
# Create branches for each test scenario
vers integration test --parallel

# This automatically:
# 1. Creates branch for each test suite defined in manifest
# 2. Runs tests in parallel across branches
# 3. Collects results from all branches
# 4. Reports aggregated pass/fail
```

### Phase 6: Deploy Successful Branch

```bash
# Promote a tested branch to hosted environment
vers integration deploy staging --branch tests-passed

# This:
# 1. Takes the exact VM state from that branch
# 2. Deploys it to vers.sh hosted infrastructure
# 3. Configures networking/domain
# 4. Returns live URL
```

## Quick Reference

```bash
# Initialize integration project
vers integration init <name> [--template <template>]

# Add services
vers integration add <service@version> [--config key=value...]

# Start/stop services
vers integration up [--services <list>]
vers integration down

# Run tests
vers integration test [--suite <name>] [--parallel]
vers integration matrix  # Test all version combinations

# Deploy
vers integration deploy <environment> [--branch <name>]
vers integration preview create <name>  # PR preview environments

# Share
vers integration publish <name> [--public]
vers integration import <user>/<name>
```

## The vers-integration.yaml Manifest

```yaml
name: my-integration
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
      extensions: [uuid-ossp]
    healthcheck:
      command: pg_isready

  redis:
    template: redis@7
    config:
      maxmemory: 256mb

  app:
    build: .
    depends_on: [postgres, redis]
    healthcheck:
      command: curl localhost:3000/health

tests:
  unit:
    command: npm run test:unit
  integration:
    command: npm run test:integration
    depends_on: [postgres, redis]
  e2e:
    command: npm run test:e2e
    branches:
      - name: happy-path
        env: { SCENARIO: success }
      - name: error-path
        env: { SCENARIO: failure }

checkpoints:
  - name: services-ready
    after: services.*.healthcheck
  - name: seeded
    after: scripts/seed.sh

deploy:
  staging:
    target: vers.sh/hosted
    domain: staging.myapp.vers.sh
  production:
    target: vers.sh/hosted
    domain: myapp.vers.sh
```

## Available Service Templates

| Service | Versions | Purpose |
|---------|----------|---------|
| postgres | 13, 14, 15, 16 | Primary database |
| mysql | 5.7, 8.0 | Primary database |
| mongodb | 5, 6, 7 | Document store |
| redis | 6, 7 | Cache/sessions |
| elasticsearch | 7, 8 | Search |
| kafka | 3.x | Event streaming |
| rabbitmq | 3.x | Message queue |
| stripe-mock | latest | Payment testing |
| oauth-mock | latest | Auth testing |
| localstack | latest | AWS mocking |
| mailhog | latest | Email testing |

## When to Use Integration Testing Platform

**Use this approach when:**
- Testing multiple services together
- Running parallel test scenarios from same state
- Testing different service version combinations
- Creating preview environments for PRs
- Deploying tested integrations to staging/production
- Sharing working integration stacks with team

**Don't use when:**
- Single-service unit tests (use regular test runner)
- Stateless operations that don't need VM state
- Quick one-off commands

## Related Documentation

- [SERVICE-CATALOG.md](SERVICE-CATALOG.md) - All available service templates
- [COMPOSITION-PATTERNS.md](COMPOSITION-PATTERNS.md) - Recommended service combinations
- [TESTING-STRATEGIES.md](TESTING-STRATEGIES.md) - Testing approaches and patterns
- [DEPLOYMENT-GUIDE.md](DEPLOYMENT-GUIDE.md) - Hosting and deployment options
- [TROUBLESHOOTING.md](TROUBLESHOOTING.md) - Common issues and solutions
