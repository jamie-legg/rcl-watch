type CookieOptions = {
  domain?: string
}

function normalizeHostname(hostname?: string): string | undefined {
  if (!hostname) return undefined
  return hostname.split(":")[0].toLowerCase()
}

function shouldScopeAuthCookie(name: string): boolean {
  return name.startsWith("sb-")
}

export function resolveAuthCookieDomain(hostname?: string): string | undefined {
  const configuredDomain =
    process.env.AUTH_COOKIE_DOMAIN || process.env.NEXT_PUBLIC_AUTH_COOKIE_DOMAIN
  if (configuredDomain) return configuredDomain

  const normalizedHost = normalizeHostname(hostname)
  if (!normalizedHost) return undefined
  if (normalizedHost === "retrocyclesleague.com" || normalizedHost.endsWith(".retrocyclesleague.com")) {
    return ".retrocyclesleague.com"
  }
  return undefined
}

export function withAuthCookieDomain<T extends CookieOptions>(
  name: string,
  options?: T,
  hostname?: string
): T | undefined {
  const configuredDomain = resolveAuthCookieDomain(hostname)

  if (!configuredDomain || !shouldScopeAuthCookie(name)) {
    return options
  }

  return {
    ...(options || ({} as T)),
    domain: configuredDomain,
  }
}
