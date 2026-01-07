/**
 * Vers Integration Testing MCP Server
 *
 * Provides Claude Code with full integration testing capabilities:
 * - VM branching and checkpointing
 * - Service orchestration
 * - Parallel test execution
 * - Deployment to vers.sh hosted
 * - Integration registry publishing/importing
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { exec } from "child_process";
import { promisify } from "util";
import * as fs from "fs/promises";
import * as path from "path";
import * as yaml from "yaml";

const execAsync = promisify(exec);

// ============================================================================
// TYPES
// ============================================================================

interface ServiceConfig {
  template: string;
  config?: Record<string, any>;
  depends_on?: string[];
  healthcheck?: {
    command: string;
    interval?: string;
    timeout?: string;
    retries?: number;
  };
  resources?: {
    memory?: string;
    cpu?: number;
    storage?: string;
  };
}

interface IntegrationManifest {
  name: string;
  version: string;
  description?: string;
  vm: {
    memory_mib: number;
    vcpu: number;
    storage_mib: number;
  };
  services: Record<string, ServiceConfig>;
  tests?: Record<string, TestSuite>;
  checkpoints?: Checkpoint[];
  matrix?: Record<string, string[]>;
  deploy?: Record<string, DeployConfig>;
}

interface TestSuite {
  command: string;
  parallel?: boolean;
  depends_on?: string[];
  branches?: TestBranch[];
  env?: Record<string, string>;
}

interface TestBranch {
  name: string;
  env?: Record<string, string>;
  before?: string;
  after?: string;
}

interface Checkpoint {
  name: string;
  after: string;
  description?: string;
}

interface DeployConfig {
  target: string;
  domain?: string;
  resources?: {
    memory?: string;
    vcpu?: number;
  };
  scaling?: {
    min?: number;
    max?: number;
    target_cpu?: number;
  };
  auto_deploy?: {
    branch: string;
    on: string;
  };
}

interface BranchInfo {
  id: string;
  alias: string;
  parent?: string;
  created_at: string;
  status: "running" | "paused" | "stopped";
}

interface ServiceStatus {
  name: string;
  status: "running" | "stopped" | "unhealthy" | "starting";
  health?: "healthy" | "unhealthy" | "unknown";
  ports?: number[];
  uptime?: string;
}

interface TestResult {
  suite: string;
  branch: string;
  status: "passed" | "failed" | "skipped" | "error";
  duration_ms: number;
  output?: string;
  error?: string;
}

interface DeploymentInfo {
  id: string;
  environment: string;
  branch: string;
  status: "deploying" | "running" | "failed" | "stopped";
  url?: string;
  created_at: string;
  version?: string;
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

async function readManifest(): Promise<IntegrationManifest | null> {
  try {
    const content = await fs.readFile("vers-integration.yaml", "utf-8");
    return yaml.parse(content) as IntegrationManifest;
  } catch {
    return null;
  }
}

async function writeManifest(manifest: IntegrationManifest): Promise<void> {
  await fs.writeFile("vers-integration.yaml", yaml.stringify(manifest));
}

async function execVers(command: string): Promise<{ stdout: string; stderr: string }> {
  try {
    return await execAsync(`vers ${command}`);
  } catch (error: any) {
    return { stdout: "", stderr: error.message };
  }
}

function formatOutput(data: any): string {
  if (typeof data === "string") return data;
  return JSON.stringify(data, null, 2);
}

// ============================================================================
// SERVICE TEMPLATES
// ============================================================================

const SERVICE_TEMPLATES: Record<string, Partial<ServiceConfig>> = {
  "postgres": {
    healthcheck: {
      command: "pg_isready -U postgres",
      interval: "5s",
      timeout: "5s",
      retries: 5
    },
    resources: { memory: "512mb", storage: "2gb" }
  },
  "redis": {
    healthcheck: {
      command: "redis-cli ping",
      interval: "5s",
      timeout: "3s",
      retries: 3
    },
    resources: { memory: "256mb" }
  },
  "mongodb": {
    healthcheck: {
      command: "mongosh --eval 'db.runCommand({ ping: 1 })'",
      interval: "10s",
      timeout: "5s",
      retries: 5
    },
    resources: { memory: "512mb", storage: "2gb" }
  },
  "kafka": {
    depends_on: ["zookeeper"],
    healthcheck: {
      command: "kafka-broker-api-versions --bootstrap-server localhost:9092",
      interval: "10s",
      timeout: "10s",
      retries: 10
    },
    resources: { memory: "1gb" }
  },
  "elasticsearch": {
    healthcheck: {
      command: "curl -s localhost:9200/_cluster/health",
      interval: "10s",
      timeout: "10s",
      retries: 10
    },
    resources: { memory: "1gb", storage: "5gb" }
  },
  "rabbitmq": {
    healthcheck: {
      command: "rabbitmq-diagnostics check_running",
      interval: "10s",
      timeout: "10s",
      retries: 5
    },
    resources: { memory: "512mb" }
  },
  "stripe-mock": {
    healthcheck: {
      command: "curl -s localhost:12111/v1/charges",
      interval: "5s",
      timeout: "5s",
      retries: 3
    },
    resources: { memory: "128mb" }
  },
  "localstack": {
    healthcheck: {
      command: "curl -s localhost:4566/_localstack/health",
      interval: "10s",
      timeout: "10s",
      retries: 10
    },
    resources: { memory: "2gb" }
  },
  "mailhog": {
    healthcheck: {
      command: "curl -s localhost:8025/api/v2/messages",
      interval: "5s",
      timeout: "5s",
      retries: 3
    },
    resources: { memory: "64mb" }
  }
};

// ============================================================================
// MCP SERVER SETUP
// ============================================================================

const server = new McpServer({
  name: "vers-integration",
  version: "1.0.0"
});

// ============================================================================
// BRANCH OPERATIONS
// ============================================================================

server.registerTool("vers_status", {
  description: "Get current Vers status including active branch, services, and health",
  inputSchema: z.object({
    verbose: z.boolean().optional().describe("Include detailed service information")
  })
}, async ({ verbose }) => {
  const { stdout, stderr } = await execVers("status --json");
  if (stderr) {
    return { content: [{ type: "text", text: `Error: ${stderr}` }] };
  }

  let result = stdout;
  if (verbose) {
    const manifest = await readManifest();
    if (manifest) {
      const status = JSON.parse(stdout);
      status.manifest = {
        name: manifest.name,
        services: Object.keys(manifest.services),
        checkpoints: manifest.checkpoints?.map(c => c.name)
      };
      result = JSON.stringify(status, null, 2);
    }
  }

  return { content: [{ type: "text", text: result }] };
});

server.registerTool("vers_branch_list", {
  description: "List all VM branches in the current integration project",
  inputSchema: z.object({
    format: z.enum(["json", "table", "names"]).optional()
  })
}, async ({ format }) => {
  const fmt = format || "json";
  const { stdout, stderr } = await execVers(`branch list --format ${fmt}`);
  return { content: [{ type: "text", text: stderr || stdout }] };
});

server.registerTool("vers_branch_create", {
  description: "Create a new VM branch capturing current filesystem, memory, and process state",
  inputSchema: z.object({
    alias: z.string().describe("Human-readable name for the branch"),
    from: z.string().optional().describe("Branch or checkpoint to fork from (defaults to HEAD)")
  })
}, async ({ alias, from }) => {
  const cmd = from
    ? `branch --alias ${alias} --from ${from}`
    : `branch --alias ${alias}`;
  const { stdout, stderr } = await execVers(cmd);

  if (stderr && !stderr.includes("created")) {
    return { content: [{ type: "text", text: `Error: ${stderr}` }] };
  }

  return { content: [{ type: "text", text: stdout || `Branch '${alias}' created successfully` }] };
});

server.registerTool("vers_branch_checkout", {
  description: "Switch to a different VM branch (pauses current, resumes target)",
  inputSchema: z.object({
    branch: z.string().describe("Branch alias or ID to checkout")
  })
}, async ({ branch }) => {
  const { stdout, stderr } = await execVers(`checkout ${branch}`);
  return { content: [{ type: "text", text: stderr || stdout }] };
});

server.registerTool("vers_branch_delete", {
  description: "Delete a VM branch",
  inputSchema: z.object({
    branch: z.string().describe("Branch alias or ID to delete"),
    force: z.boolean().optional().describe("Force delete even if branch has uncommitted changes")
  })
}, async ({ branch, force }) => {
  const cmd = force ? `branch delete ${branch} --force` : `branch delete ${branch}`;
  const { stdout, stderr } = await execVers(cmd);
  return { content: [{ type: "text", text: stderr || stdout }] };
});

server.registerTool("vers_commit", {
  description: "Create a checkpoint capturing current state",
  inputSchema: z.object({
    tag: z.string().describe("Tag/name for this checkpoint"),
    message: z.string().optional().describe("Description of what state this captures")
  })
}, async ({ tag, message }) => {
  const msgArg = message ? `--message "${message}"` : "";
  const { stdout, stderr } = await execVers(`commit --tag "${tag}" ${msgArg}`);
  return { content: [{ type: "text", text: stderr || stdout }] };
});

server.registerTool("vers_rollback", {
  description: "Rollback to a previous branch or checkpoint state",
  inputSchema: z.object({
    target: z.string().describe("Branch, checkpoint, or commit ID to rollback to")
  })
}, async ({ target }) => {
  const { stdout, stderr } = await execVers(`rollback ${target}`);
  return { content: [{ type: "text", text: stderr || stdout }] };
});

server.registerTool("vers_diff", {
  description: "Show differences between current state and another branch/checkpoint",
  inputSchema: z.object({
    target: z.string().describe("Branch or checkpoint to compare against"),
    aspects: z.array(z.enum(["files", "database", "processes", "config"])).optional()
  })
}, async ({ target, aspects }) => {
  const aspectArg = aspects?.length ? `--aspects ${aspects.join(",")}` : "";
  const { stdout, stderr } = await execVers(`diff ${target} ${aspectArg}`);
  return { content: [{ type: "text", text: stderr || stdout }] };
});

// ============================================================================
// INTEGRATION PROJECT MANAGEMENT
// ============================================================================

server.registerTool("integration_init", {
  description: "Initialize a new Vers integration testing project",
  inputSchema: z.object({
    name: z.string().describe("Project name"),
    template: z.enum(["blank", "saas-starter", "microservices", "data-pipeline", "ecommerce"]).optional()
  })
}, async ({ name, template }) => {
  const templateName = template || "blank";

  // Check if already initialized
  const existing = await readManifest();
  if (existing) {
    return { content: [{ type: "text", text: `Project already initialized: ${existing.name}` }] };
  }

  // Create base manifest
  const manifest: IntegrationManifest = {
    name,
    version: "1.0.0",
    description: `Integration testing project: ${name}`,
    vm: {
      memory_mib: 2048,
      vcpu: 2,
      storage_mib: 8000
    },
    services: {},
    tests: {},
    checkpoints: [],
    deploy: {
      staging: {
        target: "vers.sh/hosted",
        domain: `${name}-staging.vers.sh`
      },
      production: {
        target: "vers.sh/hosted",
        domain: `${name}.vers.sh`
      }
    }
  };

  // Apply template
  if (templateName === "saas-starter") {
    manifest.services = {
      postgres: {
        template: "postgres@15",
        config: { databases: ["app", "analytics"], extensions: ["uuid-ossp", "pg_trgm"] }
      },
      redis: {
        template: "redis@7",
        config: { maxmemory: "256mb" }
      },
      stripe: {
        template: "stripe-mock",
        config: { webhook_endpoint: "http://app:3000/webhooks/stripe" }
      },
      oauth: {
        template: "oauth-mock",
        config: { providers: ["google", "github"] }
      },
      smtp: {
        template: "mailhog"
      }
    };
    manifest.tests = {
      unit: { command: "npm run test:unit", parallel: true },
      integration: { command: "npm run test:integration", depends_on: ["postgres", "redis"] },
      e2e: { command: "npm run test:e2e", depends_on: ["postgres", "redis", "stripe"] }
    };
  } else if (templateName === "microservices") {
    manifest.vm.memory_mib = 4096;
    manifest.services = {
      kafka: {
        template: "kafka@3",
        config: { topics: [{ name: "events", partitions: 3 }, { name: "notifications", partitions: 1 }] }
      },
      postgres: {
        template: "postgres@15",
        config: { databases: ["users", "orders"] }
      },
      mongodb: {
        template: "mongodb@7",
        config: { databases: ["analytics"] }
      },
      redis: {
        template: "redis@7"
      }
    };
  } else if (templateName === "data-pipeline") {
    manifest.vm.memory_mib = 4096;
    manifest.services = {
      "postgres-source": {
        template: "postgres@15",
        config: { databases: ["source_db"] }
      },
      "postgres-warehouse": {
        template: "postgres@15",
        config: { databases: ["warehouse"], extensions: ["pg_trgm", "btree_gin"] }
      },
      elasticsearch: {
        template: "elasticsearch@8"
      },
      redis: {
        template: "redis@7",
        config: { maxmemory: "1gb" }
      }
    };
  } else if (templateName === "ecommerce") {
    manifest.services = {
      postgres: {
        template: "postgres@15",
        config: { databases: ["ecommerce", "inventory", "analytics"], extensions: ["uuid-ossp"] }
      },
      redis: {
        template: "redis@7",
        config: { maxmemory: "512mb" }
      },
      elasticsearch: {
        template: "elasticsearch@8",
        config: { indices: ["products", "orders"] }
      },
      stripe: {
        template: "stripe-mock"
      },
      s3: {
        template: "localstack",
        config: { services: ["s3"], buckets: ["uploads", "assets"] }
      }
    };
  }

  await writeManifest(manifest);

  // Create directory structure
  await fs.mkdir("tests", { recursive: true });
  await fs.mkdir("scripts", { recursive: true });

  // Create basic vers.toml
  const versToml = `[vm]
memory_mib = ${manifest.vm.memory_mib}
vcpu = ${manifest.vm.vcpu}

[storage]
cluster_mib = ${manifest.vm.storage_mib}
vm_mib = ${Math.floor(manifest.vm.storage_mib / 2)}
`;
  await fs.writeFile("vers.toml", versToml);

  return { content: [{ type: "text", text: formatOutput({
    status: "initialized",
    project: name,
    template: templateName,
    services: Object.keys(manifest.services),
    next_steps: [
      "Run 'vers build' to build the VM image",
      "Run '/vers-integration-up' to start services",
      "Run '/vers-integration-test' to run tests"
    ]
  }) }] };
});

server.registerTool("integration_add_service", {
  description: "Add a service to the integration stack",
  inputSchema: z.object({
    service: z.string().describe("Service template (e.g., postgres@15, redis@7, kafka@3)"),
    alias: z.string().optional().describe("Custom alias for the service"),
    config: z.record(z.any()).optional().describe("Service configuration options")
  })
}, async ({ service, alias, config }) => {
  const manifest = await readManifest();
  if (!manifest) {
    return { content: [{ type: "text", text: "Error: No vers-integration.yaml found. Run /vers-integration-init first." }] };
  }

  // Parse service@version
  const [serviceName, version] = service.split("@");
  const serviceAlias = alias || serviceName;

  // Get template defaults
  const templateDefaults = SERVICE_TEMPLATES[serviceName] || {};

  // Merge configuration
  const serviceConfig: ServiceConfig = {
    template: service,
    config: { ...config },
    ...templateDefaults
  };

  manifest.services[serviceAlias] = serviceConfig;
  await writeManifest(manifest);

  return { content: [{ type: "text", text: formatOutput({
    status: "added",
    service: serviceAlias,
    template: service,
    config: serviceConfig,
    total_services: Object.keys(manifest.services).length
  }) }] };
});

server.registerTool("integration_remove_service", {
  description: "Remove a service from the integration stack",
  inputSchema: z.object({
    service: z.string().describe("Service alias to remove")
  })
}, async ({ service }) => {
  const manifest = await readManifest();
  if (!manifest) {
    return { content: [{ type: "text", text: "Error: No vers-integration.yaml found." }] };
  }

  if (!manifest.services[service]) {
    return { content: [{ type: "text", text: `Error: Service '${service}' not found.` }] };
  }

  delete manifest.services[service];
  await writeManifest(manifest);

  return { content: [{ type: "text", text: `Service '${service}' removed.` }] };
});

server.registerTool("integration_up", {
  description: "Start all services in the integration stack",
  inputSchema: z.object({
    services: z.array(z.string()).optional().describe("Specific services to start (default: all)"),
    build: z.boolean().optional().describe("Rebuild VM image before starting"),
    checkpoint: z.string().optional().describe("Create checkpoint after services are healthy")
  })
}, async ({ services, build, checkpoint }) => {
  const manifest = await readManifest();
  if (!manifest) {
    return { content: [{ type: "text", text: "Error: No vers-integration.yaml found." }] };
  }

  const results: any[] = [];

  // Build if requested
  if (build) {
    const { stdout, stderr } = await execVers("build");
    results.push({ step: "build", output: stdout || stderr });
  }

  // Start services in dependency order
  const servicesToStart = services || Object.keys(manifest.services);
  const started: string[] = [];
  const failed: string[] = [];

  for (const svc of servicesToStart) {
    const svcConfig = manifest.services[svc];
    if (!svcConfig) {
      failed.push(svc);
      continue;
    }

    // Check dependencies
    const deps = svcConfig.depends_on || [];
    const unmetDeps = deps.filter(d => !started.includes(d));
    if (unmetDeps.length > 0) {
      // Start dependencies first
      for (const dep of unmetDeps) {
        const { stdout, stderr } = await execVers(`service start ${dep}`);
        if (!stderr || stderr.includes("started")) {
          started.push(dep);
        }
      }
    }

    const { stdout, stderr } = await execVers(`service start ${svc}`);
    if (!stderr || stderr.includes("started")) {
      started.push(svc);
    } else {
      failed.push(svc);
    }
  }

  // Wait for health checks
  for (const svc of started) {
    const { stdout } = await execVers(`service health ${svc} --wait`);
    results.push({ service: svc, health: stdout });
  }

  // Create checkpoint if requested
  if (checkpoint && failed.length === 0) {
    await execVers(`commit --tag "${checkpoint}"`);
    results.push({ checkpoint: checkpoint, status: "created" });
  }

  return { content: [{ type: "text", text: formatOutput({
    status: failed.length === 0 ? "success" : "partial",
    started,
    failed,
    details: results
  }) }] };
});

server.registerTool("integration_down", {
  description: "Stop all services in the integration stack",
  inputSchema: z.object({
    services: z.array(z.string()).optional().describe("Specific services to stop (default: all)")
  })
}, async ({ services }) => {
  const manifest = await readManifest();
  if (!manifest) {
    return { content: [{ type: "text", text: "Error: No vers-integration.yaml found." }] };
  }

  const servicesToStop = services || Object.keys(manifest.services);
  const results: any[] = [];

  for (const svc of servicesToStop.reverse()) { // Stop in reverse order
    const { stdout, stderr } = await execVers(`service stop ${svc}`);
    results.push({ service: svc, result: stdout || stderr });
  }

  return { content: [{ type: "text", text: formatOutput({ stopped: servicesToStop, details: results }) }] };
});

server.registerTool("integration_service_status", {
  description: "Get status of all services in the integration stack",
  inputSchema: z.object({})
}, async () => {
  const manifest = await readManifest();
  if (!manifest) {
    return { content: [{ type: "text", text: "Error: No vers-integration.yaml found." }] };
  }

  const statuses: ServiceStatus[] = [];

  for (const [name, config] of Object.entries(manifest.services)) {
    const { stdout } = await execVers(`service status ${name} --json`);
    try {
      const status = JSON.parse(stdout);
      statuses.push({ name, ...status });
    } catch {
      statuses.push({ name, status: "unknown", health: "unknown" });
    }
  }

  return { content: [{ type: "text", text: formatOutput(statuses) }] };
});

server.registerTool("integration_logs", {
  description: "Get logs from a service",
  inputSchema: z.object({
    service: z.string().describe("Service name"),
    lines: z.number().optional().describe("Number of lines to fetch"),
    since: z.string().optional().describe("Show logs since timestamp (e.g., '5m', '1h')")
  })
}, async ({ service, lines, since }) => {
  const args = [];
  if (lines) args.push(`--lines ${lines}`);
  if (since) args.push(`--since ${since}`);

  const { stdout, stderr } = await execVers(`logs ${service} ${args.join(" ")}`);
  return { content: [{ type: "text", text: stderr || stdout }] };
});

// ============================================================================
// TESTING OPERATIONS
// ============================================================================

server.registerTool("integration_test", {
  description: "Run integration tests",
  inputSchema: z.object({
    suite: z.string().optional().describe("Test suite to run (default: all)"),
    parallel: z.boolean().optional().describe("Run test branches in parallel"),
    branch_prefix: z.string().optional().describe("Prefix for test branches")
  })
}, async ({ suite, parallel, branch_prefix }) => {
  const manifest = await readManifest();
  if (!manifest || !manifest.tests) {
    return { content: [{ type: "text", text: "Error: No tests defined in vers-integration.yaml" }] };
  }

  const suitesToRun = suite ? { [suite]: manifest.tests[suite] } : manifest.tests;
  const prefix = branch_prefix || "test";
  const results: TestResult[] = [];

  // Create checkpoint before tests
  await execVers(`commit --tag "${prefix}-baseline-${Date.now()}"`);

  const runTest = async (suiteName: string, suiteConfig: TestSuite): Promise<TestResult[]> => {
    const suiteResults: TestResult[] = [];

    if (suiteConfig.branches && suiteConfig.branches.length > 0) {
      // Run each branch scenario
      for (const branch of suiteConfig.branches) {
        const branchAlias = `${prefix}-${suiteName}-${branch.name}`;

        // Create branch
        await execVers(`branch --alias ${branchAlias}`);
        await execVers(`checkout ${branchAlias}`);

        // Run before script if exists
        if (branch.before) {
          await execAsync(branch.before);
        }

        // Set environment and run test
        const env = { ...suiteConfig.env, ...branch.env };
        const envStr = Object.entries(env).map(([k, v]) => `${k}=${v}`).join(" ");

        const startTime = Date.now();
        try {
          const { stdout, stderr } = await execAsync(`${envStr} ${suiteConfig.command}`);
          suiteResults.push({
            suite: suiteName,
            branch: branch.name,
            status: "passed",
            duration_ms: Date.now() - startTime,
            output: stdout
          });
        } catch (error: any) {
          suiteResults.push({
            suite: suiteName,
            branch: branch.name,
            status: "failed",
            duration_ms: Date.now() - startTime,
            error: error.message
          });
        }

        // Run after script if exists
        if (branch.after) {
          await execAsync(branch.after);
        }
      }
    } else {
      // Single test run
      const branchAlias = `${prefix}-${suiteName}`;
      await execVers(`branch --alias ${branchAlias}`);
      await execVers(`checkout ${branchAlias}`);

      const startTime = Date.now();
      try {
        const { stdout } = await execAsync(suiteConfig.command);
        suiteResults.push({
          suite: suiteName,
          branch: branchAlias,
          status: "passed",
          duration_ms: Date.now() - startTime,
          output: stdout
        });
      } catch (error: any) {
        suiteResults.push({
          suite: suiteName,
          branch: branchAlias,
          status: "failed",
          duration_ms: Date.now() - startTime,
          error: error.message
        });
      }
    }

    return suiteResults;
  };

  if (parallel) {
    const promises = Object.entries(suitesToRun).map(([name, config]) => runTest(name, config));
    const allResults = await Promise.all(promises);
    results.push(...allResults.flat());
  } else {
    for (const [name, config] of Object.entries(suitesToRun)) {
      const suiteResults = await runTest(name, config);
      results.push(...suiteResults);
    }
  }

  // Summary
  const passed = results.filter(r => r.status === "passed").length;
  const failed = results.filter(r => r.status === "failed").length;

  return { content: [{ type: "text", text: formatOutput({
    summary: { total: results.length, passed, failed },
    results
  }) }] };
});

server.registerTool("integration_matrix", {
  description: "Run matrix test across service version combinations",
  inputSchema: z.object({
    filter: z.record(z.string()).optional().describe("Filter to specific versions"),
    parallel: z.boolean().optional().describe("Run combinations in parallel"),
    continue_on_failure: z.boolean().optional().describe("Continue even if some combinations fail")
  })
}, async ({ filter, parallel, continue_on_failure }) => {
  const manifest = await readManifest();
  if (!manifest || !manifest.matrix) {
    return { content: [{ type: "text", text: "Error: No matrix defined in vers-integration.yaml" }] };
  }

  // Generate all combinations
  const matrix = manifest.matrix;
  const keys = Object.keys(matrix);
  const combinations: Record<string, string>[] = [];

  const generate = (index: number, current: Record<string, string>) => {
    if (index === keys.length) {
      combinations.push({ ...current });
      return;
    }

    const key = keys[index];
    const versions = matrix[key];

    for (const version of versions) {
      if (filter && filter[key] && filter[key] !== version) continue;
      current[key] = version;
      generate(index + 1, current);
    }
  };

  generate(0, {});

  const results: any[] = [];

  const runCombination = async (combo: Record<string, string>) => {
    const name = Object.entries(combo).map(([k, v]) => `${k}${v}`).join("-");

    // Create branch
    await execVers(`branch --alias matrix-${name}`);
    await execVers(`checkout matrix-${name}`);

    // Update service versions
    for (const [service, version] of Object.entries(combo)) {
      // Update vers-integration.yaml service version
      const svcConfig = manifest.services[service];
      if (svcConfig) {
        const [svcName] = svcConfig.template.split("@");
        svcConfig.template = `${svcName}@${version}`;
      }
    }

    // Restart services
    await execVers("service restart --all");

    // Run tests
    const { stdout, stderr } = await execAsync("npm test");

    return {
      combination: combo,
      branch: `matrix-${name}`,
      status: stderr ? "failed" : "passed",
      output: stdout || stderr
    };
  };

  if (parallel) {
    const promises = combinations.map(runCombination);
    const allResults = await Promise.all(promises);
    results.push(...allResults);
  } else {
    for (const combo of combinations) {
      try {
        const result = await runCombination(combo);
        results.push(result);
        if (result.status === "failed" && !continue_on_failure) break;
      } catch (error: any) {
        results.push({ combination: combo, status: "error", error: error.message });
        if (!continue_on_failure) break;
      }
    }
  }

  const passed = results.filter(r => r.status === "passed").length;
  const failed = results.filter(r => r.status === "failed").length;

  return { content: [{ type: "text", text: formatOutput({
    matrix: matrix,
    total_combinations: combinations.length,
    summary: { passed, failed },
    results
  }) }] };
});

server.registerTool("integration_compare_branches", {
  description: "Compare state between two test branches",
  inputSchema: z.object({
    branch1: z.string(),
    branch2: z.string(),
    aspects: z.array(z.enum(["database", "files", "processes", "logs"])).optional()
  })
}, async ({ branch1, branch2, aspects }) => {
  const compareAspects = aspects || ["database", "files"];
  const comparison: Record<string, any> = {};

  for (const aspect of compareAspects) {
    // Get state from branch1
    await execVers(`checkout ${branch1}`);
    let state1: string;

    if (aspect === "database") {
      const { stdout } = await execAsync("psql -c 'SELECT table_name, n_live_tup FROM pg_stat_user_tables ORDER BY table_name;'");
      state1 = stdout;
    } else if (aspect === "files") {
      const { stdout } = await execAsync("find /app -type f -newer /tmp/baseline 2>/dev/null | head -50");
      state1 = stdout;
    } else if (aspect === "processes") {
      const { stdout } = await execAsync("ps aux");
      state1 = stdout;
    } else {
      const { stdout } = await execAsync("tail -100 /var/log/app.log 2>/dev/null || echo 'No logs'");
      state1 = stdout;
    }

    // Get state from branch2
    await execVers(`checkout ${branch2}`);
    let state2: string;

    if (aspect === "database") {
      const { stdout } = await execAsync("psql -c 'SELECT table_name, n_live_tup FROM pg_stat_user_tables ORDER BY table_name;'");
      state2 = stdout;
    } else if (aspect === "files") {
      const { stdout } = await execAsync("find /app -type f -newer /tmp/baseline 2>/dev/null | head -50");
      state2 = stdout;
    } else if (aspect === "processes") {
      const { stdout } = await execAsync("ps aux");
      state2 = stdout;
    } else {
      const { stdout } = await execAsync("tail -100 /var/log/app.log 2>/dev/null || echo 'No logs'");
      state2 = stdout;
    }

    comparison[aspect] = {
      [branch1]: state1,
      [branch2]: state2,
      different: state1 !== state2
    };
  }

  return { content: [{ type: "text", text: formatOutput(comparison) }] };
});

// ============================================================================
// DEPLOYMENT OPERATIONS
// ============================================================================

server.registerTool("integration_deploy", {
  description: "Deploy integration stack to Vers.sh hosted environment",
  inputSchema: z.object({
    environment: z.enum(["staging", "production", "preview"]).describe("Target environment"),
    branch: z.string().optional().describe("Branch to deploy (default: current)"),
    domain: z.string().optional().describe("Custom domain"),
    wait: z.boolean().optional().describe("Wait for deployment to complete")
  })
}, async ({ environment, branch, domain, wait }) => {
  const manifest = await readManifest();
  if (!manifest) {
    return { content: [{ type: "text", text: "Error: No vers-integration.yaml found." }] };
  }

  const deployConfig = manifest.deploy?.[environment];
  if (!deployConfig) {
    return { content: [{ type: "text", text: `Error: No deploy configuration for '${environment}'.` }] };
  }

  // Checkout branch if specified
  if (branch) {
    await execVers(`checkout ${branch}`);
  }

  // Build deployment command
  const args = [`--environment ${environment}`];
  if (domain) args.push(`--domain ${domain}`);
  if (wait !== false) args.push("--wait");

  const { stdout, stderr } = await execVers(`integration deploy ${args.join(" ")}`);

  if (stderr && !stderr.includes("deployed")) {
    return { content: [{ type: "text", text: `Deployment failed: ${stderr}` }] };
  }

  // Parse deployment result
  try {
    const result = JSON.parse(stdout);
    return { content: [{ type: "text", text: formatOutput({
      status: "deployed",
      environment,
      url: result.url || domain || deployConfig.domain,
      deployment_id: result.id,
      branch: branch || "HEAD"
    }) }] };
  } catch {
    return { content: [{ type: "text", text: stdout }] };
  }
});

server.registerTool("integration_rollback", {
  description: "Rollback a deployment to previous version",
  inputSchema: z.object({
    environment: z.enum(["staging", "production"]),
    to: z.string().optional().describe("Version or checkpoint to rollback to")
  })
}, async ({ environment, to }) => {
  const args = [`--environment ${environment}`];
  if (to) args.push(`--to ${to}`);

  const { stdout, stderr } = await execVers(`integration rollback ${args.join(" ")}`);
  return { content: [{ type: "text", text: stderr || stdout }] };
});

server.registerTool("integration_deployments_list", {
  description: "List all deployments and their status",
  inputSchema: z.object({
    environment: z.enum(["staging", "production", "preview", "all"]).optional()
  })
}, async ({ environment }) => {
  const envArg = environment && environment !== "all" ? `--environment ${environment}` : "";
  const { stdout, stderr } = await execVers(`integration deployments ${envArg}`);
  return { content: [{ type: "text", text: stderr || stdout }] };
});

server.registerTool("integration_preview_create", {
  description: "Create a preview environment (e.g., for PR review)",
  inputSchema: z.object({
    name: z.string().describe("Preview environment name (e.g., pr-123)"),
    branch: z.string().optional().describe("Branch to deploy"),
    ttl: z.string().optional().describe("Time-to-live (e.g., '7d', '24h')")
  })
}, async ({ name, branch, ttl }) => {
  const args = [`--name ${name}`];
  if (branch) args.push(`--branch ${branch}`);
  if (ttl) args.push(`--ttl ${ttl}`);

  const { stdout, stderr } = await execVers(`integration preview create ${args.join(" ")}`);

  return { content: [{ type: "text", text: formatOutput({
    status: "created",
    name,
    url: `https://${name}.preview.vers.sh`,
    ttl: ttl || "7d",
    output: stdout || stderr
  }) }] };
});

server.registerTool("integration_preview_delete", {
  description: "Delete a preview environment",
  inputSchema: z.object({
    name: z.string().describe("Preview environment name to delete")
  })
}, async ({ name }) => {
  const { stdout, stderr } = await execVers(`integration preview delete ${name}`);
  return { content: [{ type: "text", text: stderr || stdout }] };
});

// ============================================================================
// REGISTRY OPERATIONS
// ============================================================================

server.registerTool("integration_publish", {
  description: "Publish integration stack to Vers.sh registry",
  inputSchema: z.object({
    name: z.string().describe("Name for published integration"),
    visibility: z.enum(["public", "private", "team"]).optional(),
    description: z.string().optional(),
    tags: z.array(z.string()).optional()
  })
}, async ({ name, visibility, description, tags }) => {
  const args = [name];
  if (visibility) args.push(`--visibility ${visibility}`);
  if (description) args.push(`--description "${description}"`);
  if (tags?.length) args.push(`--tags ${tags.join(",")}`);

  const { stdout, stderr } = await execVers(`integration publish ${args.join(" ")}`);

  return { content: [{ type: "text", text: formatOutput({
    status: "published",
    name,
    registry_url: `https://registry.vers.sh/${name}`,
    visibility: visibility || "private",
    output: stdout || stderr
  }) }] };
});

server.registerTool("integration_import", {
  description: "Import a shared integration from registry",
  inputSchema: z.object({
    source: z.string().describe("Integration reference (e.g., user/name, vers.sh/official/saas-starter)")
  })
}, async ({ source }) => {
  const { stdout, stderr } = await execVers(`integration import ${source}`);

  if (stderr && !stderr.includes("imported")) {
    return { content: [{ type: "text", text: `Import failed: ${stderr}` }] };
  }

  return { content: [{ type: "text", text: formatOutput({
    status: "imported",
    source,
    output: stdout
  }) }] };
});

server.registerTool("integration_search", {
  description: "Search the Vers.sh integration registry",
  inputSchema: z.object({
    query: z.string().describe("Search query"),
    tags: z.array(z.string()).optional().describe("Filter by tags"),
    limit: z.number().optional().describe("Max results to return")
  })
}, async ({ query, tags, limit }) => {
  const args = [`"${query}"`];
  if (tags?.length) args.push(`--tags ${tags.join(",")}`);
  if (limit) args.push(`--limit ${limit}`);

  const { stdout, stderr } = await execVers(`integration search ${args.join(" ")}`);
  return { content: [{ type: "text", text: stderr || stdout }] };
});

// ============================================================================
// UTILITY OPERATIONS
// ============================================================================

server.registerTool("vers_execute", {
  description: "Execute a command in the current Vers environment",
  inputSchema: z.object({
    command: z.string().describe("Command to execute"),
    service: z.string().optional().describe("Run in specific service context"),
    interactive: z.boolean().optional().describe("Run interactively (returns immediately)")
  })
}, async ({ command, service, interactive }) => {
  const args = [];
  if (service) args.push(`--service ${service}`);
  if (interactive) args.push("--detach");

  const { stdout, stderr } = await execVers(`execute ${args.join(" ")} "${command}"`);
  return { content: [{ type: "text", text: stderr || stdout }] };
});

server.registerTool("vers_connect", {
  description: "Get SSH connection command for the Vers VM",
  inputSchema: z.object({
    service: z.string().optional().describe("Connect to specific service container")
  })
}, async ({ service }) => {
  const args = service ? [`--service ${service}`] : [];
  const { stdout, stderr } = await execVers(`connect ${args.join(" ")} --print-command`);
  return { content: [{ type: "text", text: stderr || stdout }] };
});

server.registerTool("integration_export", {
  description: "Export the integration stack for external deployment",
  inputSchema: z.object({
    format: z.enum(["oci", "raw", "ami", "gce"]).describe("Export format"),
    output: z.string().optional().describe("Output path"),
    branch: z.string().optional().describe("Branch to export")
  })
}, async ({ format, output, branch }) => {
  const args = [`--format ${format}`];
  if (output) args.push(`--output ${output}`);
  if (branch) args.push(`--branch ${branch}`);

  const { stdout, stderr } = await execVers(`integration export ${args.join(" ")}`);
  return { content: [{ type: "text", text: stderr || stdout }] };
});

// ============================================================================
// DATABASE-SPECIFIC TOOLS
// ============================================================================

server.registerTool("db_query", {
  description: "Execute a SQL query in the database",
  inputSchema: z.object({
    query: z.string().describe("SQL query to execute"),
    database: z.string().optional().describe("Database name"),
    service: z.string().optional().describe("Database service (if multiple)")
  })
}, async ({ query, database, service }) => {
  const db = database || "postgres";
  const svc = service || "postgres";

  const escapedQuery = query.replace(/'/g, "\\'");
  const { stdout, stderr } = await execAsync(
    `vers execute --service ${svc} "psql -d ${db} -c '${escapedQuery}'"`
  );

  return { content: [{ type: "text", text: stderr || stdout }] };
});

server.registerTool("db_table_counts", {
  description: "Get row counts for all tables in the database",
  inputSchema: z.object({
    database: z.string().optional(),
    service: z.string().optional()
  })
}, async ({ database, service }) => {
  const db = database || "postgres";
  const svc = service || "postgres";

  const { stdout, stderr } = await execAsync(
    `vers execute --service ${svc} "psql -d ${db} -c 'SELECT table_name, n_live_tup as row_count FROM pg_stat_user_tables ORDER BY n_live_tup DESC;'"`
  );

  return { content: [{ type: "text", text: stderr || stdout }] };
});

server.registerTool("db_schema_dump", {
  description: "Dump database schema (no data)",
  inputSchema: z.object({
    database: z.string().optional(),
    service: z.string().optional(),
    output: z.string().optional().describe("Output file path")
  })
}, async ({ database, service, output }) => {
  const db = database || "postgres";
  const svc = service || "postgres";
  const outArg = output ? `> ${output}` : "";

  const { stdout, stderr } = await execAsync(
    `vers execute --service ${svc} "pg_dump -d ${db} --schema-only" ${outArg}`
  );

  return { content: [{ type: "text", text: stderr || stdout }] };
});

// ============================================================================
// WEB TESTING TOOLS
// ============================================================================

server.registerTool("web_test_setup", {
  description: "Set up environment for parallel web testing with Puppeteer/Playwright",
  inputSchema: z.object({
    framework: z.enum(["puppeteer", "playwright"]).optional()
  })
}, async ({ framework }) => {
  const fw = framework || "puppeteer";

  // Check if browser is installed
  const { stdout: browserCheck } = await execVers("execute 'which chromium || which google-chrome'");

  if (!browserCheck.trim()) {
    return { content: [{ type: "text", text: formatOutput({
      status: "setup_required",
      message: "Chromium not found. Add to Dockerfile or run: apt-get install chromium",
      framework: fw
    }) }] };
  }

  // Install framework if needed
  const { stdout: pkgCheck } = await execVers(`execute "npm list ${fw} 2>/dev/null || echo 'not installed'"`);

  if (pkgCheck.includes("not installed")) {
    await execVers(`execute "npm install ${fw}"`);
  }

  return { content: [{ type: "text", text: formatOutput({
    status: "ready",
    framework: fw,
    browser: browserCheck.trim(),
    next_steps: [
      "Create test files in tests/ directory",
      "Run /vers-integration-test --suite web"
    ]
  }) }] };
});

server.registerTool("web_test_branch", {
  description: "Create a branch at current browser state for parallel web testing",
  inputSchema: z.object({
    prefix: z.string().describe("Prefix for branch names"),
    scenarios: z.array(z.string()).describe("List of scenario names to create branches for")
  })
}, async ({ prefix, scenarios }) => {
  // Create checkpoint first
  await execVers(`commit --tag "${prefix}-baseline"`);

  const branches: string[] = [];
  for (const scenario of scenarios) {
    const branchName = `${prefix}-${scenario}`;
    await execVers(`branch --alias ${branchName}`);
    branches.push(branchName);
  }

  return { content: [{ type: "text", text: formatOutput({
    baseline: `${prefix}-baseline`,
    branches,
    usage: `Run tests: branches.forEach(b => vers checkout \${b} && vers execute "node test-\${scenario}.js")`
  }) }] };
});

// ============================================================================
// CHAOS TESTING TOOLS
// ============================================================================

server.registerTool("chaos_inject", {
  description: "Inject chaos/failure into a service for resilience testing",
  inputSchema: z.object({
    service: z.string().describe("Service to inject chaos into"),
    action: z.enum(["kill", "pause", "network-isolate", "cpu-stress", "memory-stress", "disk-fill"]),
    duration: z.string().optional().describe("Duration of chaos (e.g., '30s', '5m')"),
    intensity: z.number().optional().describe("Intensity 0-100 for stress tests")
  })
}, async ({ service, action, duration, intensity }) => {
  // Create checkpoint before chaos
  const checkpointName = `pre-chaos-${service}-${Date.now()}`;
  await execVers(`commit --tag "${checkpointName}"`);

  let chaosCommand: string;

  switch (action) {
    case "kill":
      chaosCommand = `service stop ${service} --force`;
      break;
    case "pause":
      chaosCommand = `service pause ${service}`;
      break;
    case "network-isolate":
      chaosCommand = `execute --service ${service} "iptables -A INPUT -j DROP && iptables -A OUTPUT -j DROP"`;
      break;
    case "cpu-stress":
      const cpuIntensity = intensity || 80;
      chaosCommand = `execute --service ${service} "stress-ng --cpu 2 --cpu-load ${cpuIntensity} --timeout ${duration || '30s'}"`;
      break;
    case "memory-stress":
      const memIntensity = intensity || 80;
      chaosCommand = `execute --service ${service} "stress-ng --vm 1 --vm-bytes ${memIntensity}% --timeout ${duration || '30s'}"`;
      break;
    case "disk-fill":
      const diskPercent = intensity || 95;
      chaosCommand = `execute --service ${service} "fallocate -l $(df / | awk 'NR==2 {print int($4*${diskPercent}/100)}')K /tmp/fill"`;
      break;
    default:
      return { content: [{ type: "text", text: `Unknown chaos action: ${action}` }] };
  }

  const { stdout, stderr } = await execVers(chaosCommand);

  return { content: [{ type: "text", text: formatOutput({
    status: "injected",
    service,
    action,
    duration: duration || "permanent",
    rollback_checkpoint: checkpointName,
    output: stdout || stderr
  }) }] };
});

server.registerTool("chaos_recover", {
  description: "Recover from chaos injection",
  inputSchema: z.object({
    checkpoint: z.string().optional().describe("Checkpoint to rollback to"),
    service: z.string().optional().describe("Service to restart")
  })
}, async ({ checkpoint, service }) => {
  if (checkpoint) {
    const { stdout, stderr } = await execVers(`rollback ${checkpoint}`);
    return { content: [{ type: "text", text: formatOutput({ action: "rollback", checkpoint, output: stdout || stderr }) }] };
  }

  if (service) {
    const { stdout, stderr } = await execVers(`service restart ${service}`);
    return { content: [{ type: "text", text: formatOutput({ action: "restart", service, output: stdout || stderr }) }] };
  }

  return { content: [{ type: "text", text: "Error: Specify checkpoint or service to recover" }] };
});

// ============================================================================
// START SERVER
// ============================================================================

const transport = new StdioServerTransport();
await server.connect(transport);

console.error("Vers Integration Testing MCP Server started");
