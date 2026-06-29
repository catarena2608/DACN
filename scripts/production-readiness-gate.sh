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
RUN_K6_SUITE="${RUN_K6_SUITE:-${RUN_LOAD_SUITE:-false}}"
RUN_LOAD_TEST="${RUN_LOAD_TEST:-false}"
RUN_1K_LOAD="${RUN_1K_LOAD:-false}"
RUN_10K_LOAD="${RUN_10K_LOAD:-false}"
RUN_SPIKE_LOAD="${RUN_SPIKE_LOAD:-false}"
RUN_SOAK_LOAD="${RUN_SOAK_LOAD:-false}"
RUN_OBSERVABILITY_EVIDENCE="${RUN_OBSERVABILITY_EVIDENCE:-auto}"
LOAD_TEST_PROFILE="${LOAD_TEST_PROFILE:-1k}"
LOAD_RECOVERY_WAIT="${LOAD_RECOVERY_WAIT:-60}"
TEST_RUN_ID="${TEST_RUN_ID:-staging-$(date -u +%Y%m%dT%H%M%SZ)}"
TEST_START_EPOCH=""
TEST_END_EPOCH=""

GRAFANA_BASE_URL="${GRAFANA_BASE_URL:-http://grafana.dacn.local}"
GRAFANA_NAMESPACE_DASHBOARD_UID="${GRAFANA_NAMESPACE_DASHBOARD_UID:-k8s-resources-namespace}"
JAEGER_BASE_URL="${JAEGER_BASE_URL:-http://jaeger.dacn.local}"
KIBANA_BASE_URL="${KIBANA_BASE_URL:-http://kibana.dacn.local}"
SEND_SUMMARY_EMAIL="${SEND_SUMMARY_EMAIL:-false}"

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
  RUN_K6_SUITE=true|false         run k6 smoke, load, spike, and soak in one gate
  RUN_LOAD_TEST=true|false        run LOAD_TEST_PROFILE, default false
  LOAD_TEST_PROFILE=1k|10k        default 1k
  RUN_1K_LOAD=true|false          default false
  RUN_10K_LOAD=true|false         default false
  RUN_SPIKE_LOAD=true|false       default false
  RUN_SOAK_LOAD=true|false        default false
  RUN_OBSERVABILITY_EVIDENCE=auto|true|false
                                    auto enables collection when k6 runs
  LOAD_RECOVERY_WAIT=seconds      default 60

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

# Prerequisite gate: runs silently (not recorded in summary), aborts on failure.
require_step() {
  local name="$1"
  shift
  local log_file="$ARTIFACT_DIR/$(printf '%s' "$name" | tr ' /' '__' | tr -cd '[:alnum:]_.-').log"

  echo
  echo "==> $name"
  if "$@" >"$log_file" 2>&1; then
    echo "PASS $name"
  else
    echo "FAIL $name"
    echo "Log: $log_file"
    sed -n '1,120p' "$log_file" >&2 || true
    echo "Aborting: prerequisite '$name' failed." >&2
    exit 1
  fi
}

require_shell_step() {
  local name="$1"
  local command="$2"
  require_step "$name" bash -lc "$command"
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

truthy() {
  [[ "${1:-false}" == "true" || "${1:-false}" == "1" || "${1:-false}" == "yes" ]]
}

if truthy "$RUN_K6_SUITE"; then
  RUN_K6_SMOKE=true
  RUN_LOAD_TEST=true
  RUN_SPIKE_LOAD=true
  RUN_SOAK_LOAD=true
fi

if truthy "$RUN_LOAD_TEST"; then
  case "$LOAD_TEST_PROFILE" in
    1k) RUN_1K_LOAD=true ;;
    10k) RUN_10K_LOAD=true ;;
    *)
      echo "Unsupported LOAD_TEST_PROFILE=$LOAD_TEST_PROFILE. Use 1k or 10k." >&2
      exit 2
      ;;
  esac
fi

k6_requested() {
  truthy "$RUN_K6_SMOKE" || truthy "$RUN_1K_LOAD" || truthy "$RUN_10K_LOAD" || truthy "$RUN_SPIKE_LOAD" || truthy "$RUN_SOAK_LOAD"
}

