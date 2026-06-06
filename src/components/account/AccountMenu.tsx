"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { getDashboardLoginUrl } from "@/lib/auth/client-auth-navigation";

const WATCH_LINKS = [
  { href: "/", label: "Matches", hint: "TST · Fort" },
  { href: "/tournaments", label: "Tournaments", hint: ".aarec replays" },
  { href: "/me", label: "My matches", hint: "your history" },
  { href: "/?fav=1", label: "Favourites", hint: "starred matches" },
];

const RCL_LINKS = [
  { href: "https://retrocyclesleague.com/dashboard", label: "Dashboard", hint: "profile · logins" },
  { href: "https://hub.retrocyclesleague.com", label: "Hub", hint: "leaderboard · stats" },
  { href: "https://resource.retrocyclesleague.com", label: "Resource", hint: "maps · configs" },
];

export function AccountMenu() {
  const supabase = useMemo(() => createClient(), []);
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState<string | null>(null);
  const [username, setUsername] = useState<string | null>(null);

  const refreshUser = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    setEmail(user?.email ?? null);
    if (!user) {
      setUsername(null);
      return;
    }
    const { data: profile } = await supabase.from("profiles").select("username").eq("id", user.id).single();
    setUsername(profile?.username ?? null);
  }, [supabase]);

  useEffect(() => {
    void refreshUser();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => void refreshUser());
    return () => subscription.unsubscribe();
  }, [supabase, refreshUser]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const signedIn = Boolean(email);
  const display = username || email || "";
  const initial = display ? display.trim()[0]?.toUpperCase() : "";

  function handleLogin() {
    window.location.assign(getDashboardLoginUrl());
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    setEmail(null);
    setUsername(null);
    setOpen(false);
  }

  const drawer = (
    <div
      className={`account-overlay${open ? " open" : ""}`}
      onClick={() => setOpen(false)}
      role="presentation"
    >
      <aside
        className="account-drawer"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Account menu"
      >
        <div className="account-head">
          <span className={`account-avatar${signedIn ? " on" : ""}`}>{signedIn ? initial : "·"}</span>
          <div className="account-id">
            {signedIn ? (
              <>
                <strong>{username || email}</strong>
                <span>{username ? email : "Signed in"}</span>
              </>
            ) : (
              <>
                <strong>Not signed in</strong>
                <span>Log in with your RCL account</span>
              </>
            )}
          </div>
          <button type="button" className="account-close" aria-label="Close" onClick={() => setOpen(false)}>
            ✕
          </button>
        </div>

        {signedIn ? (
          <button type="button" className="account-action ghost" onClick={() => void handleSignOut()}>
            Sign out
          </button>
        ) : (
          <button type="button" className="account-action" onClick={handleLogin}>
            Log in
          </button>
        )}

        <p className="account-section">Watch</p>
        <nav className="account-links">
          {WATCH_LINKS.map((link) => (
            <Link key={link.href} href={link.href} prefetch={false} className="account-link" onClick={() => setOpen(false)}>
              <span>{link.label}</span>
              <em>{link.hint}</em>
            </Link>
          ))}
        </nav>

        <p className="account-section">Retrocycles League</p>
        <nav className="account-links">
          {RCL_LINKS.map((link) => (
            <a key={link.href} href={link.href} target="_blank" rel="noreferrer" className="account-link external">
              <span>{link.label}</span>
              <em>{link.hint}</em>
            </a>
          ))}
        </nav>
      </aside>
    </div>
  );

  return (
    <>
      <button
        type="button"
        className={`account-trigger${signedIn ? " on" : ""}`}
        aria-label="Account menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {signedIn ? (
          <span className="account-trigger-initial">{initial}</span>
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="8" r="3.4" stroke="currentColor" strokeWidth="1.8" />
            <path d="M5 19.2c0-3.3 3.1-5.2 7-5.2s7 1.9 7 5.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        )}
      </button>
      {open && typeof document !== "undefined" ? createPortal(drawer, document.body) : null}
    </>
  );
}
