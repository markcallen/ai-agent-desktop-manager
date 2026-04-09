function normalizeAllowedDomain(value: string): string | undefined {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return undefined;
  return normalized.replace(/^\*\./, '');
}

export function parseStartUrlDomainAllowlist(
  raw: string | undefined
): string[] {
  if (!raw) return [];

  return [
    ...new Set(
      raw
        .split(',')
        .map(normalizeAllowedDomain)
        .filter((domain): domain is string => domain !== undefined)
    )
  ];
}

export function isStartUrlAllowed(startUrl: string, allowedDomains: string[]) {
  if (allowedDomains.length === 0) return true;

  let hostname: string;
  try {
    hostname = new URL(startUrl).hostname.toLowerCase();
  } catch {
    return false;
  }

  return allowedDomains.some(
    (allowedDomain) =>
      hostname === allowedDomain || hostname.endsWith(`.${allowedDomain}`)
  );
}
