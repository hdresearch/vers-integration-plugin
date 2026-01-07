# Use Case Report: Parallel Web Testing Plugin

## Overview

This document details the Claude Code plugin/skill design for **parallel web/UI testing** using Vers VM branching, based on the [Parallel Web Testing Tutorial](https://docs.vers.sh/tutorials/parallel-web-testing).

---

## Problem Statement

### Traditional Web Testing Pain Points

1. **Expensive Setup:** Browser automation requires launching browser, navigating pages, filling forms, authenticating—often 5-15 minutes per test run
2. **Serial Execution:** Each test scenario requires repeating setup from scratch
3. **State Inconsistency:** Tests may see different application states due to timing
4. **Resource Intensive:** Running N tests requires N browser instances sequentially

### Example: E-Commerce Checkout Testing

Testing payment flows for an e-commerce site:
- 5 payment methods (credit card, PayPal, Apple Pay, bank transfer, crypto)
- 3 shipping options (standard, express, pickup)
- 2 user types (guest, registered)

**Traditional approach:** 30 test combinations × 10 min setup each = **5 hours**

---

## Vers Solution

### Branch-at-Decision-Point Pattern

```
┌─────────────────────────────────────────────────────────────┐
│                    SETUP PHASE (once)                        │
│  1. Launch browser                                           │
│  2. Navigate to store                                        │
│  3. Add items to cart                                        │
│  4. Fill shipping info                                       │
│  5. Reach payment selection screen                           │
│                                                              │
│  ═══════════════ COMMIT CHECKPOINT ═══════════════          │
│                  "checkout-ready"                            │
└─────────────────────────┬───────────────────────────────────┘
                          │
        ┌─────────────────┼─────────────────┐
        ▼                 ▼                 ▼
   ┌─────────┐      ┌─────────┐      ┌─────────┐
   │ Branch  │      │ Branch  │      │ Branch  │
   │credit-  │      │ paypal  │      │apple-pay│
   │  card   │      │         │      │         │
   └────┬────┘      └────┬────┘      └────┬────┘
        │                │                │
        ▼                ▼                ▼
   Test credit      Test PayPal     Test Apple Pay
   card flow        flow            flow
        │                │                │
        ▼                ▼                ▼
   ┌─────────────────────────────────────────┐
   │         AGGREGATE RESULTS               │
   │   3/3 passed in 2 minutes (parallel)    │
   └─────────────────────────────────────────┘
```

**Vers approach:** 10 min setup + instant branching + parallel execution = **12 minutes total**

---

## Plugin Design

### Skill: vers-parallel-web-testing

```markdown
---
name: vers-parallel-web-testing
description: >
  Parallel web/UI testing using Vers VM branching. Activate when user
  mentions: browser testing, Puppeteer, Playwright, Selenium, e2e testing,
  checkout testing, form testing, UI testing, payment flow testing.
globs:
  - "**/*.spec.ts"
  - "**/*.test.ts"
  - "**/e2e/**"
  - "**/playwright.config.*"
  - "**/puppeteer.*"
---

# Parallel Web Testing with Vers

## When to Use This Pattern

Use Vers VM branching for web testing when:
- Setup time > test execution time
- Testing multiple paths from same state (payments, forms, user flows)
- Need exact state reproduction for debugging
- Running browser-based E2E tests

## Core Workflow

### 1. Setup Phase
Run your browser automation to reach the "decision point":
```javascript
// test-setup.js
const browser = await puppeteer.launch();
const page = await browser.newPage();
await page.goto('https://store.example.com');
await addItemsToCart(page);
await fillShippingInfo(page);
// STOP HERE - browser is at payment selection
```

### 2. Checkpoint
```bash
vers commit --tag "checkout-ready"
```
This captures:
- Browser process state (memory)
- Page DOM state
- Cookies, localStorage
- Network connections

### 3. Branch & Test
```bash
# Create branches for each payment method
vers branch --alias payment-credit-card
vers branch --alias payment-paypal
vers branch --alias payment-apple-pay

# Run tests in parallel
vers checkout payment-credit-card && vers execute "node test-credit-card.js" &
vers checkout payment-paypal && vers execute "node test-paypal.js" &
vers checkout payment-apple-pay && vers execute "node test-apple-pay.js" &
wait
```

## Quick Reference

| Command | Description |
|---------|-------------|
| `vers commit --tag <name>` | Checkpoint browser state |
| `vers branch --alias <name>` | Create test branch |
| `vers checkout <branch>` | Switch to branch |
| `vers execute "<cmd>"` | Run command in VM |
| `vers rollback <tag>` | Return to checkpoint |
```

### Slash Command: /vers-web-test-branch

```markdown
---
description: Create branches for parallel web testing from current browser state
argument-hint: <prefix> <scenario1> <scenario2> ...
allowed-tools: Bash(vers:*)
---

## Task

Create a checkpoint and branches for parallel web testing.

Given prefix "$1" and scenarios "$2...", this command will:

1. Commit current state as checkpoint:
   ```bash
   vers commit --tag "$1-baseline"
   ```

2. Create a branch for each scenario:
   ```bash
   for scenario in $2 $3 $4 ...; do
     vers branch --alias "$1-$scenario"
   done
   ```

3. Output instructions for running tests:
   ```
   Branches created:
   - payment-credit-card
   - payment-paypal
   - payment-apple-pay

   Run tests in parallel:
   vers checkout payment-credit-card && vers execute "npm test -- --grep credit" &
   vers checkout payment-paypal && vers execute "npm test -- --grep paypal" &
   wait
   ```
```

### MCP Tools

```typescript
// tools/web_test_checkpoint.ts
server.registerTool("web_test_checkpoint", {
  description: "Create checkpoint at current browser state for parallel web testing",
  inputSchema: {
    tag: z.string().describe("Checkpoint tag name"),
    description: z.string().optional()
  }
}, async ({ tag, description }) => {
  // Commit current VM state
  const { stdout } = await execVers(`commit --tag "${tag}"`);
  const commitId = JSON.parse(stdout).commit_id;

  return {
    content: [{
      type: "text",
      text: JSON.stringify({
        status: "checkpoint_created",
        tag,
        commit_id: commitId,
        description,
        next_steps: [
          `Create branches: vers branch --alias ${tag}-scenario-1`,
          `Run tests: vers checkout ${tag}-scenario-1 && vers execute "npm test"`
        ]
      }, null, 2)
    }]
  };
});

// tools/web_test_parallel.ts
server.registerTool("web_test_parallel", {
  description: "Run web tests in parallel across branches",
  inputSchema: {
    baseline: z.string().describe("Baseline checkpoint to branch from"),
    scenarios: z.array(z.object({
      name: z.string(),
      command: z.string(),
      env: z.record(z.string()).optional()
    }))
  }
}, async ({ baseline, scenarios }) => {
  const results = [];

  // Create branches and run tests in parallel
  const promises = scenarios.map(async (scenario) => {
    const branchName = `${baseline}-${scenario.name}`;

    // Create branch
    await execVers(`branch --alias ${branchName} --from ${baseline}`);
    await execVers(`checkout ${branchName}`);

    // Set environment and run test
    const envStr = scenario.env
      ? Object.entries(scenario.env).map(([k,v]) => `${k}=${v}`).join(' ')
      : '';

    const startTime = Date.now();
    try {
      const { stdout } = await execAsync(`${envStr} ${scenario.command}`);
      return {
        scenario: scenario.name,
        branch: branchName,
        status: "passed",
        duration_ms: Date.now() - startTime,
        output: stdout
      };
    } catch (error) {
      return {
        scenario: scenario.name,
        branch: branchName,
        status: "failed",
        duration_ms: Date.now() - startTime,
        error: error.message
      };
    }
  });

  const results = await Promise.all(promises);
  const passed = results.filter(r => r.status === "passed").length;

  return {
    content: [{
      type: "text",
      text: JSON.stringify({
        summary: { total: results.length, passed, failed: results.length - passed },
        results
      }, null, 2)
    }]
  };
});
```

---

## Complete Example: E-Commerce Payment Testing

### vers-integration.yaml

```yaml
name: ecommerce-payment-tests
version: 1.0.0

vm:
  memory_mib: 2048
  vcpu: 2
  storage_mib: 8000

services:
  # Browser dependencies
  chromium:
    install: apt-get install -y chromium

  # Application under test
  app:
    build: .
    command: npm start
    healthcheck:
      command: curl -f http://localhost:3000/health

  # Mock payment providers
  stripe-mock:
    template: stripe-mock
    config:
      webhook_endpoint: http://localhost:3000/webhooks/stripe

tests:
  payment-flows:
    setup: node tests/setup-checkout.js
    checkpoint: checkout-ready
    branches:
      - name: credit-card-success
        command: npm test -- --grep "credit card success"
        env:
          STRIPE_CARD: "4242424242424242"

      - name: credit-card-decline
        command: npm test -- --grep "credit card decline"
        env:
          STRIPE_CARD: "4000000000000002"

      - name: credit-card-3ds
        command: npm test -- --grep "3D secure"
        env:
          STRIPE_CARD: "4000002760003184"

      - name: paypal-success
        command: npm test -- --grep "paypal success"
        env:
          PAYMENT_METHOD: paypal

      - name: apple-pay
        command: npm test -- --grep "apple pay"
        env:
          PAYMENT_METHOD: apple_pay

checkpoints:
  - name: app-started
    after: services.app.healthcheck
  - name: cart-filled
    after: tests.payment-flows.setup
  - name: checkout-ready
    after: scripts/navigate-to-checkout.js
```

### Test Setup Script

```javascript
// tests/setup-checkout.js
const puppeteer = require('puppeteer');

async function setupCheckout() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();

  // Navigate to store
  await page.goto('http://localhost:3000');

  // Add items to cart
  await page.click('[data-testid="product-1"]');
  await page.click('[data-testid="add-to-cart"]');
  await page.click('[data-testid="product-2"]');
  await page.click('[data-testid="add-to-cart"]');

  // Go to checkout
  await page.click('[data-testid="checkout-button"]');

  // Fill shipping info
  await page.fill('[name="email"]', 'test@example.com');
  await page.fill('[name="address"]', '123 Test St');
  await page.fill('[name="city"]', 'Test City');
  await page.fill('[name="zip"]', '12345');
  await page.click('[data-testid="continue-to-payment"]');

  // Wait for payment form
  await page.waitForSelector('[data-testid="payment-form"]');

  console.log('Setup complete - ready for payment testing');

  // Keep browser open for checkpoint
  // Browser state will be captured by vers commit
}

setupCheckout();
```

### Running the Tests

```bash
# Initialize and start services
vers build
vers integration up --checkpoint app-started

# Run setup to reach checkout
vers execute "node tests/setup-checkout.js"
vers commit --tag checkout-ready

# Run all payment tests in parallel
vers integration test --suite payment-flows --parallel

# Output:
# Payment Flow Tests
# ==================
# ✓ credit-card-success    (3.2s)
# ✓ credit-card-decline    (2.8s)
# ✓ credit-card-3ds        (4.1s)
# ✓ paypal-success         (3.5s)
# ✓ apple-pay              (3.0s)
#
# 5/5 passed in 4.1s (parallel execution)
# Traditional time: 5 × 15min = 75min
# Time saved: 98%
```

---

## Business Value

### Quantified Benefits

| Metric | Traditional | With Vers | Improvement |
|--------|-------------|-----------|-------------|
| Test setup time | 15 min/test | 15 min once | 95% reduction |
| Total test time (30 scenarios) | 7.5 hours | 20 min | 96% reduction |
| State consistency | Variable | Exact | 100% reproducible |
| Debugging time | Hours | Minutes | Instant state restore |
| CI/CD pipeline | Sequential | Parallel | 10x faster |

### Developer Experience

- **Before:** "I'll run the tests overnight"
- **After:** "Tests complete before my coffee's ready"

### Competitive Advantage

No other tool provides:
1. **Browser memory state capture** (not just screenshots)
2. **Instant branching** from captured state
3. **True parallel execution** with isolated state
4. **AI assistance** knowing when/how to use branching

---

## Implementation Priority

### Phase 1: Core Functionality
- [x] Skill documentation
- [ ] `web_test_checkpoint` MCP tool
- [ ] `web_test_parallel` MCP tool
- [ ] `/vers-web-test-branch` command

### Phase 2: Framework Integration
- [ ] Puppeteer helper library
- [ ] Playwright integration
- [ ] Selenium support

### Phase 3: Advanced Features
- [ ] Visual regression testing with branches
- [ ] Performance comparison across branches
- [ ] Automatic failure screenshot capture
