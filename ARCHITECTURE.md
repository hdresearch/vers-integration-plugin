# Vers Integration Testing Plugin Architecture

## How This Plugin Integrates with Chelsea/Vers

This document explains how the integration testing plugin works with the Chelsea orchestrator that powers Vers.sh.

## Understanding Vers at the Core

### Chelsea Architecture

Chelsea is a Firecracker VM manager written in Rust. Key components:

```
┌─────────────────────────────────────────────────────────────────┐
│                        Chelsea Server                            │
├──────────────┬──────────────┬──────────────┬───────────────────┤
│  VM Manager  │Process Manager│Volume Manager│ Network Manager   │
│  (trees)     │ (Firecracker) │   (Ceph)     │ (WireGuard/TAP)   │
└──────────────┴──────────────┴──────────────┴───────────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │  Firecracker VM │
                    │   ┌───────────┐ │
                    │   │ Services  │ │  ← Services run INSIDE VM
                    │   │  - postgres│ │
                    │   │  - redis   │ │
                    │   │  - app     │ │
                    │   └───────────┘ │
                    └─────────────────┘
```

### Key Insight: VM-Centric, Not Container-Centric

**Vers is NOT like Docker Compose.** In Vers:

1. **One VM = One Environment** - All services run inside a single Firecracker VM
2. **Branching captures EVERYTHING** - Memory, disk, processes, network state
3. **Services are processes** - Managed via systemd, supervisord, or direct execution
4. **No container isolation** - Services share the VM's kernel and filesystem

This is **more powerful** than containers because:
- Memory state is preserved (running processes, open connections)
- Branch is instant (copy-on-write, not rebuild)
- Restore captures exact runtime state

## Chelsea API Endpoints

The plugin communicates with Chelsea via these HTTP endpoints:

### VM Lifecycle

```
POST   /api/vm/new_root          Create new root VM
POST   /api/vm/{vm_id}/branch    Create branch from VM
DELETE /api/vm/{vm_id}           Delete VM (recursive)
GET    /api/vm                   List all VM trees
```

### State Management

```
POST   /api/vm/{vm_id}/commit    Commit VM state → returns commit_id
POST   /api/vm/from_commit       Create VM from commit_id
PATCH  /api/vm/{vm_id}/state     Pause/Resume VM
```

### Access

```
GET    /api/vm/{vm_id}/ssh_key   Get SSH credentials for VM
```

### Request/Response Examples

**Create Root VM:**
```json
POST /api/vm/new_root
{
  "vm_id": "550e8400-e29b-41d4-a716-446655440000",
  "vm_config": {
    "kernel_name": "default.bin",
    "image_name": "default",
    "vcpu_count": 2,
    "mem_size_mib": 2048,
    "fs_size_mib": 4096
  },
  "wireguard": { /* WireGuard config */ }
}
```

**Branch VM:**
```json
POST /api/vm/{parent_vm_id}/branch
{
  "vm_id": "new-uuid",
  "wireguard": { /* WireGuard config */ }
}
```

**Commit VM:**
```json
POST /api/vm/{vm_id}/commit
→ Response: { "commit_id": "...", "host_architecture": "x86_64" }
```

## Plugin Architecture

### Layer Stack

```
┌─────────────────────────────────────────────────────────────────┐
│                    Claude Code Plugin                            │
├──────────────────────────────────────────────────────────────────┤
│  Skills          │  Commands           │  Hooks                  │
│  - Integration   │  - /vers-init       │  - SessionStart         │
│  - Web Testing   │  - /vers-test       │  - Auth check           │
│  - DB Testing    │  - /vers-deploy     │                         │
├──────────────────────────────────────────────────────────────────┤
│                      MCP Server                                  │
│  - integration_init     - integration_test                       │
│  - integration_up       - integration_deploy                     │
│  - vers_branch         - vers_commit                             │
├──────────────────────────────────────────────────────────────────┤
│                  Chelsea API Client                              │
│  HTTP calls to Chelsea server endpoints                          │
├──────────────────────────────────────────────────────────────────┤
│                    Chelsea Server                                │
│  Rust server managing Firecracker VMs                            │
├──────────────────────────────────────────────────────────────────┤
│                    Firecracker VM                                │
│  Actual virtualized environment with services                    │
└──────────────────────────────────────────────────────────────────┘
```

