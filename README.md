# dacn-app

This project focuses on deploying an e-commerce microservices application to Kubernetes with a staging-to-production workflow. The goal is to build a staging environment that is close enough to production, validate it with reliable tests, and promote only the same validated image tag to production.

GitHub Actions is responsible for CI: build, test, security scan, local smoke test, image build, and pushing images to GHCR. CD is handled by FluxCD, which reconciles the Kubernetes cluster from Git state.

The central argument of the project is that production performance and reliability are not the responsibility of Development or Operations alone. A release should reach users only when code, infrastructure, CI, GitOps, staging validation, and load testing all provide evidence that the image tag is safe enough.

This repository is the app repository. It contains source code, Dockerfiles, the Helm chart, CI workflows, test scripts, and technical documentation. Desired cluster state should live in a separate GitOps repository.

## Current System

| Component | Path | Role |
| --- | --- | --- |
| Frontend | `apps/frontend` | React + Vite web client |
| Gateway | `apps/gateway` | API gateway, routes `/api/*` to internal services |
| Auth service | `services/backend-auth` | Registration, login, JWT, refresh token |
| Product service | `services/backend-product` | Product catalog, Redis cache, stock RPC handling |
| Order service | `services/backend-order` | Order management, Product RPC through RabbitMQ |
| RabbitMQ | `deploy/compose`, `deploy/helm/dacn` | Message broker for order-product flow |
| Nginx | `deploy/nginx` | Local reverse proxy and basic rate limit |
| Helm chart | `deploy/helm/dacn` | Kubernetes application chart for Helm/FluxCD |
| Docker Compose | `deploy/compose` | Local full-stack runtime |
| Load tests | `tests/load` | k6 scripts, including the staging 10k-user scenario |
| Shared packages | `packages` | Future shared code area |
| Automation scripts | `scripts` | Helper scripts |
| Deployment plan | `docs/deployment-plan.md` | Lab, FluxCD, observability, and stack plan |
| Performance plan | `docs/performance-evaluation.md` | Performance evaluation and production readiness criteria |
| DevOps readiness | `docs/devops-production-readiness.md` | Shared Dev/Ops responsibility and quality gate |
| Production gate | `docs/production-readiness-gate.md` | Executable staging validation and PASS/FAIL release decision |

Payment, full observability, ranking, and admin services are roadmap items. Order and RabbitMQ already exist in source/deployment assets for the current order flow.

## Repository Structure

```text
apps/
  frontend/
  gateway/

services/
  backend-auth/
  backend-product/
  backend-order/

packages/
deploy/
  compose/
  helm/dacn/
  nginx/

scripts/
tests/
  load/
  smoke/
  integration/
  contract/

docs/
  architecture/
  assets/
  runbooks/
  archive/
```

## Environments

| Environment | Purpose | Main config | Deployment |
| --- | --- | --- | --- |
| Local | Developer machine | `deploy/compose/docker-compose.yml`, `.env.dev` | Docker Compose |
| Dev Kubernetes | Internal Helm validation | `values.yaml` + `values-dev.yaml` | Manual or Flux |
| Staging | Production-like validation gate | `values.yaml` + `values-staging.yaml` | FluxCD |
| Production | End-user environment | `values.yaml` + `values-prod.yaml` | FluxCD + approval |

## Run Locally

Create local env files from examples:

```bash
cp services/backend-auth/.env.example services/backend-auth/.env.dev
cp services/backend-product/.env.example services/backend-product/.env.dev
cp services/backend-order/.env.example services/backend-order/.env.dev
cp apps/gateway/.env.example apps/gateway/.env.dev
cp apps/frontend/.env.example apps/frontend/.env.dev
```

Run the full stack:

```bash
docker compose -f deploy/compose/docker-compose.yml up --build
```

Main endpoints:

```text
Frontend:       http://localhost
Gateway:        http://localhost:3000
Auth health:    http://localhost/api/auth/health
Product health: http://localhost/api/products/health
Order health:   http://localhost/api/order/health
```

## Helm And FluxCD

Full lab deployment details:

```text
docs/deployment-plan.md
```

Main chart:

```text
deploy/helm/dacn
```

Environment values:

```text
values.yaml           # Shared base, no real secrets
values-dev.yaml       # Dev Kubernetes
values-staging.yaml   # Staging, external data services
values-prod.yaml      # Production, external data services, TLS
```

GitHub Actions does not run `helm upgrade` against the cluster. FluxCD watches Git state and reconciles staging/production.

Render staging locally:

```bash
helm template dacn ./deploy/helm/dacn \
  -f ./deploy/helm/dacn/values-staging.yaml \
  --set global.imageTag=sha-xxxxxxx
```

Target GitOps flow:

```text
CI build image -> push GHCR tag sha-xxxxxxx
Update GitOps staging imageTag=sha-xxxxxxx
FluxCD sync staging
Run staging validation
If validation passes: promote the same image tag to production GitOps state
FluxCD sync production
```

Updating GitOps state can be manual for the project demo or automated later with Flux Image Automation Controller.

## Secret Management

Do not commit `.env.dev`, passwords, tokens, kubeconfig files, or real database URIs.

The repository should keep only `.env.example`. Real secrets should be managed with:

```text
Kubernetes Secret
Flux SOPS/Sealed Secrets/External Secrets
GitHub Secrets for test credentials and k6 token
```

Example staging secrets:

```bash
kubectl -n dacn-staging create secret generic dacn-auth-staging-secrets \
  --from-literal=URI='mongodb://user:password@mongo-host:27017/auth_db' \
  --from-literal=JWT_SECRET='replace-me' \
  --from-literal=JWT_REFRESH_SECRET='replace-me'

kubectl -n dacn-staging create secret generic dacn-product-staging-secrets \
  --from-literal=URI='mongodb://user:password@mongo-host:27017/product_db' \
  --from-literal=RABBITMQ_URL='amqp://user:password@rabbitmq-host:5672'

kubectl -n dacn-staging create secret generic dacn-order-staging-secrets \
  --from-literal=URI='mongodb://user:password@mongo-host:27017/order_db' \
  --from-literal=RABBITMQ_URL='amqp://user:password@rabbitmq-host:5672'

kubectl -n dacn-staging create secret generic dacn-gateway-staging-secrets \
  --from-literal=JWT_SECRET='same-as-auth-jwt-secret'
```

Production uses separate secret names:

```text
dacn-auth-prod-secrets
dacn-product-prod-secrets
dacn-order-prod-secrets
dacn-gateway-prod-secrets
```

## CI And Staging Validation

| Workflow | Purpose |
| --- | --- |
| `.github/workflows/ci-main.yml` | Build, test, audit, Docker Compose smoke test, push images to GHCR |
| `.github/workflows/security.yml` | Gitleaks, npm audit, SonarQube |
| `.github/workflows/staging-validation.yml` | Helm render/lint, staging smoke test, k6 10k-user test |

There is no production deploy workflow in GitHub Actions. Production deployment belongs to FluxCD.

Recommended release flow:

```text
Pull request
  -> build/test/audit
  -> merge main
  -> build image + push GHCR
  -> FluxCD sync staging from GitOps state
  -> run staging validation
  -> if pass, promote image tag in production GitOps state
  -> FluxCD sync production
```

## Staging 10,000-User Validation

Detailed performance plan:

```text
docs/performance-evaluation.md
```

Main script:

```text
tests/load/staging-10000-users.js
```

Scenario:

```text
10 minutes ramp up to 10,000 virtual users
20 minutes hold at 10,000 virtual users
5 minutes ramp down
```

Thresholds:

```text
http_req_failed < 1%
p95 latency < 800ms
p99 latency < 1500ms
checks pass rate > 99%
```

Run through k6 Cloud in staging validation:

```text
.github/workflows/staging-validation.yml
```

Required secrets/variables:

```text
STAGING_TEST_EMAIL
STAGING_TEST_PASSWORD
K6_CLOUD_TOKEN
STAGING_PRODUCT_ID
```

When running `staging-validation.yml` manually, pass `staging_host` if the staging ingress is reached through an IP address but routes by host name, for example `staging.dacn.local`.

Running 10,000 real VUs from a single GitHub-hosted runner is not recommended. Use k6 Cloud or distributed/self-hosted load generators.

## Production Promotion

Production should use only an image tag that passed staging validation. Do not rebuild a separate production image.

With FluxCD, promotion should be a Git change:

```text
staging imageTag=sha-xxxxxxx passed
production imageTag=sha-xxxxxxx updated through PR/review
FluxCD detects the change
FluxCD reconciles production
```

For the project demo, production promotion can be presented as a manual PR into GitOps state. A complete system can later use Flux Image Automation Controller.

## Acceptance Criteria

A build is production-ready when:

```text
CI build/test pass
npm audit has no high/critical vulnerability
Docker Compose smoke test passes
Helm render/lint passes
FluxCD syncs staging successfully
staging smoke test passes
production-readiness gate summary is PASS
k6 10k-user test meets thresholds
production image tag is promoted through GitOps review
```
