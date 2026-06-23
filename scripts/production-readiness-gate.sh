#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

STAGING_NAMESPACE="${STAGING_NAMESPACE:-dacn-staging}"
DATA_NAMESPACE="${DATA_NAMESPACE:-data}"
OBSERVABILITY_NAMESPACE="${OBSERVABILITY_NAMESPACE:-observability}"
ARTIFACT_ROOT="${ARTIFACT_ROOT:-$REPO_ROOT/reports/production-gate}"
ARTIFACT_DIR="${ARTIFACT_DIR:-$ARTIFACT_ROOT/$(date +%Y%m%d-%H%M%S)}"
KUBE_WAIT_TIMEOUT="${KUBE_WAIT_TIMEOUT:-300s}"
MAX_APP_RESTARTS="${MAX_APP_RESTARTS:-0}"

RUN_NODE_TESTS="${RUN_NODE_TESTS:-true}"
RUN_CONTRACT="${RUN_CONTRACT:-true}"
RUN_INTEGRATION="${RUN_INTEGRATION:-true}"
RUN_K6_SMOKE="${RUN_K6_SMOKE:-false}"
RUN_1K_LOAD="${RUN_1K_LOAD:-false}"
RUN_10K_LOAD="${RUN_10K_LOAD:-false}"
RUN_SPIKE_LOAD="${RUN_SPIKE_LOAD:-false}"
RUN_SOAK_LOAD="${RUN_SOAK_LOAD:-false}"

EXPECTED_IMAGE_TAG="${EXPECTED_IMAGE_TAG:-}"
STAGING_URL="${STAGING_URL:-}"
STAGING_HOST="${STAGING_HOST:-staging.dacn.local}"
LOAD_AUTH_EMAIL="${LOAD_AUTH_EMAIL:-${AUTH_EMAIL:-${SEED_EMAIL:-}}}"
LOAD_AUTH_PASSWORD="${LOAD_AUTH_PASSWORD:-${AUTH_PASSWORD:-${SEED_PASSWORD:-}}}"

GATEWAY_LOCAL_PORT="${GATEWAY_LOCAL_PORT:-13000}"
AUTH_LOCAL_PORT="${AUTH_LOCAL_PORT:-13001}"
PRODUCT_LOCAL_PORT="${PRODUCT_LOCAL_PORT:-13002}"
ORDER_LOCAL_PORT="${ORDER_LOCAL_PORT:-13003}"
FRONTEND_LOCAL_PORT="${FRONTEND_LOCAL_PORT:-13080}"

APP_RESTART_BASELINE_FILE="$ARTIFACT_DIR/app-restart-baseline.txt"

FAILED_STEPS=0
RESULTS=()
PORT_FORWARD_PIDS=()

usage() {
  cat <<EOF
Usage:
  scripts/production-readiness-gate.sh

Important environment variables:
  KUBECONFIG=/path/to/kubeconfig
  STAGING_URL=http://<ingress-ip-or-domain>
  STAGING_HOST=staging.dacn.local
  EXPECTED_IMAGE_TAG=sha-xxxxxxx
  SEED_EMAIL=<test-user-email>
  SEED_PASSWORD=<test-user-password>

Optional switches:
  RUN_NODE_TESTS=true|false       default true
  RUN_CONTRACT=true|false         default true
  RUN_INTEGRATION=true|false      default true
  RUN_K6_SMOKE=true|false         default false
  RUN_1K_LOAD=true|false          default false
  RUN_10K_LOAD=true|false         default false
  RUN_SPIKE_LOAD=true|false       default false
  RUN_SOAK_LOAD=true|false        default false

Artifacts:
  ARTIFACT_DIR=$ARTIFACT_DIR
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

mkdir -p "$ARTIFACT_DIR"

cleanup() {
  local pid
  for pid in "${PORT_FORWARD_PIDS[@]:-}"; do
    if kill -0 "$pid" >/dev/null 2>&1; then
      kill "$pid" >/dev/null 2>&1 || true
    fi
  done
}
trap cleanup EXIT INT TERM

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Required command '$1' was not found in PATH." >&2
    exit 127
  fi
}

