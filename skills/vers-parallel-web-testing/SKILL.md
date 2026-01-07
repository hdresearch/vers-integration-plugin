---
name: vers-parallel-web-testing
description: Parallel web/UI testing using Vers VM branching. Use when testing multiple user flows from a common setup point, testing payment flows, form submissions, or any scenario where browser state setup is expensive. Activate when user mentions parallel testing, web testing, Puppeteer, Playwright, browser automation, e-commerce testing, checkout testing, or payment flow testing.
globs:
  - "**/test/**/*.{spec,test}.{js,ts}"
  - "**/e2e/**/*.{js,ts}"
  - "**/puppeteer*"
  - "**/playwright*"
---

# Parallel Web Testing with Vers

Vers enables "branch once, test many" workflows for browser-based testing. Instead of repeating expensive setup steps (login, form filling, cart population) for each test scenario, you capture state at decision points and branch into parallel test paths.

## Core Mental Model

Traditional web testing:
```
Setup → Test A → Teardown
Setup → Test B → Teardown  (repeated setup!)
Setup → Test C → Teardown  (repeated setup!)
```

Vers-enabled testing:
```
Setup → [Commit Checkpoint]
            ├── Branch → Test A
            ├── Branch → Test B
            └── Branch → Test C
```

Each branch inherits the complete state: browser process, DOM state, cookies, localStorage, network connections.

## When This Pattern Applies

**High-value scenarios:**
- Payment flow testing (credit card vs PayPal vs Apple Pay)
- Multi-step form submissions with validation branches
- E-commerce checkout with different shipping/discount paths
- User role testing from authenticated state
- A/B variant testing from identical starting points

**Key indicator:** Setup time exceeds test execution time.

## Quick Reference

```bash
# Build environment with browser dependencies
vers build

# Run setup script, reach decision point
vers connect
> node setup-test.js  # Fills cart, reaches checkout

# Checkpoint the state
vers commit --tag "Cart filled, ready for payment testing"

# Create parallel branches
vers branch --alias credit-card-test
vers branch --alias paypal-test
vers branch --alias apple-pay-test

# Execute tests in parallel (separate terminals)
vers checkout credit-card-test && vers execute "node test-credit-card.js"
vers checkout paypal-test && vers execute "node test-paypal.js"
vers checkout apple-pay-test && vers execute "node test-apple-pay.js"
```

## Environment Requirements

Your `vers.toml` should allocate sufficient resources for browser processes:

```toml
[vm]
memory_mib = 1024  # Minimum for Chromium
vcpu = 1

[storage]
cluster_mib = 6000
vm_mib = 3000
```

Dockerfile must include:
- SSH server (for `vers connect`)
- `iproute2` package (networking)
- Chromium/Chrome (for Puppeteer/Playwright)
- Proper DNS configuration

```dockerfile
FROM ubuntu:22.04

# Install system dependencies
RUN apt-get update && apt-get install -y \
    openssh-server \
    iproute2 \
    curl \
    chromium-browser \
    fonts-liberation \
    libnss3 \
    libatk-bridge2.0-0 \
    libdrm2 \
    libxkbcommon0 \
    libgbm1 \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs

# Configure SSH
RUN mkdir /var/run/sshd
RUN echo 'root:root' | chpasswd
RUN sed -i 's/#PermitRootLogin prohibit-password/PermitRootLogin yes/' /etc/ssh/sshd_config

# Set DNS
RUN echo "nameserver 8.8.8.8" > /etc/resolv.conf

EXPOSE 22
CMD ["/usr/sbin/sshd", "-D"]
```

## Base Test Class Pattern

```javascript
const puppeteer = require('puppeteer');

class WebTest {
  constructor() {
    this.browser = null;
    this.page = null;
  }

  async setup() {
    this.browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu'
      ],
      executablePath: '/usr/bin/chromium-browser'
    });
    this.page = await this.browser.newPage();
    await this.page.setViewport({ width: 1280, height: 800 });
  }

  async navigateToCheckout() {
    // Login
    await this.page.goto('https://store.example.com/login');
    await this.page.type('#email', 'test@example.com');
    await this.page.type('#password', 'password123');
    await this.page.click('#login-button');
    await this.page.waitForNavigation();

    // Add items to cart
    await this.page.goto('https://store.example.com/products/1');
    await this.page.click('#add-to-cart');
    await this.page.goto('https://store.example.com/products/2');
    await this.page.click('#add-to-cart');

    // Go to checkout
    await this.page.goto('https://store.example.com/checkout');
    await this.page.waitForSelector('#payment-method');

    // STOP HERE - this is the branch point
    console.log('Ready for payment testing - commit checkpoint now');
  }

  async teardown() {
    if (this.browser) {
      await this.browser.close();
    }
  }
}

module.exports = WebTest;
```

## Testing Patterns

### The Checkout Matrix Pattern

For testing N payment methods from one cart state:

```bash
# Phase 1: Reach checkout
vers connect
> node -e "
const WebTest = require('./test/web-test');
const test = new WebTest();
(async () => {
  await test.setup();
  await test.navigateToCheckout();
  console.log('Ready - commit now, browser stays open');
  // Keep process running
  await new Promise(() => {});
})();
"
# In another terminal:
vers commit --tag "checkout-ready"

# Phase 2: Branch for each payment method
for method in credit-card paypal apple-pay bank-transfer; do
  vers branch --alias "payment-$method"
done

# Phase 3: Run tests in parallel
vers checkout payment-credit-card && vers execute "node test-credit-card.js" &
vers checkout payment-paypal && vers execute "node test-paypal.js" &
vers checkout payment-apple-pay && vers execute "node test-apple-pay.js" &
wait
```

