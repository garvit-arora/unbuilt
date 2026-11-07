import { test as setup } from "@playwright/test";
import { saveSession, type DemoRole } from "./sessions";

/** Setup project: signs in as the three demo accounts once and saves their storage states under playwright/.auth. */
for (const role of ["buyer", "builder", "admin"] as DemoRole[]) {
  setup(`save the demo ${role} session`, async ({ browser, baseURL }) => {
    await saveSession(browser, baseURL!, role);
  });
}