if [[ "$RUN_OBSERVABILITY_EVIDENCE" == "auto" ]]; then
  if k6_requested; then
    RUN_OBSERVABILITY_EVIDENCE=true
  else
    RUN_OBSERVABILITY_EVIDENCE=false
  fi
fi

if [[ "$RUN_OBSERVABILITY_EVIDENCE" != "true" && "$RUN_OBSERVABILITY_EVIDENCE" != "false" ]]; then
  echo "RUN_OBSERVABILITY_EVIDENCE must be auto, true, or false." >&2
  exit 2
fi

k6_ingress_requested() {
  truthy "$RUN_1K_LOAD" || truthy "$RUN_10K_LOAD" || truthy "$RUN_SPIKE_LOAD" || truthy "$RUN_SOAK_LOAD"
}

k6_host_env() {
  if [[ -n "$STAGING_HOST" ]]; then
    printf "HOST_HEADER='%s'" "$STAGING_HOST"
  fi
}

k6_recovery_wait() {
  local previous_profile="$1"
  if [[ "$LOAD_RECOVERY_WAIT" == "0" ]]; then
    return 0
  fi

  require_shell_step "recovery wait after $previous_profile" \
    "sleep '$LOAD_RECOVERY_WAIT'; kubectl -n '$STAGING_NAMESPACE' wait --for=condition=Available deployment --all --timeout='$KUBE_WAIT_TIMEOUT'; kubectl -n '$STAGING_NAMESPACE' get pods -o wide"
}

run_k6_ingress_profile() {
  local profile="$1"
  local name="$2"
  local script_file="$3"
  local extra_env="${4:-}"
  local host_env
  host_env="$(k6_host_env)"

  run_shell_step "$name" \
    "cd '$ARTIFACT_DIR' && BASE_URL='${STAGING_URL%/}' $host_env TEST_RUN_ID='$TEST_RUN_ID' AUTH_EMAIL='$LOAD_AUTH_EMAIL' AUTH_PASSWORD='$LOAD_AUTH_PASSWORD' PRODUCT_ID='${PRODUCT_ID:-}' SUMMARY_FILE='staging-$profile-load-summary.json' $extra_env k6 run '$REPO_ROOT/tests/load/$script_file'"
}

gate_detail() {
  local name="$1"
  local status="$2"

  local json=""
  case "$name" in
    "k6 smoke profile")                 json="$ARTIFACT_DIR/staging-smoke-load-summary.json" ;;
    "k6 1k production-like load test")  json="$ARTIFACT_DIR/staging-1k-load-summary.json" ;;
    "k6 10k production-like load test") json="$ARTIFACT_DIR/staging-10k-load-summary.json" ;;
    "k6 spike load test")               json="$ARTIFACT_DIR/staging-spike-load-summary.json" ;;
    "k6 soak load test")                json="$ARTIFACT_DIR/staging-soak-load-summary.json" ;;
  esac

  if [[ -n "$json" && -f "$json" ]]; then
    jq -r '
      .metrics as $m |
      def ms(v): if v != null then ((v * 10 | round) / 10 | tostring) + "ms" else "n/a" end;
      def pct(v): if v != null then ((v * 10000 | round) / 100 | tostring) + "%" else "n/a" end;
      "p95=" + ms($m.http_req_duration.values["p(95)"]) + " " +
      "p99=" + ms($m.http_req_duration.values["p(99)"]) + " " +
      "err=" + pct($m.http_req_failed.values.rate) + " " +
      "checks=" + pct($m.checks.values.rate) + " " +
      "VUs=" + ($m.vus_max.values.value // "n/a" | tostring)
    ' "$json" 2>/dev/null || echo "(parse error)"
    return
  fi

  if [[ "$status" == "FAIL" ]]; then
    local log_file
    log_file="$ARTIFACT_DIR/$(printf '%s' "$name" | tr ' /' '__' | tr -cd '[:alnum:]_.-').log"
    if [[ -f "$log_file" ]]; then
      grep -m1 -Ev '^\s*$' "$log_file" | head -c 120 || true
    fi
  fi
}

