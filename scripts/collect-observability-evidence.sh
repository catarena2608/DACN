#!/usr/bin/env bash
set -euo pipefail

OBSERVABILITY_NAMESPACE="${OBSERVABILITY_NAMESPACE:-observability}"
STAGING_NAMESPACE="${STAGING_NAMESPACE:-dacn-staging}"
ARTIFACT_DIR="${ARTIFACT_DIR:-$(pwd)/observability-evidence}"
TEST_RUN_ID="${TEST_RUN_ID:-}"
TEST_START_EPOCH="${TEST_START_EPOCH:-}"
TEST_END_EPOCH="${TEST_END_EPOCH:-}"
OBSERVABILITY_SETTLE_SECONDS="${OBSERVABILITY_SETTLE_SECONDS:-20}"
OBSERVABILITY_QUERY_RETRIES="${OBSERVABILITY_QUERY_RETRIES:-6}"
OBSERVABILITY_WINDOW_MARGIN_SECONDS="${OBSERVABILITY_WINDOW_MARGIN_SECONDS:-30}"

PROMETHEUS_SERVICE="${PROMETHEUS_SERVICE:-prometheus-kube-prometheus-stack-prometheus}"
ELASTICSEARCH_SERVICE="${ELASTICSEARCH_SERVICE:-elasticsearch}"
JAEGER_SERVICE="${JAEGER_SERVICE:-jaeger-query}"

PROMETHEUS_LOCAL_PORT="${PROMETHEUS_LOCAL_PORT:-19090}"
ELASTICSEARCH_LOCAL_PORT="${ELASTICSEARCH_LOCAL_PORT:-19200}"
JAEGER_LOCAL_PORT="${JAEGER_LOCAL_PORT:-16687}"
KIBANA_SERVICE="${KIBANA_SERVICE:-kibana}"
KIBANA_LOCAL_PORT="${KIBANA_LOCAL_PORT:-15601}"

PROMETHEUS_URL_PROVIDED=false
ELASTICSEARCH_URL_PROVIDED=false
JAEGER_URL_PROVIDED=false
if [[ -n "${PROMETHEUS_URL:-}" ]]; then PROMETHEUS_URL_PROVIDED=true; fi
if [[ -n "${ELASTICSEARCH_URL:-}" ]]; then ELASTICSEARCH_URL_PROVIDED=true; fi
if [[ -n "${JAEGER_URL:-}" ]]; then JAEGER_URL_PROVIDED=true; fi

PROMETHEUS_URL="${PROMETHEUS_URL:-http://127.0.0.1:$PROMETHEUS_LOCAL_PORT}"
ELASTICSEARCH_URL="${ELASTICSEARCH_URL:-http://127.0.0.1:$ELASTICSEARCH_LOCAL_PORT}"
JAEGER_URL="${JAEGER_URL:-http://127.0.0.1:$JAEGER_LOCAL_PORT}"

PORT_FORWARD_PIDS=()
FAILED_EVIDENCE=0
METRICS_STATUS="FAIL"
LOGS_STATUS="FAIL"
TRACES_STATUS="FAIL"

