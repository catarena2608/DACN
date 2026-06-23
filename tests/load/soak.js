import { createOptions, readProductPath, setup, summaryOutput } from "./common.js";

const profile = "soak";
const SOAK_TARGET = Number(__ENV.SOAK_TARGET || "300");
const SOAK_DURATION = __ENV.SOAK_DURATION || "30m";

export const options = createOptions([
  { duration: "2m", target: SOAK_TARGET },
  { duration: SOAK_DURATION, target: SOAK_TARGET },
  { duration: "2m", target: 0 },
]);

export { setup };

export default function (data) {
  readProductPath(data);
}

export function handleSummary(data) {
  return summaryOutput(data, profile, "staging-soak-load-summary.json");
}