### Service Orchestration Within VM

Since services run INSIDE the VM, the plugin orchestrates them via SSH:

```typescript
// Execute command in VM
async function executeInVm(vmId: string, command: string): Promise<string> {
  // 1. Get SSH credentials from Chelsea
  const { ssh_private_key, ssh_port } = await chelsea.get(`/api/vm/${vmId}/ssh_key`);

  // 2. SSH into VM and execute
  return ssh.execute({
    host: "localhost",
    port: ssh_port,
    privateKey: ssh_private_key,
    command
  });
}

// Start PostgreSQL inside VM
await executeInVm(vmId, "systemctl start postgresql");

// Check health
await executeInVm(vmId, "pg_isready");
```

### Service Management Strategies

**Option 1: Systemd (Recommended)**
```bash
# In VM setup
systemctl enable postgresql redis
systemctl start postgresql redis

# Health check
systemctl is-active postgresql && pg_isready
```

**Option 2: Supervisord**
```ini
[program:postgresql]
command=/usr/bin/postgres -D /var/lib/postgresql/data
autostart=true

[program:redis]
command=/usr/bin/redis-server
autostart=true
```

**Option 3: Docker-in-VM**
```bash
# Run containers inside Firecracker VM
docker-compose up -d
```

## The Integration Testing Flow

### Step 1: Initialize Project

```
User: /vers-integration-init my-app --template saas-starter
                    │
                    ▼
Plugin: Create vers-integration.yaml
        Define services, tests, checkpoints
                    │
                    ▼
        vers build (create rootfs with services)
```

### Step 2: Start Integration Stack

```
User: /vers-integration-up
                    │
                    ▼
Plugin: POST /api/vm/new_root
        → Creates Firecracker VM
                    │
                    ▼
        SSH into VM
        → systemctl start postgresql redis app
                    │
                    ▼
        Wait for health checks
        → pg_isready, redis-cli ping, curl health
                    │
                    ▼
        POST /api/vm/{id}/commit --tag "services-ready"
        → Snapshot entire state
```

### Step 3: Run Tests with Branching

```
User: /vers-integration-test --parallel
                    │
                    ▼
Plugin: POST /api/vm/{id}/commit --tag "test-baseline"
                    │
        ┌───────────┼───────────┐
        ▼           ▼           ▼
    Branch A    Branch B    Branch C
    (instant)   (instant)   (instant)
        │           │           │
        ▼           ▼           ▼
    Run test    Run test    Run test
    suite A     suite B     suite C
        │           │           │
        ▼           ▼           ▼
    Collect results from all branches
```

### Step 4: Deploy

```
User: /vers-integration-deploy staging
                    │
                    ▼
Plugin: POST /api/vm/{id}/commit
        → Save current state
                    │
                    ▼
        Upload commit to vers.sh hosted
                    │
                    ▼
        Restore commit on hosted infrastructure
                    │
                    ▼
        Configure networking, SSL, domain
                    │
                    ▼
        Return deployment URL
```

## VM Tree Structure

Chelsea manages VMs as a tree:

```
                    root-vm (original)
                        │
            POST /branch│
        ┌───────────────┼───────────────┐
        ▼               ▼               ▼
    test-auth      test-billing    test-search
        │
    POST /branch
        │
        ▼
    test-auth-google
```

Each branch:
- Has unique VM ID
- Shares parent's filesystem (copy-on-write)
- Can diverge independently
- Can be committed/restored independently

## Commit & Restore

### What a Commit Contains

```
/var/lib/chelsea/commits/{commit_id}/
├── {commit_id}.json          # Metadata
├── {commit_id}.sha512        # Checksum

/var/lib/chelsea/snapshots/{vm_id}/
├── {commit_id}.mem           # Memory snapshot
├── {commit_id}.state         # Firecracker state
```

**Commit Metadata:**
```json
{
  "commit_id": "abc123",
  "process_metadata": {
    "firecracker_state_path": "/path/to/state",
    "memory_snapshot_path": "/path/to/mem"
  },
  "volume_metadata": {
    "ceph_snapshot_name": "snap_abc123"
  },
  "vm_config": {
    "kernel_name": "default.bin",
    "base_image": "default",
    "vcpu_count": 2,
    "mem_size_mib": 2048,
    "fs_size_mib": 4096,
    "ssh_public_key": "...",
    "ssh_private_key": "..."
  }
}
```

