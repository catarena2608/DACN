const { context, trace } = require("@opentelemetry/api");

const observedRuns = new Set();

module.exports = (serviceName) => (req, _res, next) => {
  const testRunId = req.headers["x-test-run-id"];

  if (/^staging-[A-Za-z0-9._:-]{1,80}$/.test(testRunId || "") && !observedRuns.has(testRunId)) {
    if (observedRuns.size >= 100) observedRuns.clear();
    observedRuns.add(testRunId);

    const span = trace.getSpan(context.active());
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      severity: "INFO",
      event: "staging_test_run_observed",
      service: serviceName,
      test_run_id: testRunId,
      trace_id: span?.spanContext().traceId || null,
    }));
  }

  next();
};
