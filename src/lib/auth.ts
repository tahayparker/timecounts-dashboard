import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { Pool } from "pg";

const configuredDomains = process.env.ALLOWED_DOMAINS
  ? process.env.ALLOWED_DOMAINS.split(",").map((d) => d.trim()).filter(Boolean)
  : [];

const allowedHosts = [
  "localhost:*",
  "127.0.0.1:*",
  "*.vercel.app",
  ...configuredDomains,
];

const trustedOrigins = [
  "http://localhost:*",
  "http://127.0.0.1:*",
  "https://*.vercel.app",
  ...configuredDomains.flatMap((d) => [`https://${d}`, `http://${d}`]),
];

export const auth = betterAuth({
  database: new Pool({
    connectionString: process.env.DATABASE_URL,
  }),
  baseURL: {
    allowedHosts,
    fallback: process.env.BETTER_AUTH_URL || "http://localhost:3000",
    protocol: "auto",
  },
  trustedOrigins,
  advanced: {
    trustedProxyHeaders: true,
  },
  emailAndPassword: {
    enabled: true,
    disableSignUp: process.env.ALLOW_CLI_SIGNUP !== "true",
  },
  plugins: [nextCookies()],
});