write_summary() {
  local summary_file="$ARTIFACT_DIR/production-readiness-summary.md"
  {
    echo "# DACN Production Readiness Gate"
    echo
    echo "- **Timestamp:** $(date -Is)"
    echo "- **Staging namespace:** $STAGING_NAMESPACE"
    echo "- **Data namespace:** $DATA_NAMESPACE"
    echo "- **Observability namespace:** $OBSERVABILITY_NAMESPACE"
    echo "- **Expected image tag:** ${EXPECTED_IMAGE_TAG:-not enforced}"
    echo "- **Staging URL:** ${STAGING_URL:-not provided}"
    echo "- **Staging host header:** ${STAGING_HOST:-not provided}"
    echo "- **Test run ID:** $TEST_RUN_ID"
    echo "- **Artifact directory:** $ARTIFACT_DIR"
    echo
    echo "## Results"
    echo
    echo "| Status | Gate | Detail |"
    echo "| --- | --- | --- |"
    local result status name detail log_file
    for result in "${RESULTS[@]:-}"; do
      status="${result%%|*}"
      name="${result#*|}"
      detail="$(gate_detail "$name" "$status" | tr '|' '/' | head -1)"
      echo "| $status | $name | $detail |"
    done
    echo
    if [[ "$FAILED_STEPS" -gt 0 ]]; then
      echo "## Failed Gate Details"
      echo
      for result in "${RESULTS[@]:-}"; do
        status="${result%%|*}"
        name="${result#*|}"
        if [[ "$status" == "FAIL" ]]; then
          log_file="$ARTIFACT_DIR/$(printf '%s' "$name" | tr ' /' '__' | tr -cd '[:alnum:]_.-').log"
          echo "### $name"
          echo
          if [[ -f "$log_file" ]]; then
            echo '```'
            head -40 "$log_file" || true
            echo '```'
          else
            echo "(no log file)"
          fi
          echo
        fi
      done
    fi
    local k6_summary
    local k6_summary_count=0
    for k6_summary in "$ARTIFACT_DIR"/staging-*-load-summary.json "$ARTIFACT_DIR"/staging-load-summary.json; do
      [[ -f "$k6_summary" ]] || continue
      if [[ "$k6_summary_count" -eq 0 ]]; then
        echo "## K6 Load Summary"
        echo
      fi
      k6_summary_count=$((k6_summary_count + 1))
      echo
      echo "### $(basename "$k6_summary")"
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
      ' "$k6_summary" \
        || echo "K6 summary was unavailable."
      echo
    done
    if [[ -f "$ARTIFACT_DIR/observability-evidence-summary.md" ]]; then
      echo "## Observability Evidence"
      echo
      sed -e '1d' -e 's/^## /### /' "$ARTIFACT_DIR/observability-evidence-summary.md"
      echo
    fi
    if [[ -n "${TEST_START_EPOCH:-}" && "${TEST_START_EPOCH:-0}" -gt 0 ]]; then
      local start_ms end_ms start_us end_us start_iso end_iso
      start_ms=$(( TEST_START_EPOCH * 1000 ))
      end_ms=$(( TEST_END_EPOCH * 1000 ))
      start_us=$(( TEST_START_EPOCH * 1000000 ))
      end_us=$(( TEST_END_EPOCH * 1000000 ))
      start_iso="$(date -u -d "@$TEST_START_EPOCH" +%Y-%m-%dT%H:%M:%S.000Z)"
      end_iso="$(date -u -d "@$TEST_END_EPOCH" +%Y-%m-%dT%H:%M:%S.000Z)"
      local grafana_base jaeger_base kibana_base staging_ip grafana_ns_uid jaeger_tags_param
      grafana_base="${GRAFANA_BASE_URL:-http://grafana.dacn.local}"
      jaeger_base="${JAEGER_BASE_URL:-http://jaeger.dacn.local}"
      kibana_base="${KIBANA_BASE_URL:-http://kibana.dacn.local}"
      grafana_ns_uid="${GRAFANA_NAMESPACE_DASHBOARD_UID:-k8s-resources-namespace}"
      staging_ip="${STAGING_URL:-}"
      staging_ip="${staging_ip#http://}"
      staging_ip="${staging_ip#https://}"
      staging_ip="${staging_ip%%/*}"
      # Jaeger 1.55+ expects tags as URL-encoded JSON, not logfmt (key=value)
      jaeger_tags_param="%7B%22test_run_id%22%3A%22${TEST_RUN_ID}%22%7D"

      echo "## Observability UI"
      echo
      if [[ -n "$staging_ip" ]]; then
        echo "> **Để mở các link bên dưới**, thêm vào \`/etc/hosts\` trên máy local:"
        echo "> \`$staging_ip  grafana.dacn.local jaeger.dacn.local kibana.dacn.local\`"
        echo
      fi
      echo "| UI | Link |"
      echo "| --- | --- |"
      echo "| Grafana — metrics | [Kubernetes Namespace Pods (time-scoped)](${grafana_base}/d/${grafana_ns_uid}?var-datasource=default&var-namespace=${STAGING_NAMESPACE}&from=${start_ms}&to=${end_ms}) |"
      echo "| Jaeger — traces | [Search traces for \`${TEST_RUN_ID}\`](${jaeger_base}/search?service=gateway-service&tags=${jaeger_tags_param}&start=${start_us}&end=${end_us}&limit=100) |"
      echo "| Kibana — logs | [Filter logs for \`${TEST_RUN_ID}\`](${kibana_base}/app/discover#/?_g=(time:(from:'${start_iso}',to:'${end_iso}'))&_a=(query:(language:kuery,query:'fields.testRunId:\"${TEST_RUN_ID}\"'))) |"
      echo
      echo "**Credentials:**"
      echo
      echo "| UI | Username | Password |"
      echo "| --- | --- | --- |"
      echo "| Grafana | \`admin\` | \`dacn-lab-admin\` |"
      echo "| Jaeger | — | không yêu cầu xác thực |"
      echo "| Kibana | — | không yêu cầu xác thực |"
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

if k6_requested; then
  require_command k6
fi

if [[ -n "$EXPECTED_IMAGE_TAG" ]] && is_placeholder_value "$EXPECTED_IMAGE_TAG"; then
  echo "EXPECTED_IMAGE_TAG is still a placeholder: $EXPECTED_IMAGE_TAG" >&2
  echo "Read the real image tag from the running staging deployments before running the gate." >&2
  exit 2
fi

if [[ "$RUN_CONTRACT" == "true" || "$RUN_INTEGRATION" == "true" ]] || k6_requested; then
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

if k6_ingress_requested && [[ -z "$STAGING_URL" ]]; then
  echo "STAGING_URL is required when RUN_1K_LOAD=true, RUN_10K_LOAD=true, RUN_SPIKE_LOAD=true, or RUN_SOAK_LOAD=true." >&2
  echo "Use the production-like ingress URL, not a local port-forward." >&2
  exit 2
fi

echo "Artifacts will be written to: $ARTIFACT_DIR"

require_step "kubectl readyz" kubectl get --raw=/readyz
require_step "nodes ready" kubectl wait --for=condition=Ready node --all --timeout="$KUBE_WAIT_TIMEOUT"
require_step "capture nodes" kubectl get nodes -o wide
require_step "capture flux helmreleases" flux get helmreleases -A
require_shell_step "staging helmrelease ready" \
  "kubectl -n '$STAGING_NAMESPACE' get helmrelease dacn -o json | jq -r '.status.conditions[]? | \"\(.type)=\(.status) \(.reason // \"\") \(.message // \"\")\"'; kubectl -n '$STAGING_NAMESPACE' get helmrelease dacn -o json | jq -e 'any(.status.conditions[]?; .type==\"Ready\" and .status==\"True\")'"

require_step "staging deployments available" \
  kubectl -n "$STAGING_NAMESPACE" wait --for=condition=Available deployment --all --timeout="$KUBE_WAIT_TIMEOUT"
require_step "data pods ready" \
  kubectl -n "$DATA_NAMESPACE" wait --for=condition=Ready pod --all --timeout="$KUBE_WAIT_TIMEOUT"
require_step "observability pods ready" \
  kubectl -n "$OBSERVABILITY_NAMESPACE" wait --for=condition=Ready pod --all --timeout="$KUBE_WAIT_TIMEOUT"

require_step "capture staging resources" kubectl -n "$STAGING_NAMESPACE" get deploy,rs,pods,svc,ingress,hpa -o wide
require_shell_step "capture app images" \
  "kubectl -n '$STAGING_NAMESPACE' get deploy -o json | jq -r '.items[] | .metadata.name as \$deploy | .spec.template.spec.containers[] | \"\(\$deploy)\t\(.name)\t\(.image)\"'"
require_shell_step "capture app restart baseline" \
  "kubectl -n '$STAGING_NAMESPACE' get pods -o json | jq '[.items[].status.containerStatuses[]?.restartCount] | add // 0' | tee '$APP_RESTART_BASELINE_FILE'"
require_step "capture data resources" kubectl -n "$DATA_NAMESPACE" get pods,svc -o wide
require_step "capture observability resources" kubectl -n "$OBSERVABILITY_NAMESPACE" get pods,svc -o wide
require_step "capture recent staging events" kubectl -n "$STAGING_NAMESPACE" get events --sort-by=.lastTimestamp

if [[ -n "$EXPECTED_IMAGE_TAG" ]]; then
  require_shell_step "expected image tag running" \
    "kubectl -n '$STAGING_NAMESPACE' get deploy -o json | jq -e --arg tag '$EXPECTED_IMAGE_TAG' '[.items[].spec.template.spec.containers[].image] | length > 0 and all(contains(\$tag))'"
fi

if [[ -n "$STAGING_URL" ]]; then
  host_flag=""
  if [[ -n "$STAGING_HOST" ]]; then
    host_flag="-H 'Host: $STAGING_HOST'"
  fi

  require_shell_step "ingress smoke root" "curl -fsS --max-time 15 $host_flag '${STAGING_URL%/}/' >/dev/null"
  require_shell_step "ingress smoke gateway health" "curl -fsS --max-time 15 $host_flag '${STAGING_URL%/}/api/health' >/dev/null"
  require_shell_step "ingress smoke auth health" "curl -fsS --max-time 15 $host_flag '${STAGING_URL%/}/api/auth/health' >/dev/null"
  require_shell_step "ingress smoke products health" "curl -fsS --max-time 15 $host_flag '${STAGING_URL%/}/api/products/health' >/dev/null"
fi

if [[ "$RUN_NODE_TESTS" == "true" ]]; then
  if start_port_forward gateway "$STAGING_NAMESPACE" svc/gateway "$GATEWAY_LOCAL_PORT" 3000 &&
     start_port_forward auth "$STAGING_NAMESPACE" svc/auth "$AUTH_LOCAL_PORT" 3001 &&
     start_port_forward product "$STAGING_NAMESPACE" svc/product "$PRODUCT_LOCAL_PORT" 3002 &&
     start_port_forward order "$STAGING_NAMESPACE" svc/order "$ORDER_LOCAL_PORT" 3003 &&
     start_port_forward frontend "$STAGING_NAMESPACE" svc/frontend "$FRONTEND_LOCAL_PORT" 80; then
    echo
    echo "PASS open app service port-forwards"
  else
    echo "FAIL open app service port-forwards" >&2
    echo "Aborting: prerequisite 'open app service port-forwards' failed." >&2
    exit 1
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

if k6_requested; then
  TEST_START_EPOCH="$(date +%s)"
  echo "Starting k6 test window: run_id=$TEST_RUN_ID epoch=$TEST_START_EPOCH"
fi

if [[ "$RUN_K6_SMOKE" == "true" ]]; then
  if ensure_gateway_port_forward; then
    echo
    echo "PASS open gateway port-forward for k6 smoke"
  else
    echo "FAIL open gateway port-forward for k6 smoke" >&2
    echo "Aborting: prerequisite 'open gateway port-forward for k6 smoke' failed." >&2
    exit 1
  fi

  run_shell_step "k6 smoke profile" \
    "cd '$ARTIFACT_DIR' && BASE_URL='http://127.0.0.1:$GATEWAY_LOCAL_PORT' TEST_RUN_ID='$TEST_RUN_ID' AUTH_EMAIL='$LOAD_AUTH_EMAIL' AUTH_PASSWORD='$LOAD_AUTH_PASSWORD' SUMMARY_FILE='staging-smoke-load-summary.json' k6 run '$REPO_ROOT/tests/load/smoke.js'"

  if k6_ingress_requested; then
    k6_recovery_wait "k6 smoke profile"
  fi
fi

if [[ "$RUN_1K_LOAD" == "true" ]]; then
  run_k6_ingress_profile "1k" "k6 1k production-like load test" "load.js" "LOAD_TEST_PROFILE='1k'"

  if [[ "$RUN_10K_LOAD" == "true" || "$RUN_SPIKE_LOAD" == "true" || "$RUN_SOAK_LOAD" == "true" ]]; then
    k6_recovery_wait "k6 1k load test"
  fi
fi

if [[ "$RUN_10K_LOAD" == "true" ]]; then
  run_k6_ingress_profile "10k" "k6 10k production-like load test" "load.js" "LOAD_TEST_PROFILE='10k'"

  if [[ "$RUN_SPIKE_LOAD" == "true" || "$RUN_SOAK_LOAD" == "true" ]]; then
    k6_recovery_wait "k6 10k load test"
  fi
fi

if [[ "$RUN_SPIKE_LOAD" == "true" ]]; then
  run_k6_ingress_profile "spike" "k6 spike load test" "spike.js" "SPIKE_TARGET='${SPIKE_TARGET:-1000}'"

  if [[ "$RUN_SOAK_LOAD" == "true" ]]; then
    k6_recovery_wait "k6 spike test"
  fi
fi

if [[ "$RUN_SOAK_LOAD" == "true" ]]; then
  run_k6_ingress_profile "soak" "k6 soak load test" "soak.js" "SOAK_TARGET='${SOAK_TARGET:-300}' SOAK_DURATION='${SOAK_DURATION:-30m}'"
fi

if k6_requested; then
  TEST_END_EPOCH="$(date +%s)"
  echo "Finished k6 test window: run_id=$TEST_RUN_ID epoch=$TEST_END_EPOCH"
fi

if [[ "$RUN_OBSERVABILITY_EVIDENCE" == "true" ]]; then
  if [[ -z "$TEST_START_EPOCH" || -z "$TEST_END_EPOCH" ]]; then
    echo "Observability evidence requires at least one k6 profile." >&2
    record_result "FAIL" "automated observability evidence"
    FAILED_STEPS=$((FAILED_STEPS + 1))
  else
    run_step "automated observability evidence" env \
      OBSERVABILITY_NAMESPACE="$OBSERVABILITY_NAMESPACE" \
      STAGING_NAMESPACE="$STAGING_NAMESPACE" \
      ARTIFACT_DIR="$ARTIFACT_DIR" \
      TEST_RUN_ID="$TEST_RUN_ID" \
      TEST_START_EPOCH="$TEST_START_EPOCH" \
      TEST_END_EPOCH="$TEST_END_EPOCH" \
      "$REPO_ROOT/scripts/collect-observability-evidence.sh"
  fi
fi

run_shell_step "app restart budget during validation" \
  "baseline=\$(cat '$APP_RESTART_BASELINE_FILE'); current=\$(kubectl -n '$STAGING_NAMESPACE' get pods -o json | jq '[.items[].status.containerStatuses[]?.restartCount] | add // 0'); delta=\$((current - baseline)); echo \"baseline=\$baseline current=\$current delta=\$delta max=$MAX_APP_RESTARTS\"; test \"\$delta\" -le '$MAX_APP_RESTARTS'"
run_shell_step "no app OOMKilled containers" \
  "kubectl -n '$STAGING_NAMESPACE' get pods -o json | jq -e '[.items[].status.containerStatuses[]? | select((.lastState.terminated.reason // \"\") == \"OOMKilled\" or (.state.terminated.reason // \"\") == \"OOMKilled\")] | length == 0'"

write_summary

if [[ "${SEND_SUMMARY_EMAIL:-false}" == "true" ]]; then
  python3 "$REPO_ROOT/scripts/send-gate-summary-email.py" \
    "$ARTIFACT_DIR/production-readiness-summary.md" \
    || echo "Warning: email sending failed (non-fatal)" >&2
fi

if [ "$FAILED_STEPS" -ne 0 ]; then
  exit 1
fi

echo "Production readiness gate passed."
