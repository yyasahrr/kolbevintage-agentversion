import { readFile } from "node:fs/promises";

const envExample = await readFile(new URL("../.env.example", import.meta.url), "utf8");
const requiredKeys = ["NODE_ENV", "APP_NAME", "LOG_LEVEL", "DATABASE_URL"];

for (const key of requiredKeys) {
  const declaration = new RegExp(`^${key}=`, "m");
  if (!declaration.test(envExample)) {
    throw new Error(`.env.example is missing ${key}`);
  }
}

const forbiddenSecretPatterns = [/sk-[A-Za-z0-9]/, /-----BEGIN/, /password=[^:$\\s]+/i, /token=[^:$\\s]+/i];
for (const pattern of forbiddenSecretPatterns) {
  if (pattern.test(envExample)) {
    throw new Error(`.env.example contains a value that looks like a secret (${pattern})`);
  }
}

console.log("Environment contract is present and contains placeholders only.");
