import { beforeEach } from "vitest";
import { truncateAll } from "./helpers.js";

beforeEach(async () => {
  await truncateAll();
});
