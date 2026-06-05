export function getSharedCookieDomain(hostname: string): string | null {
  if (hostname === "retrocyclesleague.com" || hostname.endsWith(".retrocyclesleague.com")) {
    return ".retrocyclesleague.com"
  }

  return null
}

export function isAllowedRedirectTarget(target: string): boolean {
  try {
    const url = new URL(target)
    if (!(url.protocol === "http:" || url.protocol === "https:")) return false
    return url.hostname === "retrocyclesleague.com" || url.hostname.endsWith(".retrocyclesleague.com")
  } catch {
    return false
  }
}

export function setPostAuthRedirectCookie(explicitReturnTo?: string | null) {
  if (typeof window === "undefined") return

  const targetUrl =
    explicitReturnTo && isAllowedRedirectTarget(explicitReturnTo)
      ? explicitReturnTo
      : `${window.location.origin}/`

  let cookie = `rcl_post_auth_redirect=${encodeURIComponent(targetUrl)}; path=/; max-age=600; samesite=lax`
  const domain = process.env.NEXT_PUBLIC_AUTH_COOKIE_DOMAIN || getSharedCookieDomain(window.location.hostname)

  if (domain) cookie += `; domain=${domain}`
  if (window.location.protocol === "https:") cookie += "; secure"

  document.cookie = cookie
}

export function getDashboardLoginUrl(returnTo?: string): string {
  const target = returnTo || `${window.location.origin}/`
  setPostAuthRedirectCookie(target)
  const url = new URL("https://retrocyclesleague.com/auth/login")
  url.searchParams.set("returnTo", target)
  return url.toString()
}
