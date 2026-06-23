import { createOptions, readProductPath, setup, summaryOutput } from "./common.js";

const profile = "spike";
const SPIKE_TARGET = Number(__ENV.SPIKE_TARGET || "1000");

export const options = createOptions([
  { duration: "30s", target: 100 },
  { duration: "30s", target: SPIKE_TARGET },
  { duration: "2m", target: SPIKE_TARGET },
  { duration: "30s", target: 100 },
  { duration: "30s", target: 0 },
]);

export { setup };

export default function (data) {
  readProductPath(data);
}

export function handleSummary(data) {
  return summaryOutput(data, profile, "staging-spike-load-summary.json");
}