is_placeholder_value() {
  local value="$1"
  [[ "$value" == *"<"* ]] && return 0
  [[ "$value" == *">"* ]] && return 0
  [[ "$value" == "sha-xxxxxxx" ]] && return 0
  [[ "$value" == "YOUR_"* ]] && return 0
  [[ "$value" == "replace-me" ]] && return 0
  [[ "$value" == "changeme" ]] && return 0
  return 1
}

record_result() {
  local status="$1"
  local name="$2"
  RESULTS+=("$status|$name")
}

run_step() {
  local name="$1"
  shift
  local log_file="$ARTIFACT_DIR/$(printf '%s' "$name" | tr ' /' '__' | tr -cd '[:alnum:]_.-').log"

  echo
  echo "==> $name"
  if "$@" >"$log_file" 2>&1; then
    echo "PASS $name"
    record_result "PASS" "$name"
  else
    echo "FAIL $name"
    echo "Log: $log_file"
    sed -n '1,120p' "$log_file" >&2 || true
    record_result "FAIL" "$name"
    FAILED_STEPS=$((FAILED_STEPS + 1))
  fi
}

run_shell_step() {
  local name="$1"
  local command="$2"
  run_step "$name" bash -lc "$command"
}

wait_for_port() {
  local port="$1"
  local timeout_sec="${2:-30}"
  local elapsed=0

  until bash -c ":</dev/tcp/127.0.0.1/$port" >/dev/null 2>&1; do
    if [ "$elapsed" -ge "$timeout_sec" ]; then
      return 1
    fi
    sleep 1
    elapsed=$((elapsed + 1))
  done
}

start_port_forward() {
  local name="$1"
  local namespace="$2"
  local resource="$3"
  local local_port="$4"
  local remote_port="$5"
  local log_file="$ARTIFACT_DIR/port-forward-$name.log"

  kubectl -n "$namespace" get "$resource" >/dev/null
  kubectl -n "$namespace" port-forward "$resource" "$local_port:$remote_port" >"$log_file" 2>&1 &
  local pid="$!"
  PORT_FORWARD_PIDS+=("$pid")

  if ! wait_for_port "$local_port" 30; then
    echo "Port-forward failed for $name ($resource). Log: $log_file" >&2
    sed -n '1,80p' "$log_file" >&2 || true
    return 1
  fi
}

ensure_gateway_port_forward() {
  if bash -c ":</dev/tcp/127.0.0.1/$GATEWAY_LOCAL_PORT" >/dev/null 2>&1; then
    return 0
  fi

  start_port_forward gateway "$STAGING_NAMESPACE" svc/gateway "$GATEWAY_LOCAL_PORT" 3000
}

