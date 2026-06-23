# Performance Evaluation Plan

This document describes how to evaluate DACN performance in staging before promoting the same image tag to production. The goal is not only to "run 10,000 users"; the goal is to prove that latency, error rate, throughput, autoscaling, and stability meet the agreed thresholds.

Performance evaluation is evidence for the DevOps argument of the project: production speed and reliability are shared outcomes of code, infrastructure, testing, GitOps, and observability.

## Goals

The main questions are:

```text
Can the system handle the 10,000 virtual-user target?
Are p95 and p99 latency within the accepted thresholds?
Is the error rate below 1%?
Does HPA scale correctly as load increases?
Where are the bottlenecks: MongoDB, Redis, Gateway, Product, or Auth?
Is this exact image tag safe to promote to production?
```

## Current Scope

Components under test:

| Component | Role |
| --- | --- |
| Frontend | Verifies `/` through the ingress/gateway path |
| Gateway | API entry point and `/api/*` router |
| Auth service | Login, JWT, refresh-token flow |
| Product service | Product list/detail and Redis cache behavior |
| Redis | Cache/session/token store |
| MongoDB | Primary data store for auth/product |
| Kubernetes HPA | Pod scaling under load |

Currently out of scope:

```text
Order service
Payment service
RabbitMQ
full observability stack validation
service mesh
```

## Definition Of 10,000 Users

In k6, 10,000 users means **10,000 virtual users (VUs)**. It does not mean 10,000 requests per second.

Actual RPS depends on:

```text
requests per iteration
think time between requests
system latency
duration of the sustained load phase
```

For example:

```text
10,000 VUs, each sending 1 request every 2 seconds
=> about 5,000 RPS
```

Reports must include:

```text
virtual users
test duration
ramp-up/ramp-down
traffic mix
think time
observed RPS
```

## Staging Environment

The staging environment must be close enough to production for the results to be meaningful.

| Group | What to record |
| --- | --- |
| Kubernetes | Node count, CPU/RAM per node, Kubernetes version |
| Ingress | Kubernetes Ingress/load balancer, TLS, domain |
| Workload | Initial replicas, HPA min/max, CPU target |
| Database | MongoDB mode, connection string type, instance size |
| Cache | Redis mode, memory limit, eviction policy |
| Image | Image tag under test, for example `sha-abc123` |
| Load generator | k6 Cloud or distributed self-hosted runners |

## Metrics To Collect

### User-Facing Metrics

| Metric | Meaning |
| --- | --- |
| `http_req_duration p50` | Typical user experience |
| `http_req_duration p95` | Experience for most users |
| `http_req_duration p99` | Tail latency for the slowest users |
| `http_req_failed` | Request failure rate |
| `checks` | Assertion pass rate |
| RPS/throughput | Actual processing capacity |

### Kubernetes Metrics

| Metric | Meaning |
| --- | --- |
| CPU/memory per pod | Identifies resource pressure |
| Replica count | Shows HPA behavior |
| Pod restart count | Detects runtime errors and OOM |
| HPA events | Shows scaling reason and timing |
| Ingress 4xx/5xx | Edge-layer errors |

### Service Metrics

| Service | What to observe |
| --- | --- |
| Gateway | CPU, 401/403/502, route latency |
| Auth | Login latency, Redis token operations, JWT errors |
| Product | Product list/detail latency, cache hit behavior |
| Redis | Latency, memory, connected clients, slow commands |
| MongoDB | Query latency, connection count, slow queries |

## Test Matrix

Do not rely on only one 10k-user test. Run multiple tests to understand behavior from light to heavy load.

| Test | Purpose | Example load | Expected outcome |
| --- | --- | --- | --- |
| Baseline | Measure normal behavior | 100 VUs, 5 minutes | Low latency, little scaling |
| Load | Validate target load | 10,000 VUs | Pass thresholds |
| Stress | Find breaking point | beyond 10,000 VUs | Identify failure threshold |
| Spike | Sudden load increase | 100 -> 1,000 VUs in 30 seconds | System does not collapse |
| Soak | Long run | 300 VUs for 30 minutes by default | No memory leak/restart |
| Scalability | Compare tuning phases | multiple configs | Prove HPA/cache/resource tuning impact |

## 10,000-User Scenario

Main script:

```text
tests/load/staging-10000-users.js
```

Scenario:

```text
10 minutes ramp up to 10,000 VUs
20 minutes hold at 10,000 VUs
5 minutes ramp down
```

Current traffic mix:

```text
login in setup
GET /api/products?page=1&limit=20
GET /api/products/:id for 25% of iterations if PRODUCT_ID is configured
think time 0.5s - 2s
```

Additional executable profiles:

