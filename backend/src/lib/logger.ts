import pino from "pino";
import { env, isProduction } from "../config/env";

/** Journal applicatif. Les champs sensibles sont masqués systématiquement. */
export const logger = pino({
  level: env.NODE_ENV === "test" ? (process.env.TEST_LOG_LEVEL ?? "silent") : env.LOG_LEVEL,
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "req.headers.apikey",
      "req.headers.apiuser",
      "req.headers['x-wh-secret']",
      "headers.apikey",
      "headers.apiuser",
      "*.password",
      "*.passwordHash",
      "*.token",
      "*.apiKey",
      "*.secret",
    ],
    censor: "[masqué]",
  },
  transport: isProduction ? undefined : { target: "pino-pretty", options: { colorize: true, translateTime: "SYS:HH:MM:ss" } },
});
