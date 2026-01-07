# Troubleshooting Guide

Common issues and solutions for Vers integration testing.

## Service Issues

### PostgreSQL

#### Connection Refused
```
Error: connect ECONNREFUSED 127.0.0.1:5432
```

**Solutions:**
```bash
# Check if PostgreSQL is running
vers execute "pg_isready"

# If not running, start it
vers execute "pg_ctl start -D /var/lib/postgresql/data"

# Check PostgreSQL logs
vers execute "tail -50 /var/log/postgresql/postgresql-15-main.log"

# Verify listening on correct port
vers execute "ss -tlnp | grep 5432"
```

#### Authentication Failed
```
Error: password authentication failed for user "postgres"
```

**Solutions:**
```bash
# Check pg_hba.conf settings
vers execute "cat /etc/postgresql/15/main/pg_hba.conf"

# Ensure local connections use "trust" for testing
vers execute "echo 'local all all trust' >> /etc/postgresql/15/main/pg_hba.conf"
vers execute "pg_ctl reload -D /var/lib/postgresql/data"
```

#### Database Does Not Exist
```
Error: database "myapp" does not exist
```

**Solutions:**
```bash
# Create the database
vers execute "createdb myapp"

# Or check your vers-integration.yaml has correct config
# services:
#   postgres:
#     config:
#       databases: [myapp]
```

#### Too Many Connections
```
Error: too many connections for role "postgres"
```

**Solutions:**
```bash
# Check current connections
vers execute "psql -c 'SELECT count(*) FROM pg_stat_activity;'"

# Increase max_connections
vers execute "psql -c 'ALTER SYSTEM SET max_connections = 200;'"
vers execute "pg_ctl restart -D /var/lib/postgresql/data"

# Or terminate idle connections
vers execute "psql -c 'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE state = '\\''idle'\\'' AND query_start < now() - interval '\\''5 minutes'\\'''"
```

---

### Redis

#### Connection Refused
```
Error: Redis connection to localhost:6379 failed
```

**Solutions:**
```bash
# Check if Redis is running
vers execute "redis-cli ping"

# If not running, start it
vers execute "redis-server --daemonize yes"

# Check Redis logs
vers execute "tail -50 /var/log/redis/redis-server.log"
```

#### Memory Limit Reached
```
Error: OOM command not allowed when used memory > 'maxmemory'
```

**Solutions:**
```bash
# Check memory usage
vers execute "redis-cli INFO memory"

# Clear cache
vers execute "redis-cli FLUSHALL"

# Or increase maxmemory in vers-integration.yaml
# services:
#   redis:
#     config:
#       maxmemory: 512mb
```

---

### Kafka

#### Broker Not Available
```
Error: Broker may not be available
```

**Solutions:**
```bash
# Check if Kafka and Zookeeper are running
vers execute "jps"  # Should show Kafka and QuorumPeerMain

# Check Kafka logs
vers execute "tail -100 /opt/kafka/logs/server.log"

# Verify Zookeeper is healthy
vers execute "echo ruok | nc localhost 2181"

# Restart Kafka
vers execute "kafka-server-stop.sh && kafka-server-start.sh -daemon /opt/kafka/config/server.properties"
```

#### Topic Not Found
```
Error: Topic 'events' not found
```

**Solutions:**
```bash
# List existing topics
vers execute "kafka-topics.sh --list --bootstrap-server localhost:9092"

# Create topic
vers execute "kafka-topics.sh --create --topic events --bootstrap-server localhost:9092 --partitions 3 --replication-factor 1"

# Or ensure topics are defined in vers-integration.yaml
# services:
#   kafka:
#     config:
#       topics:
#         - name: events
#           partitions: 3
```

---

### Elasticsearch

#### Cluster Health Red
```
Error: Elasticsearch cluster health is RED
```

**Solutions:**
```bash
# Check cluster health
vers execute "curl -s localhost:9200/_cluster/health?pretty"

# Check for unassigned shards
vers execute "curl -s localhost:9200/_cat/shards?v | grep UNASSIGNED"

# For single-node, set replicas to 0
vers execute "curl -X PUT 'localhost:9200/_settings' -H 'Content-Type: application/json' -d'{\"index\":{\"number_of_replicas\":0}}'"
```

#### Out of Memory
```
Error: java.lang.OutOfMemoryError: Java heap space
```

**Solutions:**
```bash
# Check current heap settings
vers execute "cat /etc/elasticsearch/jvm.options | grep Xm"

# Increase heap (should be ~50% of available RAM, max 32GB)
vers execute "echo '-Xms1g' >> /etc/elasticsearch/jvm.options"
vers execute "echo '-Xmx1g' >> /etc/elasticsearch/jvm.options"
vers execute "systemctl restart elasticsearch"

# Or set via environment
# services:
#   elasticsearch:
#     env:
#       ES_JAVA_OPTS: "-Xms1g -Xmx1g"
```

---

## Branch & Checkpoint Issues

### Branch Creation Failed
```
Error: Failed to create branch: insufficient storage
```

**Solutions:**
```bash
# Check available storage
vers execute "df -h"

# Clean up old branches
vers branch list
vers branch delete old-test-branch

# Increase storage in vers.toml
# [storage]
# cluster_mib = 10000
# vm_mib = 5000
```

### Checkout Failed
```
Error: Cannot checkout branch: uncommitted changes
```

