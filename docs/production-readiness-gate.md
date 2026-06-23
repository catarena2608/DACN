# Production Readiness Gate

This runbook turns the project goal into an executable release decision. A release is not considered production-ready because it was deployed once; it is production-ready only when the same image tag produces enough evidence in staging.

## Decision Rule

```text
Promote only when every required gate passes.
Do not promote when any required gate fails.
If a gate is skipped, the final decision must say "pass with missing evidence", not "production-ready".
```

The gate validates four layers:

```text
CI artifact quality
GitOps and Kubernetes runtime health
Application functional correctness
Performance and stability under load
```

## Required Evidence

| Gate | Evidence | Production decision |
| --- | --- | --- |
| CI and image build | GitHub Actions passed and image tag exists in GHCR | Required |
| GitOps sync | Flux sources and HelmRelease are Ready | Required |
| Runtime health | Nodes, data layer, app pods, and observability pods are Ready | Required |
| Smoke tests | Frontend, gateway, auth, product, order health endpoints pass | Required |
| Contract tests | API response shapes match frontend/service expectations | Required |
| Integration tests | Auth, product, order, and rollback flows pass | Required |
| Restart/OOM check | No app restarts or OOMKilled containers during validation | Required |
| Load test | k6 thresholds pass for the chosen target profile | Required for production claim |
| Observability | Grafana/Prometheus/Kibana/Jaeger are reachable and data is visible | Required for operational readiness |

## Run The Gate

The Kubernetes cluster is assumed to already exist. From the application repository, point `kubectl` to any kubeconfig that can access the staging cluster:

```bash
cd <application-repository>
export KUBECONFIG=<path-to-kubeconfig>
export EXPECTED_IMAGE_TAG="sha-xxxxxxx"
export SEED_EMAIL="<staging-test-user>"
export SEED_PASSWORD="<staging-test-password>"

scripts/production-readiness-gate.sh
```

The script writes artifacts to:

```text
reports/production-gate/<timestamp>/
```

The most important file is:

```text
production-readiness-summary.md
```

## Optional Ingress Smoke

If the staging host is exposed through an Ingress Controller, test the ingress path too:

```bash
export STAGING_URL="http://<staging-ingress-ip-or-domain>"
export STAGING_HOST="staging.dacn.local"
scripts/production-readiness-gate.sh
```

The script sends the `Host: staging.dacn.local` header, so `/etc/hosts` is not required for this automated check.

## Optional k6 Smoke Profile

Run a small k6 smoke load through the gateway port-forward:

```bash
RUN_K6_SMOKE=true scripts/production-readiness-gate.sh
```

This proves the k6 script, login setup, and authenticated read path work before running the larger test.

This step requires `k6` on the machine running the gate.

## Production-Like 10,000 VU Test

Run this only after smoke, contract, integration, Flux, and pod stability gates pass:

```bash
export STAGING_URL="http://<staging-ingress-ip-or-domain>"
export STAGING_HOST="staging.dacn.local"
export EXPECTED_IMAGE_TAG="sha-xxxxxxx"
export SEED_EMAIL="<staging-test-user>"
export SEED_PASSWORD="<staging-test-password>"
RUN_10K_LOAD=true scripts/production-readiness-gate.sh
```

## Spike And Soak Profiles

Spike testing increases load suddenly to check whether the gateway, services, and Kubernetes runtime recover without errors or restarts.

```bash
export STAGING_URL="http://<staging-ingress-ip-or-domain>"
export STAGING_HOST="staging.dacn.local"
export EXPECTED_IMAGE_TAG="sha-xxxxxxx"
export SEED_EMAIL="<staging-test-user>"
export SEED_PASSWORD="<staging-test-password>"
RUN_SPIKE_LOAD=true SPIKE_TARGET=1000 scripts/production-readiness-gate.sh
```

Soak testing is the long-running reliability test. It keeps steady load for a longer period to detect memory leaks, restart drift, latency drift, and resource saturation.

```bash
export STAGING_URL="http://<staging-ingress-ip-or-domain>"
export STAGING_HOST="staging.dacn.local"
export EXPECTED_IMAGE_TAG="sha-xxxxxxx"
export SEED_EMAIL="<staging-test-user>"
export SEED_PASSWORD="<staging-test-password>"
RUN_SOAK_LOAD=true SOAK_TARGET=300 SOAK_DURATION=30m scripts/production-readiness-gate.sh
```

Defaults:

```text
spike: 100 -> 1,000 VUs, hold 2 minutes, then ramp down
soak: 300 VUs for 30 minutes, then ramp down
```

Thresholds are defined in `tests/load/staging-10000-users.js`:

```text
http_req_failed < 1%
p95 latency < 800ms
p99 latency < 1500ms
checks pass rate > 99%
```

For a lower-cost benchmark, use:

```bash
BASE_URL="http://<staging-ingress-ip-or-domain>" \
HOST_HEADER="staging.dacn.local" \
AUTH_EMAIL="$SEED_EMAIL" \
AUTH_PASSWORD="$SEED_PASSWORD" \
LOAD_PROFILE=baseline \
k6 run tests/load/staging-10000-users.js
```

## Manual Verification

Cluster state:

```bash
kubectl get nodes -o wide
kubectl -n dacn-staging get deploy,pods,svc,ingress,hpa
kubectl -n data get pods
kubectl -n observability get pods
flux get helmreleases -A
```

Application smoke through ingress:

```bash
curl -H "Host: staging.dacn.local" http://<staging-ingress-ip-or-domain>/
curl -H "Host: staging.dacn.local" http://<staging-ingress-ip-or-domain>/api/health
curl -H "Host: staging.dacn.local" http://<staging-ingress-ip-or-domain>/api/auth/health
curl -H "Host: staging.dacn.local" http://<staging-ingress-ip-or-domain>/api/products/health
```

Observability UI:

```bash
kubectl -n observability port-forward svc/kube-prometheus-stack-grafana 3000:80
kubectl -n observability port-forward svc/kibana 5601:5601
kubectl -n observability port-forward svc/jaeger-query 16686:16686
```

Open:

```text
Grafana     http://localhost:3000
Kibana      http://localhost:5601
Jaeger      http://localhost:16686
```

If direct Prometheus access is needed, find the Prometheus service name and port-forward it:

```bash
kubectl -n observability get svc | grep prometheus
kubectl -n observability port-forward svc/<prometheus-service-name> 9090:<prometheus-service-port>
```

## Promotion Criteria

The final answer may be:

```text
Production-ready: all required gates passed, 10k load thresholds passed, observability verified.
Not production-ready: one or more required gates failed.
Conditionally ready: functional gates passed, but load or observability evidence is missing.
```

For this project, a full production-ready claim requires:

```text
same immutable image tag tested in staging
FluxCD Ready state
all staging deployments Available
data and observability layers Ready
smoke, contract, and integration tests passed
no app restarts or OOMKilled containers during validation
k6 10,000 VU thresholds passed
rollback/promotion procedure documented
```

## Notes

The gate intentionally uses staging test accounts and staging data. Do not run the integration tests against real production data because they create and delete test products/orders.
