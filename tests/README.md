# Tests

Cross-service and system-level tests live here.

```text
load/          k6 load tests
smoke/         endpoint health and basic flow checks
integration/   multi-service integration tests
contract/      API contract tests
```

## Production Gate

Use the production-readiness gate after an image tag has been deployed to staging:

```bash
cd <application-repository>
export KUBECONFIG=<path-to-kubeconfig>
export EXPECTED_IMAGE_TAG="sha-xxxxxxx"
export SEED_EMAIL="<staging-test-user>"
export SEED_PASSWORD="<staging-test-password>"

scripts/production-readiness-gate.sh
```

The gate runs Kubernetes/Flux checks, service readiness checks, smoke tests, contract tests, integration tests, and optional k6 tests. The k6 files are split into smoke, load, spike, and soak scenarios. See `docs/production-readiness-gate.md`.
