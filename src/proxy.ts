import { updateSession } from "@/lib/supabase/middleware"
import type { NextRequest } from "next/server"

// Next 16 renamed the `middleware` convention to `proxy`. This refreshes the
// shared Supabase session cookies on every (non-asset) request.
export async function proxy(request: NextRequest) {
  return await updateSession(request)
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|woff|woff2|ttf|eot|obj|ogg)$).*)"],
}
