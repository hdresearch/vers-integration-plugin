---
description: Initialize a new Vers integration testing project with service composition
argument-hint: <project-name> [--template <template>]
allowed-tools: Bash(vers:*), Write, Read, Edit
---

## Context
Current directory: !`pwd`
Existing vers files: !`ls -la vers*.{yaml,yml,toml} 2>/dev/null || echo "None found"`

## Task

Initialize a new Vers integration testing project named "$ARGUMENTS".

### Available Templates:
- `blank` - Minimal starting point
- `saas-starter` - PostgreSQL, Redis, Stripe mock, OAuth mock, email
- `microservices` - Kafka, multiple databases, service mesh
- `data-pipeline` - Source DB, warehouse, Elasticsearch, ETL workers
- `ecommerce` - Full e-commerce with payments, search, storage

### Steps:

1. Check if `vers-integration.yaml` exists
2. Create project structure:
   - `vers-integration.yaml` - Main manifest
   - `vers.toml` - VM configuration
   - `scripts/` - Setup scripts
   - `tests/` - Test files

3. Generate manifest based on template with services, tests, checkpoints, deploy targets

4. Show next steps to user
