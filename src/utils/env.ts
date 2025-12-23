import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from project root
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

/**
 * Get a required environment variable or throw an error if not set
 */
export function getEnvRequired(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

/**
 * Get an optional environment variable with a default value
 */
export function getEnvOptional(key: string, defaultValue: string = ""): string {
  return process.env[key] ?? defaultValue;
}

/**
 * Environment configuration for the application
 */
export const env = {
  FUNDER_PUBLIC_KEY: getEnvRequired("FUNDER_PUBLIC_KEY"),
  FUNDER_PRIVATE_KEY: getEnvRequired("FUNDER_PRIVATE_KEY"),
} as const;