```text
LOAD_PROFILE=spike
  30s ramp to 100 VUs
  30s spike to SPIKE_TARGET, default 1,000 VUs
  2m hold at SPIKE_TARGET
  30s ramp down to 100 VUs
  30s ramp down to 0

LOAD_PROFILE=soak
  2m ramp to SOAK_TARGET, default 300 VUs
  SOAK_DURATION steady hold, default 30m
  2m ramp down to 0
```

Thresholds:

```text
http_req_failed < 1%
p95 latency < 800ms
p99 latency < 1500ms
checks pass rate > 99%
```

## Test Procedure

1. Deploy the image tag to staging with FluxCD.
2. Confirm FluxCD sync succeeded.
3. Run staging smoke tests:

```text
/api/health
/api/auth/health
/api/products/health
/
```

4. Warm up the system for 3-5 minutes.
5. Run the selected k6 scenario with k6 Cloud or a distributed load generator.
6. Collect artifacts:

```text
k6 summary
Grafana dashboard screenshots
HPA events
pod CPU/memory
pod restart count
MongoDB/Redis metrics
Ingress 4xx/5xx
```

7. Compare results with thresholds.
8. Conclude: pass, fail, or pass with conditions.

## Pass/Fail Criteria

A 10k-user test passes when:

```text
http_req_failed < 1%
p95 latency < 800ms
p99 latency < 1500ms
checks pass rate > 99%
no abnormal pod restarts
no OOMKilled events
HPA scales within maxReplicas
MongoDB/Redis show no serious errors
```

The test fails if any of these occur:

```text
error rate >= 1%
p95 or p99 is continuously above threshold
Gateway/Product/Auth returns many 5xx errors
pod restart/OOMKilled occurs during the test
HPA does not scale while CPU is high
database/cache becomes a bottleneck without a mitigation plan
```

## Bottleneck Analysis

| Symptom | Possible bottleneck | Where to check |
| --- | --- | --- |
| Gateway 502 increases | Downstream timeout/down service | Gateway logs, service health |
| Product list p95 rises | MongoDB query or cache miss | Product logs, Mongo slow query, Redis metrics |
| Product pod CPU high | Compute-bound service | HPA events, pod CPU |
| Redis latency high | Cache/key operation pressure | Redis slowlog, memory, clients |
| Mongo connection count high | DB connection/query pressure | Mongo metrics, indexes |
| HPA scales late | Metrics server/HPA config | `kubectl describe hpa` |
| Pod restart | OOM or crash | `kubectl describe pod`, logs |

Known code risk:

```js
redis.keys("products:*")
```

`KEYS` can block Redis when the cache grows. If tests show Redis latency during product update/delete flows, replace this with cache versioning, tag-based invalidation, or `SCAN`.

## Before/After Optimization Analysis

Recommended benchmark phases:

| Phase | Configuration | Comparison goal |
| --- | --- | --- |
| P1 | Low replicas, basic cache | Baseline |
| P2 | Redis cache enabled/tuned | Product list/detail latency |
| P3 | HPA enabled | Error rate under growing load |
| P4 | CPU/memory requests tuned | More stable HPA behavior |
| P5 | Query/index/cache invalidation optimized | Lower p95/p99 |

Suggested results table:

| Phase | VUs | RPS | Error rate | p95 | p99 | Max replicas | Conclusion |
| --- | --- | --- | --- | --- | --- | --- | --- |
| P1 | 1,000 | TBD | TBD | TBD | TBD | TBD | Baseline |
| P2 | 1,000 | TBD | TBD | TBD | TBD | TBD | Cache impact |
| P3 | 10,000 | TBD | TBD | TBD | TBD | TBD | HPA impact |

## Production Readiness Summary Template

```text
Image tag: sha-xxxxxxx
Environment: staging
Scenario: 10,000 VUs, 35 minutes
Observed RPS: TBD
Error rate: TBD
p95 latency: TBD
p99 latency: TBD
Max auth replicas: TBD
Max product replicas: TBD
Max gateway replicas: TBD
Pod restarts: TBD
Conclusion: PASS/FAIL
Recommendation: promote/do not promote to production
```

## Artifacts For The Report

```text
k6 result JSON or k6 Cloud link
Grafana dashboard screenshots
HPA scaling timeline screenshot
pod CPU/memory screenshot
representative error logs if failed
benchmark comparison table
tested commit/image tag
```

## Conclusion

Performance evaluation must prove three things:

```text
the system can handle the target load
the system scales and recovers reasonably
risks and bottlenecks are detected and explained
```

Only when staging validation passes the agreed thresholds should the image tag be promoted to production through FluxCD/GitOps.

For the executable production decision flow, run:

```text
scripts/production-readiness-gate.sh
```
