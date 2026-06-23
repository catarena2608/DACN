# CI Workflows

| Workflow | Purpose |
| --- | --- |
| `ci-main.yml` | Fast staging-candidate gate: Gitleaks, build, service tests, npm audit, Docker Compose boot/smoke, push changed images to GHCR |
| `ci-auth.yml`, `ci-product.yml`, `ci-order.yml`, `ci-gateway.yml`, `ci-frontend.yml` | Focused CI per app/service on `develop`, including npm audit |

GitHub Actions does not deploy directly to Kubernetes. CD is owned by FluxCD, which reconciles the cluster from Git state. Production should use the same image tag that passed staging validation.

On `main`, CI detects which container image paths changed. Only changed images are pushed to GHCR, and the GitOps staging HelmRelease is updated with service-specific image tags for those services.

Deep system validation such as contract tests, integration tests, production-readiness gates, and k6 spike/soak/load profiles belongs to the CD/staging gate after FluxCD has reconciled staging. This keeps the image pipeline fast while still allowing staging to reject unhealthy releases.
