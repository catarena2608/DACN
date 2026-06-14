# CI Workflows

| Workflow | Purpose |
| --- | --- |
| `ci-main.yml` | Build, test, audit, Docker Compose smoke test, push images to GHCR |
| `ci-auth.yml`, `ci-product.yml`, `ci-order.yml`, `ci-gateway.yml`, `ci-frontend.yml` | Focused CI per app/service on `develop` |
| `security.yml` | Secret scan, non-blocking npm audit report, SonarQube |
| `staging-validation.yml` | Helm validate, smoke test, k6 10k user validation against staging |

GitHub Actions does not deploy to Kubernetes. CD is owned by FluxCD, which will reconcile the cluster from Git state. Production should use the same image tag that passed staging validation.

`staging-validation.yml` accepts an optional `staging_host` input. Use it when the staging URL is an ingress IP but Traefik routes by host name, for example `staging.dacn.local`.