### Restore Process

1. Create new VM with new ID
2. Restore Ceph volume from snapshot
3. Restore Firecracker memory state
4. Resume VM execution
5. VM continues from exact point of commit

## Networking

### Inside the VM

```
┌─────────────────────────────────────────┐
│              Firecracker VM              │
│                                          │
│   eth0: 192.168.1.2/30                  │
│         fd00:fe11:deed:1337::2/126      │
│                                          │
│   Services listen on:                    │
│   - PostgreSQL: 5432                     │
│   - Redis: 6379                          │
│   - App: 3000                            │
└────────────────┬────────────────────────┘
                 │ TAP device
                 ▼
┌─────────────────────────────────────────┐
│            Network Namespace             │
│                                          │
│   TAP: 192.168.1.1/30                   │
│   WireGuard: for external access         │
│   NAT: for outbound traffic              │
└────────────────┬────────────────────────┘
                 │ veth pair
                 ▼
┌─────────────────────────────────────────┐
│           Default Namespace              │
│                                          │
│   SSH port forwarding: host:XXXX → VM:22 │
└─────────────────────────────────────────┘
```

### Accessing Services

From the host, access VM services via SSH port forwarding:
```bash
# Get SSH details
curl /api/vm/{id}/ssh_key
# → {"ssh_private_key": "...", "ssh_port": 12345}

# SSH tunnel for PostgreSQL
ssh -i key -p 12345 -L 5432:localhost:5432 root@localhost

# Or via WireGuard (production)
psql -h fd00:fe11:deed:1337::2 -p 5432
```

## Plugin File Structure

```
vers-integration-plugin/
├── .claude-plugin/
│   └── plugin.json              # Plugin manifest
├── .mcp.json                     # MCP server config
├── commands/
│   ├── vers-integration-init.md
│   ├── vers-integration-up.md
│   ├── vers-integration-test.md
│   └── vers-integration-deploy.md
├── skills/
│   ├── vers-integration-testing/
│   │   ├── SKILL.md             # Core knowledge
│   │   ├── SERVICE-CATALOG.md   # Available services
│   │   ├── COMPOSITION-PATTERNS.md
│   │   ├── TESTING-STRATEGIES.md
│   │   ├── DEPLOYMENT-GUIDE.md
│   │   └── TROUBLESHOOTING.md
│   ├── vers-parallel-web-testing/
│   │   └── SKILL.md
│   └── vers-database-testing/
│       └── SKILL.md
├── hooks/
│   └── hooks.json
├── scripts/
│   ├── mcp-server.ts            # MCP server implementation
│   └── lib/
│       ├── chelsea-client.ts    # Chelsea API client
│       ├── vm-executor.ts       # SSH execution in VM
│       └── service-manager.ts   # Service orchestration
└── ARCHITECTURE.md              # This document
```

## Key Differences from Docker-Based Testing

| Aspect | Docker Compose | Vers Integration |
|--------|---------------|------------------|
| Isolation | Container per service | All services in one VM |
| State capture | Volumes only | Memory + disk + processes |
| Branch time | Rebuild containers | Instant (copy-on-write) |
| Network | Docker network | TAP + WireGuard |
| Memory state | Lost on restart | Preserved in commit |
| Restore | Start from image | Exact runtime state |

## Performance Characteristics

- **Branch creation**: ~100ms (copy-on-write metadata only)
- **Commit**: ~1-5s (memory snapshot + volume snapshot)
- **Restore**: ~1-3s (memory restore + volume restore)
- **Full rebuild**: Never needed (branch instead)

## Security Model

- Each VM isolated via Firecracker (hardware virtualization)
- Network isolated via namespaces
- External access via WireGuard (authenticated)
- SSH keys per VM (auto-generated)

## Future Capabilities

The architecture supports:

1. **Multi-VM Clusters**: Multiple VMs for distributed system testing
2. **Hosted Deployment**: Push commits to vers.sh infrastructure
3. **Commit Registry**: Share commits across teams/projects
4. **Time-Travel Debugging**: Restore any historical commit
5. **Live Migration**: Move running VMs between hosts
