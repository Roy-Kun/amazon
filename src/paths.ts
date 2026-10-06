import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const PROJECT_ROOT = fileURLToPath(new URL("..", import.meta.url));

export function resolveProjectPath(value: string): string {
  return isAbsolute(value) ? resolve(value) : resolve(PROJECT_ROOT, value);
}
