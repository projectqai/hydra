const z = require("zod");
const packageJSON = require("./package.json");
const path = require("path");

const APP_ENV = process.env.APP_ENV ?? "development";
const envPath = path.resolve(__dirname, `.env.${APP_ENV}`);

require("dotenv").config({
  path: envPath,
});

const PACKAGE = "com.q.hydra.foss";
const NAME = "Hydra FOSS";
const SCHEME = "hydra-foss";

const withEnvSuffix = (name) => {
  return APP_ENV === "production" ? name : `${name}.${APP_ENV}`;
};

const client = z.object({
  APP_ENV: z.enum(["development", "staging", "production"]),
  NAME: z.string(),
  SCHEME: z.string(),
  PACKAGE: z.string(),
  VERSION: z.string(),
  PUBLIC_HYDRA_API_URL: z.string().optional(),
});

const buildTime = z.object({});

const _clientEnv = {
  APP_ENV,
  NAME,
  SCHEME,
  PACKAGE: withEnvSuffix(PACKAGE),
  VERSION: packageJSON.version,
  PUBLIC_HYDRA_API_URL: process.env.EXPO_PUBLIC_HYDRA_API_URL,
};

const _buildTimeEnv = {};

const _env = {
  ..._clientEnv,
  ..._buildTimeEnv,
};

const merged = z.object({ ...buildTime.shape, ...client.shape });
const parsed = merged.safeParse(_env);

if (parsed.success === false) {
  console.error(
    "❌ Invalid environment variables:",
    parsed.error.issues,
    `\n❌ Missing variables in .env.${APP_ENV} file.`,
  );
  throw new Error("Invalid environment variables");
}

const Env = parsed.data;
const ClientEnv = client.parse(_clientEnv);

module.exports = {
  Env,
  ClientEnv,
  withEnvSuffix,
};