write_summary() {
  local summary_file="$ARTIFACT_DIR/production-readiness-summary.md"
  {
    echo "# DACN Production Readiness Gate"
    echo
    echo "- Timestamp: $(date -Is)"
    echo "- Staging namespace: $STAGING_NAMESPACE"
    echo "- Data namespace: $DATA_NAMESPACE"
    echo "- Observability namespace: $OBSERVABILITY_NAMESPACE"
    echo "- Expected image tag: ${EXPECTED_IMAGE_TAG:-not enforced}"
    echo "- Staging URL: ${STAGING_URL:-not provided}"
    echo "- Staging host header: ${STAGING_HOST:-not provided}"
    echo "- Artifact directory: $ARTIFACT_DIR"
    echo
    echo "## Results"
    echo
    echo "| Status | Gate |"
    echo "| --- | --- |"
    local result status name
    for result in "${RESULTS[@]:-}"; do
      status="${result%%|*}"
      name="${result#*|}"
      echo "| $status | $name |"
    done
    echo
    if [[ -f "$ARTIFACT_DIR/staging-load-summary.json" ]]; then
      echo "## K6 Load Summary"
      echo
      jq -r '
        .metrics as $m |
        [
          ["Metric", "Value"],
          ["---", "---"],
          ["Max VUs configured", (($m.vus_max.values.value // "n/a") | tostring)],
          ["Max VUs observed", (($m.vus.values.max // "n/a") | tostring)],
          ["HTTP requests", (($m.http_reqs.values.count // "n/a") | tostring)],
          ["Requests/sec", (($m.http_reqs.values.rate // 0) | tostring)],
          ["Iterations", (($m.iterations.values.count // "n/a") | tostring)],
          ["HTTP failure rate", (((($m.http_req_failed.values.rate // 0) * 100) | tostring) + "%")],
          ["Checks pass rate", (((($m.checks.values.rate // 0) * 100) | tostring) + "%")],
          ["Avg latency", ((($m.http_req_duration.values.avg // 0) | tostring) + " ms")],
          ["Median latency", ((($m.http_req_duration.values.med // 0) | tostring) + " ms")],
          ["p90 latency", ((($m.http_req_duration.values["p(90)"] // 0) | tostring) + " ms")],
          ["p95 latency", ((($m.http_req_duration.values["p(95)"] // 0) | tostring) + " ms")],
          ["Max latency", ((($m.http_req_duration.values.max // 0) | tostring) + " ms")],
          ["Threshold failed rate < 1%", (($m.http_req_failed.thresholds["rate<0.01"].ok // false) | tostring)],
          ["Threshold p95 < 800 ms", (($m.http_req_duration.thresholds["p(95)<800"].ok // false) | tostring)],
          ["Threshold p99 < 1500 ms", (($m.http_req_duration.thresholds["p(99)<1500"].ok // false) | tostring)],
          ["Threshold checks > 99%", (($m.checks.thresholds["rate>0.99"].ok // false) | tostring)]
        ] | .[] | "| \(.[0]) | \(.[1]) |"
      ' "$ARTIFACT_DIR/staging-load-summary.json" \
        || echo "K6 summary was unavailable."
      echo
    fi
    echo "## Tested Images"
    echo
    echo "| Deployment | Container | Image |"
    echo "| --- | --- | --- |"
    kubectl -n "$STAGING_NAMESPACE" get deploy -o json \
      | jq -r '.items[] | .metadata.name as $deploy | .spec.template.spec.containers[] | "| \($deploy) | \(.name) | \(.image) |"' \
      || echo "| unavailable | unavailable | unavailable |"
    echo
    if [ "$FAILED_STEPS" -eq 0 ]; then
      echo "## Decision"
      echo
      echo "PASS. The tested artifact is eligible for production promotion if the same image tag is promoted through GitOps."
    else
      echo "## Decision"
      echo
      echo "FAIL. Do not promote this artifact to production until the failed gates are fixed and rerun."
    fi
  } > "$summary_file"

  echo
  echo "Summary: $summary_file"
}

require_command kubectl
require_command jq
require_command curl
require_command flux
require_command node

if [[ "$RUN_K6_SMOKE" == "true" || "$RUN_1K_LOAD" == "true" || "$RUN_10K_LOAD" == "true" || "$RUN_SPIKE_LOAD" == "true" || "$RUN_SOAK_LOAD" == "true" ]]; then
  require_command k6
fi

if [[ -n "$EXPECTED_IMAGE_TAG" ]] && is_placeholder_value "$EXPECTED_IMAGE_TAG"; then
  echo "EXPECTED_IMAGE_TAG is still a placeholder: $EXPECTED_IMAGE_TAG" >&2
  echo "Read the real image tag from the running staging deployments before running the gate." >&2
  exit 2
fi

if [[ "$RUN_CONTRACT" == "true" || "$RUN_INTEGRATION" == "true" || "$RUN_K6_SMOKE" == "true" || "$RUN_1K_LOAD" == "true" || "$RUN_10K_LOAD" == "true" || "$RUN_SPIKE_LOAD" == "true" || "$RUN_SOAK_LOAD" == "true" ]]; then
  if [[ -z "${SEED_EMAIL:-}" || -z "${SEED_PASSWORD:-}" ]]; then
    echo "SEED_EMAIL and SEED_PASSWORD are required for contract/integration/load validation." >&2
    echo "Use a dedicated staging test account, not a real user account." >&2
    exit 2
  fi
  if is_placeholder_value "$SEED_EMAIL" || is_placeholder_value "$SEED_PASSWORD"; then
    echo "SEED_EMAIL or SEED_PASSWORD is still a placeholder." >&2
    echo "Use the real dedicated staging test account credentials." >&2
    exit 2
  fi
fi

if [[ "$RUN_1K_LOAD" == "true" || "$RUN_10K_LOAD" == "true" || "$RUN_SPIKE_LOAD" == "true" || "$RUN_SOAK_LOAD" == "true" ]] && [[ -z "$STAGING_URL" ]]; then
  echo "STAGING_URL is required when RUN_1K_LOAD=true, RUN_10K_LOAD=true, RUN_SPIKE_LOAD=true, or RUN_SOAK_LOAD=true." >&2
  echo "Use the production-like ingress URL, not a local port-forward." >&2
  exit 2
fi

echo "Artifacts will be written to: $ARTIFACT_DIR"

run_step "kubectl readyz" kubectl get --raw=/readyz
run_step "nodes ready" kubectl wait --for=condition=Ready node --all --timeout="$KUBE_WAIT_TIMEOUT"
run_step "capture nodes" kubectl get nodes -o wide
run_step "capture flux helmreleases" flux get helmreleases -A
run_shell_step "staging helmrelease ready" \
  "kubectl -n '$STAGING_NAMESPACE' get helmrelease dacn -o json | jq -r '.status.conditions[]? | \"\(.type)=\(.status) \(.reason // \"\") \(.message // \"\")\"'; kubectl -n '$STAGING_NAMESPACE' get helmrelease dacn -o json | jq -e 'any(.status.conditions[]?; .type==\"Ready\" and .status==\"True\")'"

run_step "staging deployments available" \
  kubectl -n "$STAGING_NAMESPACE" wait --for=condition=Available deployment --all --timeout="$KUBE_WAIT_TIMEOUT"
run_step "data pods ready" \
  kubectl -n "$DATA_NAMESPACE" wait --for=condition=Ready pod --all --timeout="$KUBE_WAIT_TIMEOUT"
run_step "observability pods ready" \
  kubectl -n "$OBSERVABILITY_NAMESPACE" wait --for=condition=Ready pod --all --timeout="$KUBE_WAIT_TIMEOUT"

run_step "capture staging resources" kubectl -n "$STAGING_NAMESPACE" get deploy,rs,pods,svc,ingress,hpa -o wide
run_shell_step "capture app images" \
  "kubectl -n '$STAGING_NAMESPACE' get deploy -o json | jq -r '.items[] | .metadata.name as \$deploy | .spec.template.spec.containers[] | \"\(\$deploy)\t\(.name)\t\(.image)\"'"
run_shell_step "capture app restart baseline" \
  "kubectl -n '$STAGING_NAMESPACE' get pods -o json | jq '[.items[].status.containerStatuses[]?.restartCount] | add // 0' | tee '$APP_RESTART_BASELINE_FILE'"
run_step "capture data resources" kubectl -n "$DATA_NAMESPACE" get pods,svc -o wide
run_step "capture observability resources" kubectl -n "$OBSERVABILITY_NAMESPACE" get pods,svc -o wide
run_step "capture recent staging events" kubectl -n "$STAGING_NAMESPACE" get events --sort-by=.lastTimestamp

if [[ -n "$EXPECTED_IMAGE_TAG" ]]; then
  run_shell_step "expected image tag running" \
    "kubectl -n '$STAGING_NAMESPACE' get deploy -o json | jq -e --arg tag '$EXPECTED_IMAGE_TAG' '[.items[].spec.template.spec.containers[].image] | length > 0 and all(contains(\$tag))'"
fi

if [[ -n "$STAGING_URL" ]]; then
  host_flag=""
  if [[ -n "$STAGING_HOST" ]]; then
    host_flag="-H 'Host: $STAGING_HOST'"
  fi

  run_shell_step "ingress smoke root" "curl -fsS --max-time 15 $host_flag '${STAGING_URL%/}/' >/dev/null"
  run_shell_step "ingress smoke gateway health" "curl -fsS --max-time 15 $host_flag '${STAGING_URL%/}/api/health' >/dev/null"
  run_shell_step "ingress smoke auth health" "curl -fsS --max-time 15 $host_flag '${STAGING_URL%/}/api/auth/health' >/dev/null"
  run_shell_step "ingress smoke products health" "curl -fsS --max-time 15 $host_flag '${STAGING_URL%/}/api/products/health' >/dev/null"
fi

if [[ "$RUN_NODE_TESTS" == "true" ]]; then
  if start_port_forward gateway "$STAGING_NAMESPACE" svc/gateway "$GATEWAY_LOCAL_PORT" 3000 &&
     start_port_forward auth "$STAGING_NAMESPACE" svc/auth "$AUTH_LOCAL_PORT" 3001 &&
     start_port_forward product "$STAGING_NAMESPACE" svc/product "$PRODUCT_LOCAL_PORT" 3002 &&
     start_port_forward order "$STAGING_NAMESPACE" svc/order "$ORDER_LOCAL_PORT" 3003 &&
     start_port_forward frontend "$STAGING_NAMESPACE" svc/frontend "$FRONTEND_LOCAL_PORT" 80; then
    record_result "PASS" "open app service port-forwards"
  else
    record_result "FAIL" "open app service port-forwards"
    FAILED_STEPS=$((FAILED_STEPS + 1))
  fi

  run_shell_step "frontend service smoke" "curl -fsS --max-time 15 'http://127.0.0.1:$FRONTEND_LOCAL_PORT/' >/dev/null"

  common_env="AUTH_URL='http://127.0.0.1:$AUTH_LOCAL_PORT' PRODUCT_URL='http://127.0.0.1:$PRODUCT_LOCAL_PORT' ORDER_URL='http://127.0.0.1:$ORDER_LOCAL_PORT' GATEWAY_URL='http://127.0.0.1:$GATEWAY_LOCAL_PORT' NGINX_URL='http://127.0.0.1:$GATEWAY_LOCAL_PORT'"
  run_shell_step "node smoke tests" "cd '$REPO_ROOT' && $common_env node --test tests/smoke/smoke.test.js"

  if [[ "$RUN_CONTRACT" == "true" ]]; then
    run_shell_step "node contract tests" "cd '$REPO_ROOT' && $common_env SEED_EMAIL='$SEED_EMAIL' SEED_PASSWORD='$SEED_PASSWORD' node --test tests/contract/contract.test.js"
  fi

  if [[ "$RUN_INTEGRATION" == "true" ]]; then
    run_shell_step "node integration tests" "cd '$REPO_ROOT' && $common_env SEED_EMAIL='$SEED_EMAIL' SEED_PASSWORD='$SEED_PASSWORD' node --test tests/integration/integration.test.js"
  fi
fi

if [[ "$RUN_K6_SMOKE" == "true" ]]; then
  if ensure_gateway_port_forward; then
    record_result "PASS" "open gateway port-forward for k6 smoke"
  else
    record_result "FAIL" "open gateway port-forward for k6 smoke"
    FAILED_STEPS=$((FAILED_STEPS + 1))
  fi

  run_shell_step "k6 smoke profile" \
    "cd '$ARTIFACT_DIR' && BASE_URL='http://127.0.0.1:$GATEWAY_LOCAL_PORT' AUTH_EMAIL='$LOAD_AUTH_EMAIL' AUTH_PASSWORD='$LOAD_AUTH_PASSWORD' LOAD_PROFILE=smoke k6 run '$REPO_ROOT/tests/load/staging-10000-users.js'"
fi

if [[ "$RUN_1K_LOAD" == "true" ]]; then
  host_env=""
  if [[ -n "$STAGING_HOST" ]]; then
    host_env="HOST_HEADER='$STAGING_HOST'"
  fi

  run_shell_step "k6 1k production-like load test" \
    "cd '$ARTIFACT_DIR' && BASE_URL='${STAGING_URL%/}' $host_env AUTH_EMAIL='$LOAD_AUTH_EMAIL' AUTH_PASSWORD='$LOAD_AUTH_PASSWORD' PRODUCT_ID='${PRODUCT_ID:-}' LOAD_PROFILE=1k k6 run '$REPO_ROOT/tests/load/staging-10000-users.js'"
fi

if [[ "$RUN_10K_LOAD" == "true" ]]; then
  host_env=""
  if [[ -n "$STAGING_HOST" ]]; then
    host_env="HOST_HEADER='$STAGING_HOST'"
  fi

  run_shell_step "k6 10k production-like load test" \
    "cd '$ARTIFACT_DIR' && BASE_URL='${STAGING_URL%/}' $host_env AUTH_EMAIL='$LOAD_AUTH_EMAIL' AUTH_PASSWORD='$LOAD_AUTH_PASSWORD' PRODUCT_ID='${PRODUCT_ID:-}' LOAD_PROFILE=10k k6 run '$REPO_ROOT/tests/load/staging-10000-users.js'"
fi

if [[ "$RUN_SPIKE_LOAD" == "true" ]]; then
  host_env=""
  if [[ -n "$STAGING_HOST" ]]; then
    host_env="HOST_HEADER='$STAGING_HOST'"
  fi

  run_shell_step "k6 spike load test" \
    "cd '$ARTIFACT_DIR' && BASE_URL='${STAGING_URL%/}' $host_env AUTH_EMAIL='$LOAD_AUTH_EMAIL' AUTH_PASSWORD='$LOAD_AUTH_PASSWORD' PRODUCT_ID='${PRODUCT_ID:-}' SPIKE_TARGET='${SPIKE_TARGET:-1000}' LOAD_PROFILE=spike k6 run '$REPO_ROOT/tests/load/staging-10000-users.js'"
fi

if [[ "$RUN_SOAK_LOAD" == "true" ]]; then
  host_env=""
  if [[ -n "$STAGING_HOST" ]]; then
    host_env="HOST_HEADER='$STAGING_HOST'"
  fi

  run_shell_step "k6 soak load test" \
    "cd '$ARTIFACT_DIR' && BASE_URL='${STAGING_URL%/}' $host_env AUTH_EMAIL='$LOAD_AUTH_EMAIL' AUTH_PASSWORD='$LOAD_AUTH_PASSWORD' PRODUCT_ID='${PRODUCT_ID:-}' SOAK_TARGET='${SOAK_TARGET:-300}' SOAK_DURATION='${SOAK_DURATION:-30m}' LOAD_PROFILE=soak k6 run '$REPO_ROOT/tests/load/staging-10000-users.js'"
fi

run_shell_step "app restart budget during validation" \
  "baseline=\$(cat '$APP_RESTART_BASELINE_FILE'); current=\$(kubectl -n '$STAGING_NAMESPACE' get pods -o json | jq '[.items[].status.containerStatuses[]?.restartCount] | add // 0'); delta=\$((current - baseline)); echo \"baseline=\$baseline current=\$current delta=\$delta max=$MAX_APP_RESTARTS\"; test \"\$delta\" -le '$MAX_APP_RESTARTS'"
run_shell_step "no app OOMKilled containers" \
  "kubectl -n '$STAGING_NAMESPACE' get pods -o json | jq -e '[.items[].status.containerStatuses[]? | select((.lastState.terminated.reason // \"\") == \"OOMKilled\" or (.state.terminated.reason // \"\") == \"OOMKilled\")] | length == 0'"

write_summary

if [ "$FAILED_STEPS" -ne 0 ]; then
  exit 1
fi

echo "Production readiness gate passed."
