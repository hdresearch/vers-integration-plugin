# Vers MCP Server Upgrade Requirements

This document outlines the features and tools that the `@hdresearch/vers-mcp` server needs to support to enable the full integration testing platform described in this plugin.

## Current Architecture Understanding

Based on analysis of the Chelsea codebase:

### Chelsea Node (Low-Level VM Manager)
- Uses **Firecracker** for VM execution
- Manages VM lifecycle: create, branch, commit, pause, resume, delete
- Handles **snapshots** (memory `.mem` + state `.state` + filesystem)
- Network isolation via **netns + veth + TAP + WireGuard**
- Storage via **Ceph** (distributed) or **LVM** (local)

### Orchestrator (High-Level Coordinator)
- Multi-node management
- API key / org / account management
- Routes requests to appropriate Chelsea nodes
- Manages commits (shareable snapshots)

### Key Operations (from `chelsea/crates/orchestrator/src/action/vms/`)
- `new_root` - Create fresh VM from rootfs
- `branch_vm` - Fork running VM (CoW filesystem + memory snapshot)
- `commit_vm` - Create checkpoint (saveable/shareable)
- `from_commit_vm` - Restore VM from commit
- `update_state` - Pause/resume VM
- `delete_vm` - Destroy VM

---

## Required MCP Tools for Integration Testing

### Tier 1: Core Operations (Must Have)

These are essential for basic integration testing workflows:

```typescript
// 1. VM Status & Information
vers_status: {
  description: "Get current VM status, running services, and health",
  returns: { vm_id, state, services[], health, uptime }
}

// 2. Branch Operations
vers_branch_create: {
  description: "Create a new VM branch from current or specified state",
  params: { alias: string, from?: string },
  returns: { branch_id, vm_id }
}

vers_branch_list: {
  description: "List all branches in current cluster",
  returns: Branch[]
}

vers_branch_checkout: {
  description: "Switch to a different branch (pauses current, resumes target)",
  params: { branch: string },
  returns: { success, previous_branch, current_branch }
}

vers_branch_delete: {
  description: "Delete a branch",
  params: { branch: string, force?: boolean }
}

// 3. Checkpoint/Commit Operations
vers_commit: {
  description: "Create a checkpoint of current state",
  params: { tag: string, message?: string },
  returns: { commit_id, tag }
}

vers_rollback: {
  description: "Rollback to a previous checkpoint",
  params: { target: string },
  returns: { success, rolled_back_to }
}

// 4. Execution
vers_execute: {
  description: "Execute command in VM",
  params: { command: string, timeout?: number },
  returns: { stdout, stderr, exit_code }
}

vers_connect_info: {
  description: "Get SSH connection details for VM",
  returns: { host, port, user, key_path }
}
```

### Tier 2: Service Orchestration (High Priority)

For multi-service integration testing:

```typescript
// 5. Service Management
vers_service_start: {
  description: "Start a service in the VM",
  params: { service: string, config?: object },
  returns: { status, ports[] }
}

vers_service_stop: {
  description: "Stop a service",
  params: { service: string }
}

vers_service_status: {
  description: "Get service health and status",
  params: { service: string },
  returns: { status, health, uptime, ports[] }
}

vers_service_logs: {
  description: "Get logs from a service",
  params: { service: string, lines?: number, since?: string },
  returns: { logs: string }
}

// 6. Health Checks
vers_healthcheck: {
  description: "Run healthcheck on service or VM",
  params: { target?: string, command?: string },
  returns: { healthy: boolean, details }
}

vers_wait_healthy: {
  description: "Wait for service/VM to become healthy",
  params: { target: string, timeout_ms?: number },
  returns: { healthy: boolean, duration_ms }
}
```

### Tier 3: Testing Operations (Medium Priority)

For parallel test execution:

```typescript
// 7. Parallel Execution
vers_parallel_execute: {
  description: "Execute commands across multiple branches in parallel",
  params: {
    branches: string[],
    command: string
  },
  returns: { results: { branch, stdout, stderr, exit_code }[] }
}

// 8. State Comparison
vers_diff: {
  description: "Compare state between branches",
  params: { branch1: string, branch2: string, aspects?: string[] },
  returns: { differences: { aspect, branch1_value, branch2_value }[] }
}

vers_snapshot_state: {
  description: "Capture current state for comparison",
  params: { aspects: string[] },
  returns: { snapshot_id, captured_at, data }
}
```

