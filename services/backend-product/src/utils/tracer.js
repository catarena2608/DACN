const api = require('@opentelemetry/api');
const tracer = api.trace.getTracer('product-service');

module.exports = {
  runWithSpan: async (name, fn) => {
    return await tracer.startActiveSpan(name, async (span) => {
      try {
        return await fn(span);
      } catch (err) {
        span.recordException(err);
        span.setStatus({ code: api.SpanStatusCode.ERROR, message: err.message });
        throw err;
      } finally {
        span.end();
      }
    });
  }
};