# Scripts

Repository automation scripts will live here.

Examples:

```text
local bootstrap helpers
test runners
report generators
release utilities
```

## Current scripts

```text
update-gitops-staging.sh
production-readiness-gate.sh
collect-observability-evidence.sh
```

`update-gitops-staging.sh` is used by `.github/workflows/ci-main.yml` after image push. It updates `apps/dacn/staging/helmrelease.yaml` in the checked-out `dacn-gitops` repository so FluxCD can deploy the new immutable image tag to staging.

`production-readiness-gate.sh` runs the staging production gate. It checks Kubernetes/Flux health, app/data/observability readiness, smoke tests, contract tests, integration tests, restart/OOM conditions, and optional k6 load tests. When any k6 profile runs, automated observability evidence collection is enabled by default.

`collect-observability-evidence.sh` queries Prometheus, Elasticsearch, and Jaeger for the exact k6 time window. It verifies that metrics, correlated application logs, and cross-service traces exist, then writes raw JSON and `observability-evidence-summary.md` into the gate artifact directory.

Artifacts are written to `reports/production-gate/<timestamp>/`.