**Solutions:**
```bash
# Commit current state first
vers commit --tag "work-in-progress"
vers checkout other-branch

# Or discard changes
vers rollback HEAD
vers checkout other-branch
```

### Checkpoint Not Found
```
Error: Checkpoint 'seeded' not found
```

**Solutions:**
```bash
# List available checkpoints
vers log --format checkpoints

# Re-run seeding and create checkpoint
vers execute "npm run db:seed"
vers commit --tag "seeded"
```

---

## Test Execution Issues

### Tests Timeout
```
Error: Test timeout after 120000ms
```

**Solutions:**
```yaml
# Increase timeout in vers-integration.yaml
tests:
  e2e:
    command: npm run test:e2e
    timeout: 300000  # 5 minutes
```

```bash
# Or run with explicit timeout
vers integration test --suite e2e --timeout 300000
```

### Parallel Tests Interfering
```
Error: Unique constraint violation on email
```

**Solutions:**
```yaml
# Use unique identifiers per branch
tests:
  signup:
    branches:
      - name: test-1
        env:
          TEST_EMAIL: "test-${BRANCH_ID}-1@example.com"
      - name: test-2
        env:
          TEST_EMAIL: "test-${BRANCH_ID}-2@example.com"
```

### Service Not Ready During Test
```
Error: Connection refused (service not ready)
```

**Solutions:**
```yaml
# Add proper health checks and dependencies
services:
  app:
    depends_on: [postgres, redis]
    healthcheck:
      command: curl -f localhost:3000/health
      interval: 5s
      timeout: 10s
      retries: 30
      start_period: 60s  # Wait for app to start

tests:
  integration:
    depends_on: [app]  # Wait for app healthcheck
    command: npm run test:integration
```

---

## Deployment Issues

### Deployment Fails Health Check
```
Error: Health check failed after 10 attempts
```

**Solutions:**
```bash
# Check what's failing
vers integration deploy-logs production

# SSH into deployment
vers integration connect production

# Check application logs
vers execute "tail -100 /var/log/app.log"

# Verify health endpoint works locally
vers execute "curl -v localhost:3000/health"
```

### Domain Not Accessible
```
Error: DNS resolution failed for myapp.vers.sh
```

**Solutions:**
```bash
# Check deployment status
vers integration deployments

# Verify domain configuration
vers integration status production

# DNS propagation can take time, wait and retry
sleep 60
curl https://myapp.vers.sh/health
```

### SSL Certificate Error
```
Error: certificate has expired
```

**Solutions:**
```bash
# Trigger certificate renewal
vers integration ssl renew production

# Or use manual certificate
vers integration ssl upload production --cert ./cert.pem --key ./key.pem
```

---

## Network Issues

### Service Can't Reach Another Service
```
Error: getaddrinfo ENOTFOUND postgres
```

**Solutions:**
```bash
# Check service is running
vers integration status

# Check network connectivity
vers execute "ping postgres"
vers execute "nc -zv postgres 5432"

# Check /etc/hosts or DNS resolution
vers execute "cat /etc/hosts"
vers execute "nslookup postgres"
```

### Port Already in Use
```
Error: listen EADDRINUSE: address already in use :::3000
```

**Solutions:**
```bash
# Find what's using the port
vers execute "lsof -i :3000"

# Kill the process
vers execute "fkill :3000"

# Or use different port
# services:
#   app:
#     ports:
#       - 3001:3000
```

---

## Performance Issues

### Slow Test Execution
**Symptoms:** Tests take much longer than expected

**Solutions:**
```bash
# Check resource usage
vers execute "top -bn1 | head -20"
vers execute "free -m"
vers execute "iostat -x 1 5"

# Increase VM resources in vers.toml
# [vm]
# memory_mib = 4096
# vcpu = 2

# Use parallel test execution
vers integration test --parallel

# Profile slow tests
vers execute "npm run test:profile"
```

### Database Queries Slow
**Solutions:**
```bash
# Check for missing indexes
vers execute "psql -c 'SELECT * FROM pg_stat_user_indexes WHERE idx_scan = 0;'"

# Analyze query performance
vers execute "psql -c 'EXPLAIN ANALYZE SELECT ...'"

# Check connection pool settings
# Ensure not creating new connections for each query
```

---

## Common Error Messages

| Error | Likely Cause | Solution |
|-------|--------------|----------|
| `ECONNREFUSED` | Service not running | Start service, check healthcheck |
| `ETIMEDOUT` | Service unreachable | Check network, ports |
| `ENOENT` | File not found | Check paths in config |
| `ENOMEM` | Out of memory | Increase VM memory, optimize services |
| `ENOSPC` | Disk full | Clean up, increase storage |
| `EACCES` | Permission denied | Check file permissions, user |
| `EPERM` | Operation not permitted | Check capabilities, sudo |

---

## Getting Help

### Collect Diagnostics
```bash
# Generate diagnostic bundle
vers diagnostics --output diag-bundle.tar.gz

# This includes:
# - vers.toml
# - vers-integration.yaml
# - Service logs
# - System info
# - Network config
```

### Debug Mode
```bash
# Run with verbose logging
VERS_DEBUG=1 vers integration test --suite failing-test

# Or set in environment
export VERS_LOG_LEVEL=debug
vers integration up
```

### Report Issues
Include:
1. Diagnostic bundle
2. Steps to reproduce
3. Expected vs actual behavior
4. vers version (`vers --version`)

Report at: https://github.com/hdresearch/vers-integration-plugin/issues
