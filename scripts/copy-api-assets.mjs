import { cpSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(PROJECT_ROOT, "apps/api/src/infrastructure/store/migrations");
const destination = resolve(PROJECT_ROOT, "apps/api/dist/infrastructure/store/migrations");

if (existsSync(source)) {
  cpSync(source, destination, { recursive: true });
}
