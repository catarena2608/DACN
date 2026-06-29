import { createOptions, readProductPath, setup, summaryOutput } from "./common.js";

const profile = __ENV.LOAD_TEST_PROFILE || "1k";

const stagesByProfile = {
  "1k": [
    { duration: "1m", target: 100 },
    { duration: "1m", target: 1000 },
    { duration: "3m", target: 1000 },
    { duration: "1m", target: 0 },
  ],
  "10k": [
    { duration: "1m", target: 100 },
    { duration: "1m", target: 10000 },
    { duration: "3m", target: 10000 },
    { duration: "1m", target: 0 },
  ],
};

if (!stagesByProfile[profile]) {
  throw new Error(`Unsupported LOAD_TEST_PROFILE=${profile}. Use 1k or 10k.`);
}

export const options = createOptions(stagesByProfile[profile]);

export { setup };

export default function (data) {
  readProductPath(data);
}

export function handleSummary(data) {
  return summaryOutput(data, profile, `staging-${profile}-load-summary.json`);
}
