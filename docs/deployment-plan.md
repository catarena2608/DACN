# Deployment Plan For The Lab

This document describes the lab deployment plan for the project. The goal is to build a production-like environment that is still practical for a lab, and to prove the DevOps/GitOps, staging validation, and performance-evaluation workflow without turning the project into a heavy cloud platform exercise.

## Deployment Argument

The project does not need to start with a managed cloud Kubernetes platform. The more important goal is to prove this workflow:

```text
Developer pushes code
GitHub Actions build/test/security scan
Images are pushed to GHCR
FluxCD syncs staging from Git state
Staging validation runs smoke tests and k6 load tests
If validation passes, the same image tag is promoted to production state
FluxCD syncs production
```

The lab environment should prioritize:

```text
easy setup
easy demo
observable behavior
enough production similarity for performance evaluation
reasonable resource usage
```

## Target Architecture

The architecture diagram is stored at:

```text
docs/assets/architecture.png
```

Main groups:

| Group | Components |
| --- | --- |
| Entry | Client, Load Balancer, API Gateway, Frontend |
| Business services | Auth, User, Product, Order, Payment, Ranking, Admin |
| Data | MongoDB per domain, Redis Cache, RabbitMQ |
| Metrics | Prometheus, Node Exporter, Grafana |
| Logs | OpenTelemetry Collector, Elasticsearch, Kibana |
| Traces | OpenTelemetry Collector, Jaeger UI |
| Release workflow | GitHub Actions, GHCR, FluxCD, Helm |
| Performance validation | k6, staging validation workflow |

Current repository scope:

```text
frontend
gateway
auth service
product service
order service
nginx local proxy
RabbitMQ in Docker Compose/Helm
Docker Compose
Helm chart
GitHub Actions CI
k6 staging script
```

Payment, Ranking, and Admin should be presented as future extensions unless implemented.

## Proposed Tech Stack

### Application

| Component | Technology | Reason |
| --- | --- | --- |
| Frontend | React + Vite | Lightweight web client and easy image build |
| API Gateway | Node.js + Express | Simple routing and latency measurement |
| Services | Node.js + Express | Consistent backend stack |
| Database | MongoDB | Document model for catalog/domain data |
| Cache/session | Redis | Product cache and token/session data |
| Message broker | RabbitMQ | Event/RPC path for order-related flows |

### Platform

| Component | Technology | Reason |
| --- | --- | --- |
| Container | Docker | Standard build artifact |
| Local runtime | Docker Compose | Fast local full-stack testing |
| Orchestration | Kubernetes | Production-like runtime |
| Deployment package | Helm | Values per environment |
| GitOps CD | FluxCD | Cluster reconciles from Git |
| Registry | GHCR | Integrates with GitHub Actions |
| Ingress | Kubernetes Ingress | Standard entrypoint for frontend and API routing |

### Observability

| Need | Technology | Notes |
| --- | --- | --- |
| Metrics | Prometheus | Cluster/service metrics |
| Dashboard | Grafana | CPU, memory, HPA, latency dashboards |
| Node metrics | Node Exporter | Node resource visibility |
| Logs | Elasticsearch + Kibana | Search/filter/log analysis |
| Traces | OpenTelemetry Collector + Jaeger UI | Request trace visualization |
| Load test | k6 | p95/p99/error rate/RPS |

## Why ELK Instead Of Loki

Loki is lighter and integrates quickly with Grafana. ELK can be justified here because the goal is not only to store logs but to analyze logs under load for production-readiness evidence.

Reasons to choose ELK:

```text
Elasticsearch is strong for full-text search.
Kibana provides filtering, dashboards, timelines, and log analytics.
ELK is common in enterprise production environments.
Logs can be indexed by service, trace_id, status_code, error message, and latency bucket.
During k6 tests, operators can quickly find 5xx, timeouts, slow requests, and correlated trace IDs.
```

If asked why ELK is heavy:

