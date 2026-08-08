const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Route params are strings and anyone can type one. Checking before the query
 * turns `/runs/banana` into a 404 instead of a Postgres cast error surfacing as
 * a 500.
 */
export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}