### Tier 4: Deployment Operations (For vers.sh Hosted)

For deployment to vers.sh infrastructure:

```typescript
// 9. Deployment
vers_deploy: {
  description: "Deploy current branch to vers.sh hosted",
  params: {
    environment: "staging" | "production" | "preview",
    domain?: string,
    config?: DeployConfig
  },
  returns: { deployment_id, url, status }
}

vers_deployment_status: {
  description: "Get deployment status",
  params: { deployment_id: string },
  returns: { status, url, health, created_at }
}

vers_deployment_rollback: {
  description: "Rollback deployment to previous version",
  params: { environment: string, to?: string }
}

// 10. Preview Environments
vers_preview_create: {
  description: "Create ephemeral preview environment",
  params: { name: string, branch?: string, ttl?: string },
  returns: { preview_id, url }
}

vers_preview_delete: {
  description: "Delete preview environment",
  params: { name: string }
}
```

### Tier 5: Registry Operations (For Sharing)

For publishing/importing integration stacks:

```typescript
// 11. Registry
vers_publish: {
  description: "Publish integration stack to registry",
  params: {
    name: string,
    visibility: "public" | "private" | "team",
    description?: string,
    tags?: string[]
  },
  returns: { registry_url }
}

vers_import: {
  description: "Import integration stack from registry",
  params: { source: string },
  returns: { imported_services[], config }
}

vers_search: {
  description: "Search registry for integration stacks",
  params: { query: string, tags?: string[] },
  returns: { results: RegistryEntry[] }
}
```

---

## Implementation Priority

### Phase 1: Foundation (Week 1-2)
Essential tools for basic VM branching workflows:

| Tool | Priority | Notes |
|------|----------|-------|
| `vers_status` | P0 | Already exists in CLI |
| `vers_branch_create` | P0 | Maps to `branch_vm` action |
| `vers_branch_list` | P0 | List from store |
| `vers_branch_checkout` | P0 | Pause + resume |
| `vers_commit` | P0 | Maps to `commit_vm` action |
| `vers_execute` | P0 | Run command in VM |

### Phase 2: Testing Support (Week 3-4)
Tools for parallel test execution:

| Tool | Priority | Notes |
|------|----------|-------|
| `vers_rollback` | P1 | Maps to `from_commit_vm` |
| `vers_diff` | P1 | Compare branch states |
| `vers_parallel_execute` | P1 | Orchestrate across branches |
| `vers_healthcheck` | P1 | Service health verification |
| `vers_wait_healthy` | P1 | Blocking health wait |

### Phase 3: Service Layer (Week 5-6)
Higher-level service management:

| Tool | Priority | Notes |
|------|----------|-------|
| `vers_service_start` | P2 | Start named service |
| `vers_service_stop` | P2 | Stop service |
| `vers_service_status` | P2 | Service health |
| `vers_service_logs` | P2 | Tail service logs |

### Phase 4: Deployment & Sharing (Week 7-8)
Vers.sh platform integration:

| Tool | Priority | Notes |
|------|----------|-------|
| `vers_deploy` | P3 | Deploy to vers.sh |
| `vers_preview_create` | P3 | PR preview environments |
| `vers_publish` | P3 | Registry publishing |
| `vers_import` | P3 | Registry importing |

---

## Data Types

### Branch
```typescript
interface Branch {
  id: string;
  alias: string;
  parent_id?: string;
  created_at: string;
  state: "running" | "paused" | "stopped";
  commit_id?: string;
}
```

### Commit
```typescript
interface Commit {
  id: string;
  tag: string;
  message?: string;
  created_at: string;
  vm_id: string;
  size_bytes: number;
}
```

### ServiceStatus
```typescript
interface ServiceStatus {
  name: string;
  status: "running" | "stopped" | "starting" | "error";
  health: "healthy" | "unhealthy" | "unknown";
  ports: number[];
  uptime_seconds?: number;
  error?: string;
}
```

### DeploymentInfo
```typescript
interface DeploymentInfo {
  id: string;
  environment: string;
  status: "deploying" | "running" | "failed" | "stopped";
  url?: string;
  branch: string;
  created_at: string;
  health_check_status?: "passing" | "failing";
}
```

---

## CLI to MCP Mapping

Current Vers CLI commands and their MCP equivalents:

| CLI Command | MCP Tool | Notes |
|-------------|----------|-------|
| `vers status` | `vers_status` | ✓ Direct mapping |
| `vers branch` | `vers_branch_create` | ✓ Direct mapping |
| `vers branch list` | `vers_branch_list` | ✓ Direct mapping |
| `vers checkout` | `vers_branch_checkout` | ✓ Direct mapping |
| `vers commit` | `vers_commit` | ✓ Direct mapping |
| `vers rollback` | `vers_rollback` | ✓ Direct mapping |
| `vers connect` | `vers_connect_info` | Returns connection details |
| `vers execute` | `vers_execute` | ✓ Direct mapping |
| `vers build` | N/A | Pre-plugin setup |
| `vers init` | N/A | Pre-plugin setup |

---

## Integration with Plugin Skills

The MCP tools enable the following skill workflows:

### Parallel Web Testing Skill
```
1. vers_execute "node setup.js"     # Run setup
2. vers_commit "browser-ready"       # Checkpoint
3. vers_branch_create "test-a"       # Fork
4. vers_branch_create "test-b"       # Fork
5. vers_parallel_execute [...]       # Run tests
6. vers_diff "test-a" "test-b"       # Compare
```

### Database State Testing Skill
```
1. vers_execute "psql -f schema.sql" # Setup DB
2. vers_commit "db-seeded"           # Checkpoint
3. vers_branch_create "migration-a"  # Fork
4. vers_execute "npm run migrate"    # Apply migration
5. vers_healthcheck "postgres"       # Verify
6. vers_rollback "db-seeded"         # Reset
```

### Integration Testing Skill
```
1. vers_service_start "postgres"     # Start services
2. vers_service_start "redis"
3. vers_wait_healthy "postgres"      # Wait ready
4. vers_commit "services-ready"      # Checkpoint
5. vers_parallel_execute [branches]  # Test matrix
6. vers_deploy "staging"             # Deploy passed
```

---

## Implementation Notes

### Leveraging Existing Chelsea Code

The vers-mcp server can leverage these existing components:

1. **Action Pattern** (`crates/orchestrator/src/action.rs`)
   - Async action execution with timeout
   - Graceful shutdown support
   - Error handling patterns

2. **VM Operations** (`crates/orchestrator/src/action/vms/`)
   - `branch_vm.rs` - Branch creation logic
   - `commit_vm.rs` - Checkpoint creation
   - `from_commit_vm.rs` - Restore from commit
   - `update_state.rs` - Pause/resume

3. **Proto/HTTP Client** (`crates/orchestrator/src/outbound/node_proto/`)
   - Communication with Chelsea nodes
   - Request/response handling

4. **Data Types** (`crates/dto_lib/`)
   - Shared data transfer objects
   - API request/response types

### Authentication

MCP server should use the same auth pattern as the orchestrator:
- API key authentication
- Org-level resource isolation
- Rate limiting per API key

### Error Handling

Follow the established error patterns:
```rust
#[derive(Debug, Error)]
pub enum McpToolError {
    #[error("vm not found: {0}")]
    VmNotFound(String),
    #[error("branch not found: {0}")]
    BranchNotFound(String),
    #[error("operation timeout")]
    Timeout,
    #[error("forbidden")]
    Forbidden,
    // etc.
}
```

---

## Testing the MCP Server

### Unit Tests
```rust
#[tokio::test]
async fn test_branch_create() {
    let ctx = setup_test_context().await;
    let result = vers_branch_create(&ctx, "test-branch", None).await;
    assert!(result.is_ok());
}
```

### Integration Tests
```bash
# Start MCP server in test mode
cargo run --features integration-tests

# Run MCP client tests
npm run test:mcp
```

---

## Questions for Vers Team

1. **Service Templates**: Where should service templates (postgres, redis, etc.) be defined?
   - In the MCP server?
   - In the plugin skills?
   - In a separate registry?

2. **Multi-Service Orchestration**: How should multiple services be managed within a single VM?
   - Systemd services?
   - Docker containers within VM?
   - Direct process management?

3. **Deployment Pipeline**: What's the planned flow for `vers deploy`?
   - Package VM state
   - Upload to vers.sh
   - Provision infrastructure
   - Configure networking

4. **Registry**: Is there a planned vers.sh registry for sharing integration stacks?
   - Public/private visibility
   - Versioning
   - Dependencies

---

## Next Steps

1. **Review this document** with Vers team
2. **Prioritize MCP tools** based on customer needs
3. **Implement Phase 1 tools** in vers-mcp
4. **Update this plugin** to use actual MCP tools
5. **Test end-to-end** with real integration scenarios
