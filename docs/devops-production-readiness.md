# DevOps Production Readiness

This document describes the central argument of the project: when a microservices system is moved toward production, response time, stability, and capacity are not only a Developer responsibility or only an Operator responsibility. They are shared DevOps outcomes.

## Main Argument

A production-ready system is not produced by correct code alone, and it is not produced by powerful infrastructure alone. Production readiness comes from the combination of:

```text
Developers writing load-aware, observable, rollback-friendly code
Operators/platform teams providing stable infrastructure, autoscaling, secrets, ingress, and monitoring
CI validating source quality and build artifacts
FluxCD deploying consistently from GitOps state
Staging validation proving an artifact is safe enough before production
```

Therefore, the project does not ask only:

```text
Does the application run?
```

It asks:

```text
Is there enough evidence to allow this artifact to run in front of real users?
```

## Developer Responsibilities

Developers are responsible for software that can be operated:

```text
APIs return clear errors
health checks work correctly
endpoints and secrets are not hard-coded
configuration is read from environment variables
database queries have appropriate indexes
Redis cache is used in the right paths
dangerous operations under high load are controlled
logs contain enough context for debugging
core business flows are tested
```

Examples in this system:

```text
Auth service exposes /health
Product service behaves correctly on cache hit and cache miss
Gateway routes failures clearly
Frontend uses /api or VITE_API_BASE_URL instead of hard-coded localhost URLs
```

## Operator And Platform Responsibilities

The platform layer is responsible for a stable runtime environment:

```text
Kubernetes requests and limits are reasonable
HPA scales under load
Ingress and DNS are stable
production secrets are not stored as plaintext in Git
FluxCD reconciles the expected desired state
rollback can be performed
metrics and logs are sufficient for incident analysis
database/cache sizing fits the expected traffic
```

Good code can still fail under real traffic if infrastructure is weak or misconfigured.

## Shared Responsibilities

The following are shared system-level outcomes:

```text
p95 and p99 latency
error rate
capacity under 10,000 virtual users
scaling behavior under increasing load
time to detect failure
rollback ability
production readiness decision
```

A release should only be promoted when both code and environment pass the quality gate.

## Quality Gate Before Production

In this project, the production gate includes:

```text
CI build passes
dependency/security scan passes
Docker Compose smoke test passes
Helm render/lint passes
FluxCD syncs staging successfully
staging health checks pass
k6 10,000-user test passes thresholds
no abnormal pod restarts or OOMKilled events
error rate < 1%
p95 latency < 800ms
p99 latency < 1500ms
```

If an important condition fails, that image tag should not be promoted to production.

The executable version of this gate is documented in:

```text
docs/production-readiness-gate.md
```

It writes a timestamped summary under:

```text
reports/production-gate/<timestamp>/production-readiness-summary.md
```

## Why Production-Like Staging Is Needed

Local development cannot prove production readiness because it lacks:

```text
real ingress behavior
network latency
autoscaling
resource limits
secret injection
production-like database/cache behavior
large concurrent traffic
production-like observability
```

Staging connects Development and Operations:

```text
Developers see how code behaves under realistic load
Operators see how infrastructure scales and fails
CI/CD/GitOps proves that releases are repeatable
```

## Worst-Case Scenario To Avoid

The worst case is a release that passes local and light CI checks, then fails in production with:

```text
gateway timeouts
high product-service p99 latency
Redis pressure from expensive key operations
slow MongoDB queries
slow HPA reaction
OOMKilled pods
large bursts of user-facing 5xx errors
unclear rollback procedure
```

The goal is to move these risks into staging and detect them before users are affected.

## Conclusion

DevOps in this project is not just using Docker, Kubernetes, GitHub Actions, or FluxCD. DevOps is the process of turning a build into a release with evidence that it is:

```text
repeatably deployable
observable
load-tolerant
rollback-capable
trustworthy before production
```

That is why performance evaluation and staging validation are central to the project.
