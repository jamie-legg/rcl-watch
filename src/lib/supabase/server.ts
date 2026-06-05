import { createServerClient } from "@supabase/ssr"
import { cookies, headers } from "next/headers"
import { withAuthCookieDomain } from "@/lib/supabase/cookie-domain"

export async function createClient() {
  const cookieStore = await cookies()
  const headersList = await headers()
  const host = headersList.get("x-forwarded-host") || headersList.get("host") || undefined

  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, withAuthCookieDomain(name, options, host))
          )
        } catch {
          // Server Components may call this without a mutable cookie store.
        }
      },
    },
  })
}