```text
Yes, ELK is heavier than Loki. This is an intentional trade-off.
The project uses ELK for log analytics depth, not for minimal resource usage.
In the lab, Elasticsearch can run single-node with short retention and explicit resource limits.
For cheaper log storage only, Loki would be simpler.
```

## Recommended Lab Model

### Cluster Choice

| Option | When to use | Notes |
| --- | --- | --- |
| kind/Minikube local | Quick demo on a strong personal machine | Easiest, but resource-limited |
| k3s on VPS/VMs | Production-like lab within budget | Recommended for the project |
| Managed Kubernetes | Cloud-native target | Powerful but heavier and easier to over-scope |

Recommended minimum if running ELK, Prometheus, Grafana, MongoDB, Redis, RabbitMQ, and app services:

```text
8 vCPU / 16GB RAM or higher
```

### Namespaces

```text
flux-system          # FluxCD
ingress-controller   # Ingress Controller namespace, if not provided by the cluster
observability        # Prometheus, Grafana, Elasticsearch, Kibana, Jaeger, OTel
data                 # MongoDB, Redis, RabbitMQ if run in-cluster
dacn-staging         # Application staging
dacn-prod            # Production-like application environment
```

## Deployment Phases

### Phase 1: Local Baseline

Goal:

```text
run frontend/gateway/auth/product/local data layer
ensure developers can reproduce the stack quickly
```

Work:

```text
Docker Compose full stack
health checks pass
login flow pass
product list/detail pass
```

### Phase 2: Kubernetes Lab Base

Goal:

```text
create a Kubernetes lab cluster
install ingress controller
configure storage class
create namespaces
install FluxCD
connect FluxCD to GitOps state
```

Expected result:

```text
kubectl get nodes passes
FluxCD sync passes
Ingress works
```

### Phase 3: App Deployment With FluxCD

Goal:

```text
GitHub Actions does not deploy directly
FluxCD deploys the app through Helm
```

Work:

```text
GitHub Actions builds images and pushes to GHCR
Helm chart uses environment imageTag
FluxCD syncs staging namespace
staging URL is reachable
```

Expected result:

```text
/api/health passes
/api/auth/health passes
/api/products/health passes
/ passes
```

### Phase 4: Data Layer

Goal:

```text
MongoDB, Redis, and RabbitMQ are available in the lab
services connect reliably
```

Lab implementation:

```text
MongoDB: Bitnami MongoDB standalone
Redis: standalone for lab, cluster if resources allow
RabbitMQ: standalone broker for order/product flow
```

Production recommendation:

```text
use managed database/cache/broker services, or HA charts with backup and secret management
```

### Phase 5: Observability

Goal:

```text
collect metrics, logs, and traces for validation evidence
```

Minimum:

```text
Prometheus
Grafana
Node Exporter
kube-state-metrics
```

Extended:

```text
OpenTelemetry Collector
Elasticsearch
Kibana
Jaeger UI
```

### Phase 6: Performance Validation

Goal:

```text
prove latency, error rate, throughput, autoscaling, and stability thresholds
```

Work:

```text
baseline test
load test
stress/spike/soak tests if resources allow
collect k6, Grafana, HPA, logs, and trace artifacts
```

### Phase 7: Promotion And Rollback

Goal:

```text
only promote image tags that pass staging validation
```

Promotion:

```text
copy staging imageTag to production GitOps state
unsuspend production HelmRelease
merge through PR/review
FluxCD syncs production
```

Rollback:

```text
revert the GitOps commit
or set imageTag back to a known-good sha
FluxCD reconciles the previous state
```

## Production Readiness Evidence

The final report should include:

```text
FluxCD sync screenshots
kubectl get pods -A
staging smoke test results
k6 baseline/load results
Grafana CPU/memory/HPA dashboards
logs/traces if enabled
image tag promoted from staging to production-like
rollback explanation
```

## Conclusion

The deployment target is not just "Kubernetes runs the app." The target is a repeatable release workflow with staging validation and evidence that a specific image tag is safe enough to promote.
