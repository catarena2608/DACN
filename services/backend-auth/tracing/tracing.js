// tracing/tracing.js
const { NodeSDK } = require('@opentelemetry/sdk-node');
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-grpc');
const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');
const resources = require('@opentelemetry/resources');

function createServiceResource(serviceName) {
  const attributes = { 'service.name': serviceName };

  if (typeof resources.resourceFromAttributes === 'function') {
    return resources.resourceFromAttributes(attributes);
  }

  return new resources.Resource(attributes);
}

const sdk = new NodeSDK({
  resource: createServiceResource(process.env.SERVICE_NAME || 'auth-service'),
  traceExporter: new OTLPTraceExporter({
    url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4317',
  }),
  instrumentations: [getNodeAutoInstrumentations()],
});

sdk.start();

// Đảm bảo đóng SDK khi app dừng
process.on('SIGTERM', () => {
  sdk.shutdown().then(() => console.log('Tracing terminated'));
});
