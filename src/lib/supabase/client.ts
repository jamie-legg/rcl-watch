import { createBrowserClient } from "@supabase/ssr"
import { withAuthCookieDomain } from "@/lib/supabase/cookie-domain"

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null
  const prefix = `${name}=`
  const parts = document.cookie ? document.cookie.split("; ") : []
  for (const part of parts) {
    if (!part.startsWith(prefix)) continue
    const rawValue = part.slice(prefix.length)
    try {
      return decodeURIComponent(rawValue)
    } catch {
      return rawValue
    }
  }
  return null
}

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name) {
          return readCookie(name)
        },
        set(name, value, options) {
          if (typeof document === "undefined") return
          let cookie = `${name}=${encodeURIComponent(value)}`
          const scopedOptions = withAuthCookieDomain(name, options, window.location.hostname) || options
          if (scopedOptions?.maxAge) {
            cookie += `; max-age=${scopedOptions.maxAge}`
          }
          if (scopedOptions?.domain) {
            cookie += `; domain=${scopedOptions.domain}`
          }
          if (scopedOptions?.path) {
            cookie += `; path=${scopedOptions.path}`
          } else {
            cookie += `; path=/`
          }
          if (scopedOptions?.sameSite) {
            cookie += `; samesite=${scopedOptions.sameSite}`
          } else {
            cookie += `; samesite=lax`
          }
          if (scopedOptions?.secure) {
            cookie += `; secure`
          }
          document.cookie = cookie
        },
        remove(name, options) {
          if (typeof document === "undefined") return
          this.set(name, "", {
            ...options,
            maxAge: 0,
          })
        },
      },
    }
  )
}
