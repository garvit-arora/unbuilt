import "server-only";
import { unstable_rethrow } from "next/navigation";
import { logger } from "@/server/http/logger";
import { platformCounters } from "./analytics.service";
import { getConstellation } from "./constellation.service";
import { discover } from "./discover.service";

/** Public landing content stays available when one of its live data sources is offline. */
export async function loadHome() {
  const results = await Promise.allSettled([
    discover({ sort: "highest_demand", limit: 6 }),
    platformCounters(),
    getConstellation(),
  ]);
  const names = ["trending", "counters", "constellation"];
  results.forEach((result, index) => {
    if (result.status === "rejected") {
      unstable_rethrow(result.reason);
      logger.warn("home.data_unavailable", { section: names[index], error: result.reason });
    }
  });
  return {
    top: results[0].status === "fulfilled" ? results[0].value : null,
    counters: results[1].status === "fulfilled" ? results[1].value : null,
    constellation: results[2].status === "fulfilled" ? results[2].value : null,
  };
}
