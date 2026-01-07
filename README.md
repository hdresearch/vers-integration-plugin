# Vers Integration Testing Plugin for Claude Code

A comprehensive Claude Code plugin that transforms [Vers.sh](https://vers.sh) into a full integration testing platform. Test service compositions, run parallel integration tests, deploy to hosted environments, and share working integration stacks.

---

## Get Started

**1. Go to [vers.sh](https://vers.sh) and sign up**

The starter pack walks you through everything. You'll get your API key automatically.

**2. Open Claude Code and say:**

> "Set up integration testing for my app with Postgres and Redis"

That's it. You're done.

---

## What Can You Do?

| Say This to Claude | What Happens |
|-------------------|--------------|
| "Set up Postgres and Redis for testing" | Creates a VM with both services, ready to test |
| "Run my tests in parallel" | Branches VM state, runs all tests at once |
| "Test my checkout with different payment methods" | Tests credit card, PayPal, Apple Pay simultaneously |
| "Deploy this to staging" | Pushes your tested stack to a live URL |

---

## Why Vers?

**Traditional testing:**
```
Start DB → Run Test 1 → Stop DB → Start DB → Run Test 2 → Stop DB...
(15 minutes of waiting per test)
```

**With Vers:**
```
Start DB once → Branch → Run ALL tests in parallel
(15 minutes total, not per test)
```

Your tests run **10-100x faster** because you're branching VMs instead of rebuilding them.

---

## Overview

This plugin provides:

- **Skills** - Teach Claude when and how to use VM branching for testing
- **Commands** - Explicit workflows like `/vers-integration-init`, `/vers-integration-test`
- **MCP Server** - Extended tools for service orchestration and deployment
- **Templates** - Pre-configured service and stack definitions

## Quick Start

### Installation

In Claude Code, run:

```
/plugin marketplace add hdresearch/vers-integration-plugin
/plugin install vers-integration-testing
```

Or install directly:

```
/plugin install github:hdresearch/vers-integration-plugin
```

### Basic Usage

```bash
# Initialize a new integration testing project
/vers-integration-init my-saas-app --template saas-starter

# Start all services
/vers-integration-up

# Run tests in parallel
/vers-integration-test --parallel

# Deploy to staging
/vers-integration-deploy staging
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Claude Code                              │
├─────────────────────────────────────────────────────────────┤
│  Skills                    │  Commands                       │
│  ├── vers-integration-     │  ├── /vers-integration-init    │
│  │   testing/              │  ├── /vers-integration-add     │
│  ├── vers-parallel-web-    │  ├── /vers-integration-up      │
│  │   testing/              │  ├── /vers-integration-test    │
│  └── vers-database-        │  ├── /vers-integration-deploy  │
│      testing/              │  └── /vers-integration-matrix  │
├─────────────────────────────────────────────────────────────┤
│                       MCP Servers                            │
│  ┌─────────────────┐    ┌──────────────────────────────┐   │
│  │   vers (core)   │    │   vers-integration (extended) │   │
│  │   @hdresearch/  │    │   Service orchestration       │   │
│  │   vers-mcp      │    │   Parallel testing            │   │
│  │                 │    │   Deployment management       │   │
│  └────────┬────────┘    └──────────────┬───────────────┘   │
└───────────┼─────────────────────────────┼───────────────────┘
            │                             │
            ▼                             ▼
┌─────────────────────────────────────────────────────────────┐
│                    Vers.sh Platform                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │ Orchestrator │  │Chelsea Nodes│  │   vers.sh Hosted    │ │
│  │   (API)      │  │ (Firecracker│  │   (Deployments)     │ │
│  │              │  │    VMs)     │  │                     │ │
│  └─────────────┘  └─────────────┘  └─────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

## Core Concepts

### Integration Manifest (`vers-integration.yaml`)

Define your integration stack declaratively:

```yaml
name: my-saas-app
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

  redis:
    template: redis@7
    config:
      maxmemory: 256mb

  app:
    build: .
    depends_on: [postgres, redis]

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

deploy:
  staging:
    target: vers.sh/hosted
    domain: staging.myapp.vers.sh
```

### VM Branching for Testing

Traditional integration testing repeats expensive setup for each test:

```
Setup → Test A → Teardown
Setup → Test B → Teardown  (15 min repeated!)
Setup → Test C → Teardown  (15 min repeated!)
```

Vers enables "branch once, test many":

```
Setup → [Checkpoint]
            ├── Branch → Test A (instant)
            ├── Branch → Test B (instant)
            └── Branch → Test C (instant)
```

Each branch inherits complete state: filesystem, memory, running processes, network connections.

## Available Commands

| Command | Description |
|---------|-------------|
| `/vers-integration-init` | Initialize new integration testing project |
| `/vers-integration-add` | Add a service to the stack |
| `/vers-integration-up` | Start all services |
| `/vers-integration-down` | Stop all services |
| `/vers-integration-test` | Run integration tests |
| `/vers-integration-matrix` | Test service version combinations |
| `/vers-integration-deploy` | Deploy to vers.sh hosted |
| `/vers-integration-publish` | Publish stack to registry |

## Available Skills

### [vers-integration-testing](skills/vers-integration-testing/SKILL.md)
Core integration testing knowledge. Activated for:
- Service composition
- Multi-service testing
- Deployment workflows

**Full Documentation:**
- [SKILL.md](skills/vers-integration-testing/SKILL.md) - Core skill definition and usage
- [SERVICE-CATALOG.md](skills/vers-integration-testing/SERVICE-CATALOG.md) - All available service templates
- [COMPOSITION-PATTERNS.md](skills/vers-integration-testing/COMPOSITION-PATTERNS.md) - Recommended architectures
- [TESTING-STRATEGIES.md](skills/vers-integration-testing/TESTING-STRATEGIES.md) - Testing approaches
- [DEPLOYMENT-GUIDE.md](skills/vers-integration-testing/DEPLOYMENT-GUIDE.md) - Hosting options
- [TROUBLESHOOTING.md](skills/vers-integration-testing/TROUBLESHOOTING.md) - Common issues

### [vers-parallel-web-testing](skills/vers-parallel-web-testing/SKILL.md)
Web/UI testing with browser state branching. Activated for:
- Puppeteer/Playwright testing
- Payment flow testing
- Form submission testing

**Features:** Branch-at-decision-point pattern, 95% test time reduction, exact state reproduction for debugging.

### [vers-database-testing](skills/vers-database-testing/SKILL.md)
Database state testing with schema migration support. Activated for:
- PostgreSQL/MySQL testing
- Migration testing
- Data transformation testing

**Features:** Snapshot-and-branch pattern, safe migration testing, instant rollback, parallel strategy comparison.

## Service Templates

Pre-configured services available:

| Category | Services |
|----------|----------|
| **Databases** | postgres, mysql, mongodb, mariadb |
| **Caches** | redis, memcached |
| **Message Queues** | kafka, rabbitmq |
| **Search** | elasticsearch, opensearch, meilisearch |
| **Mocks** | stripe-mock, oauth-mock, localstack, mailhog |
| **Observability** | prometheus, grafana, jaeger |

## Stack Templates

Pre-composed integration stacks:

- `saas-starter` - PostgreSQL, Redis, Stripe, OAuth, Email
- `microservices` - Kafka, multiple DBs, API gateway
- `data-pipeline` - Source DB, Warehouse, Elasticsearch, ETL
- `ecommerce` - Full e-commerce with payments and search

## Testing Strategies

### Branch-Per-Scenario
Test multiple scenarios from one setup point:

```bash
vers integration test --suite checkout
# Creates branches: happy-path, payment-failure, cart-abandonment
# Runs all in parallel
```

### Matrix Testing
Test all version combinations:

```yaml
matrix:
  postgres: [14, 15, 16]
  redis: [6, 7]
  node: [18, 20]
# Tests 3 × 2 × 2 = 12 combinations
```

### Chaos Testing
Inject failures to test resilience:

```yaml
chaos:
  scenarios:
    - name: database-crash
      inject:
        service: postgres
        action: kill
      expect:
        - app.graceful-degradation
```

## Deployment

### Preview Environments
Automatic PR preview environments:

```yaml
deploy:
  preview:
    domain: pr-${PR_NUMBER}.preview.myapp.vers.sh
    lifecycle:
      create_on: pull_request.opened
      destroy_on: pull_request.closed
```

### Blue-Green Deployment
Zero-downtime production deployments:

```yaml
deploy:
  production:
    strategy: blue-green
    canary:
      initial_percent: 10
      increment: 10
      interval: 5m
```

## Documentation

- [Service Catalog](skills/vers-integration-testing/SERVICE-CATALOG.md) - All available service templates
- [Composition Patterns](skills/vers-integration-testing/COMPOSITION-PATTERNS.md) - Recommended architectures
- [Testing Strategies](skills/vers-integration-testing/TESTING-STRATEGIES.md) - Testing approaches
- [Deployment Guide](skills/vers-integration-testing/DEPLOYMENT-GUIDE.md) - Hosting options
- [Troubleshooting](skills/vers-integration-testing/TROUBLESHOOTING.md) - Common issues

## Development

### Plugin Structure

```
vers-integration-plugin/
├── .claude-plugin/
│   └── plugin.json              # Plugin manifest
├── .mcp.json                    # MCP server config
├── commands/                    # Slash commands
├── skills/                      # Claude skills
│   ├── vers-integration-testing/
│   ├── vers-parallel-web-testing/
│   └── vers-database-testing/
├── templates/
│   ├── services/               # Service definitions
│   └── stacks/                 # Stack templates
├── scripts/
│   └── mcp-server.ts           # Extended MCP server
└── hooks/
    └── hooks.json              # Session hooks
```

### Requirements

Just sign up at [vers.sh](https://vers.sh). The starter pack handles everything.

---

## Need Help?

Ask Claude: *"Help me with Vers"* — Claude knows how to fix most issues.

Or: [Open an issue](https://github.com/hdresearch/vers-integration-plugin/issues) · [support@vers.sh](mailto:support@vers.sh)

---

## Development

### Building from Source

```bash
# Install dependencies
npm install

# Build MCP server
npm run build

# Run tests
npm test
```

## Contributing

Contributions welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

MIT License - see [LICENSE](LICENSE) for details.

## Links

- [Vers.sh](https://vers.sh) - Get your API key
- [Vers Documentation](https://docs.vers.sh)
- [Report Issues](https://github.com/hdresearch/vers-integration-plugin/issues)
