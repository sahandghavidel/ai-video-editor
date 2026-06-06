/**
 * Centralised Baserow authentication helper.
 *
 * Supports two modes controlled by the `BASEROW_USE_DATABASE_TOKEN` env var:
 *   • `false` (default) – legacy email/password → JWT login with 50-min cache.
 *   • `true`           – long-lived Database Token (no expiry, no refresh).
 *
 * All API routes should import `getBaserowToken` / `getAuthHeader` from here
 * instead of maintaining their own `getJWTToken` implementations.
 */

/* -------------------------------------------------------------------------- */
/*  Token acquisition                                                         */
/* -------------------------------------------------------------------------- */

export async function getBaserowToken(forceRefresh = false): Promise<string> {
  const useDatabaseToken =
    process.env.BASEROW_USE_DATABASE_TOKEN?.trim().toLowerCase() === 'true';

  /* ---------- Database Token mode ---------- */
  if (useDatabaseToken) {
    const token = process.env.BASEROW_TOKEN;
    if (!token) {
      throw new Error(
        'BASEROW_USE_DATABASE_TOKEN is true but BASEROW_TOKEN is not set. ' +
          'Add your Database Token to .env.local.',
      );
    }
    return token.trim();
  }

  /* ---------- JWT mode (legacy) ---------- */
  const baserowUrl = process.env.BASEROW_API_URL;
  const email = process.env.BASEROW_EMAIL;
  const password = process.env.BASEROW_PASSWORD;

  if (!baserowUrl || !email || !password) {
    throw new Error(
      'Missing Baserow configuration. Set BASEROW_API_URL, BASEROW_EMAIL, ' +
        'and BASEROW_PASSWORD in .env.local (or enable BASEROW_USE_DATABASE_TOKEN).',
    );
  }

  if (
    !forceRefresh &&
    cachedJwtToken &&
    Date.now() < cachedJwtTokenExpiry - 300_000
  ) {
    return cachedJwtToken;
  }

  cachedJwtToken = null;
  cachedJwtTokenExpiry = 0;

  const response = await fetch(`${baserowUrl}/user/token-auth/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
    cache: 'no-store',
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(
      `Baserow authentication failed (${response.status}): ${errorText}`,
    );
  }

  const payload = (await response.json().catch(() => null)) as {
    token?: unknown;
  } | null;
  const token =
    typeof payload?.token === 'string' ? payload.token.trim() : '';

  if (!token) {
    throw new Error('Baserow authentication succeeded but token is empty');
  }

  cachedJwtToken = token;
  cachedJwtTokenExpiry = Date.now() + 50 * 60 * 1000;
  return token;
}

/* -------------------------------------------------------------------------- */
/*  Auth header helper                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Returns the `Authorization` header object suitable for passing to `fetch`.
 *   • Database Token mode → `{ Authorization: "Token <token>" }`
 *   • JWT mode           → `{ Authorization: "JWT <token>" }`
 */
export async function getAuthHeader(
  forceRefresh = false,
): Promise<Record<string, string>> {
  const token = await getBaserowToken(forceRefresh);
  return buildAuthHeader(token);
}

/**
 * Build an `Authorization` header from a known token value.
 * Use this inside helpers that receive a token as a parameter.
 */
export function buildAuthHeader(token: string): Record<string, string> {
  const useDatabaseToken =
    process.env.BASEROW_USE_DATABASE_TOKEN?.trim().toLowerCase() === 'true';
  const scheme = useDatabaseToken ? 'Token' : 'JWT';
  return { Authorization: `${scheme} ${token}` };
}
