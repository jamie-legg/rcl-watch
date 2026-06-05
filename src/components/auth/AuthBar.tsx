"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { getDashboardLoginUrl } from "@/lib/auth/client-auth-navigation"

type AuthBarProps = {
  compact?: boolean
}

export function AuthBar({ compact = false }: AuthBarProps) {
  const supabase = useMemo(() => createClient(), [])
  const [email, setEmail] = useState<string | null>(null)
  const [username, setUsername] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const refreshUser = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser()

    setEmail(user?.email ?? null)
    if (!user) {
      setUsername(null)
      setLoading(false)
      return
    }

    const { data: profile } = await supabase.from("profiles").select("username").eq("id", user.id).single()
    setUsername(profile?.username ?? null)
    setLoading(false)
  }, [supabase])

  useEffect(() => {
    void refreshUser()
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => {
      void refreshUser()
    })
    return () => subscription.unsubscribe()
  }, [supabase, refreshUser])

  function handleLogin() {
    window.location.assign(getDashboardLoginUrl())
  }

  async function handleSignOut() {
    await supabase.auth.signOut()
    setEmail(null)
    setUsername(null)
  }

  if (loading) {
    return <div className={`auth-bar${compact ? " compact" : ""}`} aria-hidden="true" />
  }

  return (
    <div className={`auth-bar${compact ? " compact" : ""}`}>
      {email ? (
        <>
          <span className="auth-label">{username || email}</span>
          <button type="button" className="auth-button ghost" onClick={() => void handleSignOut()}>
            Sign out
          </button>
        </>
      ) : (
        <button type="button" className="auth-button" onClick={handleLogin}>
          Log in
        </button>
      )}
    </div>
  )
}