usage() {
  cat <<EOF
Usage:
  TEST_RUN_ID=<id> TEST_START_EPOCH=<seconds> TEST_END_EPOCH=<seconds> \\
    ARTIFACT_DIR=<directory> scripts/collect-observability-evidence.sh

The script queries Prometheus, Elasticsearch, and Jaeger for the exact staging
test window. It starts local kubectl port-forwards unless external URLs are set.
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

for command in curl jq date; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "Required command '$command' was not found." >&2
    exit 127
  fi
done

if [[ "$PROMETHEUS_URL_PROVIDED" == "false" ||
      "$ELASTICSEARCH_URL_PROVIDED" == "false" ||
      "$JAEGER_URL_PROVIDED" == "false" ]]; then
  if ! command -v kubectl >/dev/null 2>&1; then
    echo "Required command 'kubectl' was not found." >&2
    exit 127
  fi
fi

if [[ -z "$TEST_RUN_ID" || ! "$TEST_START_EPOCH" =~ ^[0-9]+$ || ! "$TEST_END_EPOCH" =~ ^[0-9]+$ ]]; then
  usage >&2
  exit 2
fi

if [[ ! "$TEST_RUN_ID" =~ ^staging-[A-Za-z0-9._:-]{1,80}$ ]]; then
  echo "TEST_RUN_ID must start with staging- and contain only safe identifier characters." >&2
  exit 2
fi

if (( TEST_END_EPOCH < TEST_START_EPOCH )); then
  echo "TEST_END_EPOCH must not be earlier than TEST_START_EPOCH." >&2
  exit 2
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

wait_for_port() {
  local port="$1"
  local elapsed=0

  until bash -c ":</dev/tcp/127.0.0.1/$port" >/dev/null 2>&1; do
    if (( elapsed >= 30 )); then
      return 1
    fi
    sleep 1
    elapsed=$((elapsed + 1))
  done
}

start_port_forward() {
  local name="$1"
  local service="$2"
  local local_port="$3"
  local remote_port="$4"
  local log_file="$ARTIFACT_DIR/port-forward-$name.log"

  if bash -c ":</dev/tcp/127.0.0.1/$local_port" >/dev/null 2>&1; then
    return 0
  fi

  kubectl -n "$OBSERVABILITY_NAMESPACE" get "svc/$service" >/dev/null
  kubectl -n "$OBSERVABILITY_NAMESPACE" port-forward "svc/$service" \
    "$local_port:$remote_port" >"$log_file" 2>&1 &
  PORT_FORWARD_PIDS+=("$!")

  if ! wait_for_port "$local_port"; then
    echo "Port-forward failed for $name. See $log_file" >&2
    return 1
  fi
}

query_prometheus_range() {
  local output_file="$1"
  local query="$2"

  curl -fsSG "$PROMETHEUS_URL/api/v1/query_range" \
    --data-urlencode "query=$query" \
    --data-urlencode "start=$QUERY_START_EPOCH" \
    --data-urlencode "end=$QUERY_END_EPOCH" \
    --data-urlencode "step=$QUERY_STEP_SECONDS" \
    > "$output_file"
}

retry_log_query() {
  local payload="$1"
  local output_file="$2"
  local attempt

  for ((attempt = 1; attempt <= OBSERVABILITY_QUERY_RETRIES; attempt++)); do
    if curl -fsS -H "Content-Type: application/json" \
      -X POST "$ELASTICSEARCH_URL/dacn-otel-logs*/_search?ignore_unavailable=true" \
      --data "$payload" > "$output_file" &&
      jq -e '(.hits.total.value // 0) > 0' "$output_file" >/dev/null 2>&1; then
      return 0
    fi
    sleep 5
  done

  return 1
}

retry_trace_query() {
  local output_file="$1"
  local attempt

  for ((attempt = 1; attempt <= OBSERVABILITY_QUERY_RETRIES; attempt++)); do
    if curl -fsSG "$JAEGER_URL/api/traces" \
      --data-urlencode "service=gateway-service" \
      --data-urlencode "start=$QUERY_START_MICROS" \
      --data-urlencode "end=$QUERY_END_MICROS" \
      --data-urlencode "limit=200" > "$output_file" &&
      jq -e '(.data // []) | length > 0' "$output_file" >/dev/null 2>&1; then
      return 0
    fi
    sleep 5
  done

  return 1
}

ensure_kibana_data_view() {
  local kibana_url="http://127.0.0.1:${KIBANA_LOCAL_PORT}"
  local pf_pid=""

  if ! command -v kubectl >/dev/null 2>&1; then return 0; fi
  kubectl -n "$OBSERVABILITY_NAMESPACE" get "svc/$KIBANA_SERVICE" >/dev/null 2>&1 || return 0

  kubectl -n "$OBSERVABILITY_NAMESPACE" port-forward "svc/$KIBANA_SERVICE" \
    "${KIBANA_LOCAL_PORT}:5601" >"$ARTIFACT_DIR/port-forward-kibana.log" 2>&1 &
  pf_pid="$!"

  if ! wait_for_port "$KIBANA_LOCAL_PORT"; then
    kill "$pf_pid" 2>/dev/null || true
    echo "Kibana port-forward failed; skipping data view setup." >&2
    return 0
  fi

  local existing
  existing=$(curl -fsS "${kibana_url}/api/data_views" 2>/dev/null \
    | jq -r '.data_view[]?.title // empty' 2>/dev/null \
    | grep -c "dacn-otel-logs" 2>/dev/null || echo 0)

  if [[ "$existing" -eq 0 ]]; then
    curl -fsS -X POST "${kibana_url}/api/data_views/data_view" \
      -H "kbn-xsrf: true" \
      -H "Content-Type: application/json" \
      -d '{"data_view":{"title":"dacn-otel-logs*","timeFieldName":"@timestamp","name":"DACN Logs"}}' \
      >/dev/null 2>&1 || true
    echo "Created Kibana data view: dacn-otel-logs*"
  fi

  kill "$pf_pid" 2>/dev/null || true
}

START_ISO="$(date -u -d "@$TEST_START_EPOCH" +%Y-%m-%dT%H:%M:%S.%3NZ)"
END_ISO="$(date -u -d "@$TEST_END_EPOCH" +%Y-%m-%dT%H:%M:%S.%3NZ)"
QUERY_START_EPOCH=$((TEST_START_EPOCH - OBSERVABILITY_WINDOW_MARGIN_SECONDS))
if (( QUERY_START_EPOCH < 0 )); then QUERY_START_EPOCH=0; fi
QUERY_END_EPOCH=$((TEST_END_EPOCH + OBSERVABILITY_WINDOW_MARGIN_SECONDS))
QUERY_START_MICROS=$((QUERY_START_EPOCH * 1000000))
QUERY_END_MICROS=$((QUERY_END_EPOCH * 1000000))
WINDOW_SECONDS=$((QUERY_END_EPOCH - QUERY_START_EPOCH))
QUERY_STEP_SECONDS=15
if (( WINDOW_SECONDS > 7200 )); then QUERY_STEP_SECONDS=30; fi

jq -n \
  --arg test_run_id "$TEST_RUN_ID" \
  --arg start "$START_ISO" \
  --arg end_time "$END_ISO" \
  --argjson start_epoch "$TEST_START_EPOCH" \
  --argjson end_epoch "$TEST_END_EPOCH" \
  '{test_run_id:$test_run_id,start:$start,end:$end_time,start_epoch:$start_epoch,end_epoch:$end_epoch}' \
  > "$ARTIFACT_DIR/test-window.json"

echo "Collecting observability evidence for $TEST_RUN_ID ($START_ISO to $END_ISO)"

if [[ "$PROMETHEUS_URL_PROVIDED" == "false" ]]; then
  start_port_forward prometheus "$PROMETHEUS_SERVICE" "$PROMETHEUS_LOCAL_PORT" 9090
fi
if [[ "$ELASTICSEARCH_URL_PROVIDED" == "false" ]]; then
  start_port_forward elasticsearch "$ELASTICSEARCH_SERVICE" "$ELASTICSEARCH_LOCAL_PORT" 9200
fi
if [[ "$JAEGER_URL_PROVIDED" == "false" ]]; then
  start_port_forward jaeger "$JAEGER_SERVICE" "$JAEGER_LOCAL_PORT" 16686
fi

ensure_kibana_data_view

if (( OBSERVABILITY_SETTLE_SECONDS > 0 )); then
  echo "Waiting ${OBSERVABILITY_SETTLE_SECONDS}s for telemetry exporters to flush..."
  sleep "$OBSERVABILITY_SETTLE_SECONDS"
fi

CPU_QUERY="100 * sum by (pod) (rate(container_cpu_usage_seconds_total{namespace=\"$STAGING_NAMESPACE\",container!=\"\",container!=\"POD\"}[1m])) / sum by (pod) (kube_pod_container_resource_limits{namespace=\"$STAGING_NAMESPACE\",resource=\"cpu\",unit=\"core\"})"
MEMORY_QUERY="100 * sum by (pod) (container_memory_working_set_bytes{namespace=\"$STAGING_NAMESPACE\",container!=\"\",container!=\"POD\"}) / sum by (pod) (kube_pod_container_resource_limits{namespace=\"$STAGING_NAMESPACE\",resource=\"memory\",unit=\"byte\"})"
THROTTLE_QUERY="100 * sum by (pod) (rate(container_cpu_cfs_throttled_periods_total{namespace=\"$STAGING_NAMESPACE\",container!=\"\",container!=\"POD\"}[1m])) / sum by (pod) (rate(container_cpu_cfs_periods_total{namespace=\"$STAGING_NAMESPACE\",container!=\"\",container!=\"POD\"}[1m]))"
RESTART_QUERY="sum by (pod) (kube_pod_container_status_restarts_total{namespace=\"$STAGING_NAMESPACE\"})"
HPA_QUERY="kube_horizontalpodautoscaler_status_current_replicas{namespace=\"$STAGING_NAMESPACE\"}"

if query_prometheus_range "$ARTIFACT_DIR/prometheus-cpu.json" "$CPU_QUERY" &&
   query_prometheus_range "$ARTIFACT_DIR/prometheus-memory.json" "$MEMORY_QUERY" &&
   query_prometheus_range "$ARTIFACT_DIR/prometheus-throttling.json" "$THROTTLE_QUERY" &&
   query_prometheus_range "$ARTIFACT_DIR/prometheus-restarts.json" "$RESTART_QUERY" &&
   query_prometheus_range "$ARTIFACT_DIR/prometheus-hpa.json" "$HPA_QUERY" &&
   jq -e '.status == "success" and (.data.result | length > 0)' "$ARTIFACT_DIR/prometheus-cpu.json" >/dev/null &&
   jq -e '.status == "success" and (.data.result | length > 0)' "$ARTIFACT_DIR/prometheus-memory.json" >/dev/null; then
  METRICS_STATUS="PASS"
else
  FAILED_EVIDENCE=$((FAILED_EVIDENCE + 1))
fi

jq -n \
  --slurpfile cpu "$ARTIFACT_DIR/prometheus-cpu.json" \
  --slurpfile memory "$ARTIFACT_DIR/prometheus-memory.json" \
  --slurpfile throttling "$ARTIFACT_DIR/prometheus-throttling.json" \
  --slurpfile restarts "$ARTIFACT_DIR/prometheus-restarts.json" \
  --slurpfile hpa "$ARTIFACT_DIR/prometheus-hpa.json" '
  def values($metric): [$metric.data.result[]?.values[]?[1] | tonumber];
  def peak($metric): (values($metric) | max // 0);
  def restart_delta($metric):
    [
      $metric.data.result[]?
      | ((.values[-1][1] | tonumber) - (.values[0][1] | tonumber))
      | if . < 0 then 0 else . end
    ] | add // 0;
  {
    cpu_series: ($cpu[0].data.result | length),
    memory_series: ($memory[0].data.result | length),
    cpu_peak_percent: peak($cpu[0]),
    memory_peak_percent: peak($memory[0]),
    cpu_throttling_peak_percent: peak($throttling[0]),
    restart_delta: restart_delta($restarts[0]),
    hpa_max_replicas_observed: peak($hpa[0])
  }' > "$ARTIFACT_DIR/prometheus-summary.json" || echo '{}' > "$ARTIFACT_DIR/prometheus-summary.json"

LOG_QUERY="$(jq -n \
  --arg run_id "$TEST_RUN_ID" \
  --arg start "$(date -u -d "@$QUERY_START_EPOCH" +%Y-%m-%dT%H:%M:%S.%3NZ)" \
  --arg end_time "$(date -u -d "@$QUERY_END_EPOCH" +%Y-%m-%dT%H:%M:%S.%3NZ)" '
  {
    size: 20,
    sort: [{"@timestamp": {order: "asc", unmapped_type: "date"}}],
    query: {
      bool: {
        filter: [{range: {"@timestamp": {gte: $start, lte: $end_time}}}],
        must: [{query_string: {query: ("\"" + $run_id + "\"")}}]
      }
    }
  }')"

retry_log_query "$LOG_QUERY" "$ARTIFACT_DIR/elasticsearch-test-run-logs.json" || true

jq '{
  matching_documents: (.hits.total.value // 0),
  gateway_markers: ([.hits.hits[]?._source | tostring | select(contains("gateway-service"))] | length),
  product_markers: ([.hits.hits[]?._source | tostring | select(contains("product-service"))] | length),
  sample_documents: [.hits.hits[0:5][]?._source]
}' "$ARTIFACT_DIR/elasticsearch-test-run-logs.json" \
  > "$ARTIFACT_DIR/elasticsearch-summary.json" 2>/dev/null || echo '{}' > "$ARTIFACT_DIR/elasticsearch-summary.json"

if jq -e '.gateway_markers > 0 and .product_markers > 0' \
  "$ARTIFACT_DIR/elasticsearch-summary.json" >/dev/null 2>&1; then
  LOGS_STATUS="PASS"
else
  FAILED_EVIDENCE=$((FAILED_EVIDENCE + 1))
fi

ERROR_QUERY="$(jq -n \
  --arg start "$(date -u -d "@$QUERY_START_EPOCH" +%Y-%m-%dT%H:%M:%S.%3NZ)" \
  --arg end_time "$(date -u -d "@$QUERY_END_EPOCH" +%Y-%m-%dT%H:%M:%S.%3NZ)" '
  {
    size: 20,
    sort: [{"@timestamp": {order: "asc", unmapped_type: "date"}}],
    query: {
      bool: {
        filter: [{range: {"@timestamp": {gte: $start, lte: $end_time}}}],
        must: [{query_string: {query: "error OR timeout OR ECONNRESET OR (connection AND refused) OR OOMKilled"}}]
      }
    }
  }')"

curl -fsS -H "Content-Type: application/json" \
  -X POST "$ELASTICSEARCH_URL/dacn-otel-logs*/_search?ignore_unavailable=true" \
  --data "$ERROR_QUERY" > "$ARTIFACT_DIR/elasticsearch-errors.json" || echo '{}' > "$ARTIFACT_DIR/elasticsearch-errors.json"

jq '. + {
  error_documents: ($errors[0].hits.total.value // 0),
  error_samples: [$errors[0].hits.hits[0:5][]?._source]
}' --slurpfile errors "$ARTIFACT_DIR/elasticsearch-errors.json" \
  "$ARTIFACT_DIR/elasticsearch-summary.json" > "$ARTIFACT_DIR/elasticsearch-summary.tmp.json" &&
  mv "$ARTIFACT_DIR/elasticsearch-summary.tmp.json" "$ARTIFACT_DIR/elasticsearch-summary.json"

if retry_trace_query "$ARTIFACT_DIR/jaeger-gateway-traces.json"; then
  jq '
    (.data // []) as $traces
    | [
        $traces[] as $trace
        | $trace.spans[]?
        | {
            service: ($trace.processes[.processID].serviceName // "unknown"),
            operation: (.operationName // "unknown"),
            duration_ms: ((.duration // 0) / 1000)
          }
      ] as $spans
    | {
        trace_count: ($traces | length),
        cross_service_trace_count: ([
          $traces[]
          | [.processes[]?.serviceName] | unique
          | select((index("gateway-service") != null) and (index("product-service") != null))
        ] | length),
        services: ([$traces[].processes[]?.serviceName] | unique),
        longest_span: ($spans | if length > 0 then max_by(.duration_ms) else null end)
      }
  ' "$ARTIFACT_DIR/jaeger-gateway-traces.json" > "$ARTIFACT_DIR/jaeger-summary.json"

  if jq -e '.trace_count > 0 and .cross_service_trace_count > 0' \
    "$ARTIFACT_DIR/jaeger-summary.json" >/dev/null; then
    TRACES_STATUS="PASS"
  else
    FAILED_EVIDENCE=$((FAILED_EVIDENCE + 1))
  fi
else
  echo '{}' > "$ARTIFACT_DIR/jaeger-summary.json"
  FAILED_EVIDENCE=$((FAILED_EVIDENCE + 1))
fi

CPU_PEAK="$(jq -r '.cpu_peak_percent // 0' "$ARTIFACT_DIR/prometheus-summary.json")"
MEMORY_PEAK="$(jq -r '.memory_peak_percent // 0' "$ARTIFACT_DIR/prometheus-summary.json")"
THROTTLE_PEAK="$(jq -r '.cpu_throttling_peak_percent // 0' "$ARTIFACT_DIR/prometheus-summary.json")"
RESTART_DELTA="$(jq -r '.restart_delta // 0' "$ARTIFACT_DIR/prometheus-summary.json")"
HPA_MAX="$(jq -r '.hpa_max_replicas_observed // 0' "$ARTIFACT_DIR/prometheus-summary.json")"
LOG_COUNT="$(jq -r '.matching_documents // 0' "$ARTIFACT_DIR/elasticsearch-summary.json")"
GATEWAY_LOG_COUNT="$(jq -r '.gateway_markers // 0' "$ARTIFACT_DIR/elasticsearch-summary.json")"
PRODUCT_LOG_COUNT="$(jq -r '.product_markers // 0' "$ARTIFACT_DIR/elasticsearch-summary.json")"
ERROR_LOG_COUNT="$(jq -r '.error_documents // 0' "$ARTIFACT_DIR/elasticsearch-summary.json")"
TRACE_COUNT="$(jq -r '.trace_count // 0' "$ARTIFACT_DIR/jaeger-summary.json")"
CROSS_TRACE_COUNT="$(jq -r '.cross_service_trace_count // 0' "$ARTIFACT_DIR/jaeger-summary.json")"
LONGEST_SPAN="$(jq -r 'if .longest_span then "\(.longest_span.service) / \(.longest_span.operation) / \(.longest_span.duration_ms) ms" else "unavailable" end' "$ARTIFACT_DIR/jaeger-summary.json")"

number_greater_than() {
  jq -en --arg value "$1" --arg limit "$2" \
    '($value | tonumber) > ($limit | tonumber)' >/dev/null
}

FINDINGS=()
if number_greater_than "$CPU_PEAK" 85; then
  FINDINGS+=("CPU đã vượt 85% limit; cần kiểm tra saturation và HPA của pod tương ứng.")
fi
if number_greater_than "$MEMORY_PEAK" 85; then
  FINDINGS+=("Memory đã vượt 85% limit; có nguy cơ memory pressure hoặc OOM.")
fi
if number_greater_than "$THROTTLE_PEAK" 10; then
  FINDINGS+=("CPU throttling vượt 10%; CPU limit có thể đang kìm throughput.")
fi
if number_greater_than "$RESTART_DELTA" 0; then
  FINDINGS+=("Có container restart trong cửa sổ test; phải đối chiếu log và Kubernetes events.")
fi
if number_greater_than "$ERROR_LOG_COUNT" 0; then
  FINDINGS+=("Elasticsearch ghi nhận $ERROR_LOG_COUNT log nghi ngờ lỗi hoặc timeout.")
fi
if (( ${#FINDINGS[@]} == 0 )); then
  FINDINGS+=("Chưa thấy dấu hiệu saturation, throttling, restart hoặc error log theo các ngưỡng tự động.")
fi
FINDINGS+=("Span dài nhất là $LONGEST_SPAN; đây là vị trí ưu tiên để mở trace và xác nhận nguyên nhân.")

FINDINGS_REPORT=""
for finding in "${FINDINGS[@]}"; do
  FINDINGS_REPORT+="- $finding"$'\n'
done

if (( FAILED_EVIDENCE == 0 )); then
  DECISION="PASS"
  DECISION_TEXT="Đã thu được metrics, logs và distributed traces trong đúng cửa sổ kiểm thử."
else
  DECISION="FAIL"
  DECISION_TEXT="Thiếu ít nhất một nguồn telemetry bắt buộc; chưa đủ bằng chứng để chẩn đoán lần kiểm thử này."
fi

cat > "$ARTIFACT_DIR/observability-evidence-summary.md" <<EOF
# Báo cáo bằng chứng observability

- Test run ID: $TEST_RUN_ID
- Bắt đầu: $START_ISO
- Kết thúc: $END_ISO
- Namespace: $STAGING_NAMESPACE

## Kết luận

**$DECISION.** $DECISION_TEXT

| Nguồn | Trạng thái | Bằng chứng |
| --- | --- | --- |
| Prometheus metrics | $METRICS_STATUS | CPU/memory series trong cửa sổ test |
| Elasticsearch logs | $LOGS_STATUS | $LOG_COUNT document chứa Test run ID; Gateway=$GATEWAY_LOG_COUNT, Product=$PRODUCT_LOG_COUNT |
| Jaeger traces | $TRACES_STATUS | $TRACE_COUNT trace, $CROSS_TRACE_COUNT trace Gateway → Product |

## Chỉ số nổi bật

| Chỉ số | Giá trị |
| --- | ---: |
| CPU peak so với limit | $CPU_PEAK% |
| Memory peak so với limit | $MEMORY_PEAK% |
| CPU throttling peak | $THROTTLE_PEAK% |
| Container restart tăng thêm | $RESTART_DELTA |
| HPA replica lớn nhất quan sát được | $HPA_MAX |
| Log nghi ngờ lỗi/timeout | $ERROR_LOG_COUNT |
| Span dài nhất | $LONGEST_SPAN |

## Nhận định tự động

$FINDINGS_REPORT
## Diễn giải

- CPU hoặc memory trên 85% cho thấy nguy cơ nghẽn tài nguyên.
- CPU throttling cao cho thấy container bị giới hạn CPU dù node có thể vẫn còn tài nguyên.
- Restart tăng trong lúc test cho thấy hệ thống không ổn định dưới tải.
- Span dài nhất chỉ ra vị trí cần kiểm tra trước; phải đối chiếu thêm metrics và logs trước khi kết luận nguyên nhân gốc.

## Artifacts

- prometheus-summary.json
- elasticsearch-summary.json
- jaeger-summary.json
- Các response gốc: prometheus-*.json, elasticsearch-test-run-logs.json, jaeger-gateway-traces.json
EOF

cat "$ARTIFACT_DIR/observability-evidence-summary.md"

if (( FAILED_EVIDENCE > 0 )); then
  exit 1
fi