### Payment Test Implementation

```javascript
// test-credit-card.js
const WebTest = require('./test/web-test');

async function testCreditCard() {
  const test = new WebTest();

  // Browser is already at checkout from checkpoint!
  // Just need to reconnect to existing browser

  // Select credit card
  await test.page.click('#payment-credit-card');

  // Fill card details
  await test.page.type('#card-number', '4242424242424242');
  await test.page.type('#card-expiry', '12/25');
  await test.page.type('#card-cvc', '123');

  // Submit payment
  await test.page.click('#submit-payment');

  // Verify success
  await test.page.waitForSelector('.order-confirmation');
  const confirmation = await test.page.$eval(
    '.order-number',
    el => el.textContent
  );

  console.log(`Order confirmed: ${confirmation}`);
  process.exit(0);
}

testCreditCard().catch(err => {
  console.error(err);
  process.exit(1);
});
```

### The Form Validation Pattern

For testing validation paths on multi-step forms:

```javascript
// setup-form.js - Run this, then commit
async function setupForm() {
  const test = new WebTest();
  await test.setup();

  // Navigate to form
  await test.page.goto('https://app.example.com/signup');

  // Fill first two steps with valid data
  await test.page.type('#name', 'Test User');
  await test.page.click('#next');
  await test.page.type('#email', 'test@example.com');
  await test.page.click('#next');

  // Now at step 3 - ready to test different validation scenarios
  console.log('At step 3 - commit checkpoint');
}
```

```bash
# Commit at step 3
vers commit --tag "form-step-3"

# Test different validation scenarios
vers branch --alias "invalid-email" && vers execute "node test-invalid-email.js"
vers branch --alias "missing-required" && vers execute "node test-missing-required.js"
vers branch --alias "happy-path" && vers execute "node test-happy-path.js"
```

## Integration with vers-integration.yaml

```yaml
name: web-testing
version: 1.0.0

vm:
  memory_mib: 2048
  vcpu: 2
  storage_mib: 5000

services:
  app:
    build: .
    ports:
      - 3000:3000
    healthcheck:
      command: curl -f http://localhost:3000/health

tests:
  checkout:
    command: npm run test:checkout
    depends_on: [app]
    branches:
      - name: credit-card
        env:
          PAYMENT_METHOD: credit_card
          TEST_CARD: "4242424242424242"
      - name: paypal
        env:
          PAYMENT_METHOD: paypal
      - name: apple-pay
        env:
          PAYMENT_METHOD: apple_pay
      - name: card-declined
        env:
          PAYMENT_METHOD: credit_card
          TEST_CARD: "4000000000000002"

checkpoints:
  - name: app-ready
    after: services.app.healthcheck
  - name: logged-in
    after: scripts/login.sh
  - name: checkout-ready
    after: scripts/fill-cart.sh
```

## CI/CD Integration

```yaml
# .github/workflows/e2e-tests.yml
name: E2E Tests

on: [push, pull_request]

jobs:
  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Vers
        uses: hdresearch/setup-vers@v1
        with:
          api-key: ${{ secrets.VERS_API_KEY }}

      - name: Build and Start
        run: |
          vers build
          vers integration up --checkpoint app-ready

      - name: Setup Browser State
        run: |
          vers execute "node scripts/setup-checkout.js"
          vers commit --tag "checkout-ready"

      - name: Run Payment Tests
        run: |
          vers integration test --suite checkout --parallel

      - name: Upload Results
        if: always()
        uses: actions/upload-artifact@v3
        with:
          name: test-results
          path: test-results/
```

## Debugging Failed Tests

```bash
# Failed branch is preserved
vers checkout test-checkout-card-declined

# Connect and investigate
vers connect

# Inside VM:
> cat /tmp/test-results.json
> cat /var/log/app.log | grep -i error

# Re-run test with debugging
> DEBUG=puppeteer:* node test-card-declined.js

# Take screenshot at current state
> node -e "
const puppeteer = require('puppeteer');
(async () => {
  const browser = await puppeteer.connect({ browserWSEndpoint: 'ws://...' });
  const pages = await browser.pages();
  await pages[0].screenshot({ path: '/tmp/debug.png', fullPage: true });
})();
"
```

## Performance Tips

1. **Reuse browser instances** - Don't close browser between checkpoints
2. **Minimize checkpoint size** - Clear browser cache/storage if not needed
3. **Parallel branch creation** - Create all branches before running tests
4. **Resource allocation** - Give enough memory for Chromium (1GB minimum)
5. **Headless mode** - Always use headless in CI/CD

## Common Issues

### Browser crashes after branch
Chromium may need more shared memory:
```bash
vers execute "mount -o remount,size=512M /dev/shm"
```

### Tests fail to reconnect to browser
Browser process may have exited. Keep a watcher process running:
```javascript
// Keep browser alive
setInterval(() => {}, 1000);
process.on('SIGTERM', () => process.exit(0));
```

### Network requests fail after branch
DNS resolution may need refresh:
```bash
vers execute "echo 'nameserver 8.8.8.8' > /etc/resolv.conf"
```
