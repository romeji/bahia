import { OkxConfigurationError } from "../errors";
import type { OkxDemoCredentials } from "./signature";
import { validateDemoCredentials } from "./signature";

export interface OkxDemoEnvironment {
  OKX_DEMO_API_KEY?: string;
  OKX_DEMO_SECRET_KEY?: string;
  OKX_DEMO_PASSPHRASE?: string;
}

/**
 * Reads only server-side variables. Never use NEXT_PUBLIC_* for exchange keys.
 */
export function loadOkxDemoCredentials(
  environment: OkxDemoEnvironment = process.env as OkxDemoEnvironment,
): Readonly<OkxDemoCredentials> {
  const forbiddenPublicNames = [
    "NEXT_PUBLIC_OKX_API_KEY",
    "NEXT_PUBLIC_OKX_SECRET_KEY",
    "NEXT_PUBLIC_OKX_PASSPHRASE",
  ] as const;

  for (const name of forbiddenPublicNames) {
    if ((environment as Record<string, string | undefined>)[name]) {
      throw new OkxConfigurationError(
        `${name} is forbidden because it would expose OKX credentials to browsers`,
      );
    }
  }

  return validateDemoCredentials({
    apiKey: environment.OKX_DEMO_API_KEY ?? "",
    secretKey: environment.OKX_DEMO_SECRET_KEY ?? "",
    passphrase: environment.OKX_DEMO_PASSPHRASE ?? "",
  });
}
