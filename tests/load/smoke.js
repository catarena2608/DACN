import { createOptions, readProductPath, setup, summaryOutput } from "./common.js";

const profile = "smoke";

export const options = createOptions(
  [
    { duration: "30s", target: 10 },
    { duration: "30s", target: 0 },
  ],
  { http_req_duration: ["p(95)<2000", "p(99)<4000"] },
);

export { setup };

export default function (data) {
  readProductPath(data);
}

export function handleSummary(data) {
  return summaryOutput(data, profile, "staging-smoke-load-summary.json");
}
