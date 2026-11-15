/**
 * Turns a saved `sogniApi` credential into the auth part of the SogniClientWrapper config.
 *
 * API-key auth is used only when the credential explicitly chose it. Credentials saved before
 * the Authentication field existed carry no `authType`; they keep logging in with username and
 * password exactly as before (same config shape, no `authType` key).
 */
export type SogniCredentialAuthConfig =
  | { authType: 'apiKey'; apiKey: string }
  | { username: string; password: string };

export interface SogniCredentialData {
  authType?: unknown;
  apiKey?: unknown;
  username?: unknown;
  password?: unknown;
}

export function buildSogniCredentialAuthConfig(
  credentials: SogniCredentialData,
): SogniCredentialAuthConfig {
  if (credentials.authType === 'apiKey') {
    return {
      authType: 'apiKey',
      apiKey: credentials.apiKey as string,
    };
  }
  return {
    username: credentials.username as string,
    password: credentials.password as string,
  };
}
