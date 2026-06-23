# CI Workflows

| Workflow | Purpose |
| --- | --- |
| `ci-main.yml` | Fast staging-candidate gate: build, service tests, Docker Compose boot/smoke, push images to GHCR |
| `ci-auth.yml`, `ci-product.yml`, `ci-order.yml`, `ci-gateway.yml`, `ci-frontend.yml` | Focused CI per app/service on `develop` |
| `security.yml` | Secret scan, non-blocking npm audit report, SonarQube |

GitHub Actions does not deploy directly to Kubernetes. CD is owned by FluxCD, which reconciles the cluster from Git state. Production should use the same image tag that passed staging validation.

Deep system validation such as contract tests, integration tests, production-readiness gates, and k6 spike/soak/load profiles belongs to the CD/staging gate after FluxCD has reconciled staging. This keeps the image pipeline fast while still allowing staging to reject unhealthy releases.
