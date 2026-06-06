"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { getDashboardLoginUrl } from "@/lib/auth/client-auth-navigation";

type NavIconName =
  | "matches"
  | "tournaments"
  | "history"
  | "star"
  | "dashboard"
  | "hub"
  | "resource";

const WATCH_LINKS: { href: string; label: string; hint: string; icon: NavIconName }[] = [
  { href: "/", label: "Matches", hint: "TST · Fort", icon: "matches" },
  { href: "/tournaments", label: "Tournaments", hint: ".aarec replays", icon: "tournaments" },
  { href: "/me", label: "My matches", hint: "your history", icon: "history" },
  { href: "/?fav=1", label: "Favourites", hint: "starred matches", icon: "star" },
];

const RCL_LINKS: { href: string; label: string; hint: string; icon: NavIconName }[] = [
  { href: "https://retrocyclesleague.com/dashboard", label: "Dashboard", hint: "profile · logins", icon: "dashboard" },
  { href: "https://hub.retrocyclesleague.com", label: "Hub", hint: "leaderboard · stats", icon: "hub" },
  { href: "https://resource.retrocyclesleague.com", label: "Resource", hint: "maps · configs", icon: "resource" },
];

function NavIcon({ name }: { name: NavIconName }) {
  const c = {
    width: 18,
    height: 18,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  switch (name) {
    case "matches":
      return (
        <svg {...c}>
          <rect x="3" y="3" width="7" height="7" rx="1.5" />
          <rect x="14" y="3" width="7" height="7" rx="1.5" />
          <rect x="3" y="14" width="7" height="7" rx="1.5" />
          <rect x="14" y="14" width="7" height="7" rx="1.5" />
        </svg>
      );
    case "tournaments":
      return (
        <svg {...c}>
          <path d="M8 21h8M12 17v4" />
          <path d="M7 4h10v4a5 5 0 0 1-10 0V4Z" />
          <path d="M5 9a3 3 0 0 1-3-3V5h3M19 9a3 3 0 0 0 3-3V5h-3" />
        </svg>
      );
    case "history":
      return (
        <svg {...c}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
      );
    case "star":
      return (
        <svg {...c}>
          <path d="m12 3 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9 6.8 19.2l1-5.8L3.5 9.2l5.9-.9L12 3Z" />
        </svg>
      );
    case "dashboard":
      return (
        <svg {...c}>
          <rect x="3" y="3" width="7" height="9" rx="1.5" />
          <rect x="14" y="3" width="7" height="5" rx="1.5" />
          <rect x="14" y="12" width="7" height="9" rx="1.5" />
          <rect x="3" y="16" width="7" height="5" rx="1.5" />
        </svg>
      );
    case "hub":
      return (
        <svg {...c}>
          <line x1="6" x2="6" y1="20" y2="13" />
          <line x1="12" x2="12" y1="20" y2="4" />
          <line x1="18" x2="18" y1="20" y2="9" />
        </svg>
      );
    case "resource":
      return (
        <svg {...c}>
          <path d="m12 2 9 5-9 5-9-5 9-5Z" />
          <path d="m3 12 9 5 9-5" />
          <path d="m3 17 9 5 9-5" />
        </svg>
      );
    default:
      return null;
  }
}

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
        <div className="account-topbar">
          <span className="account-brand">
            RCL <em>Watch</em>
          </span>
          <button type="button" className="account-close" aria-label="Close" onClick={() => setOpen(false)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>

        <div className={`account-card${signedIn ? "" : " guest"}`}>
          <span className={`account-avatar${signedIn ? " on" : ""}`}>
            {signedIn ? initial : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                <circle cx="12" cy="8" r="3.4" />
                <path d="M5 19.2c0-3.3 3.1-5.2 7-5.2s7 1.9 7 5.2" strokeLinecap="round" />
              </svg>
            )}
          </span>
          <div className="account-id">
            <strong>{signedIn ? username || email?.split("@")[0] : "Guest"}</strong>
            <span>{signedIn ? email : "Not signed in"}</span>
          </div>
          {!signedIn && (
            <button type="button" className="account-login" onClick={handleLogin}>
              Log in
            </button>
          )}
        </div>

        <div className="account-scroll">
          <p className="account-section">Watch</p>
          <nav className="account-links">
            {WATCH_LINKS.map((link) => (
              <Link key={link.href} href={link.href} prefetch={false} className="account-link" onClick={() => setOpen(false)}>
                <span className="account-link-icon">
                  <NavIcon name={link.icon} />
                </span>
                <span className="account-link-body">
                  <span>{link.label}</span>
                  <em>{link.hint}</em>
                </span>
                <span className="account-link-chevron" aria-hidden>
                  ›
                </span>
              </Link>
            ))}
          </nav>

          <p className="account-section">Retrocycles League</p>
          <nav className="account-links">
            {RCL_LINKS.map((link) => (
              <a key={link.href} href={link.href} target="_blank" rel="noreferrer" className="account-link">
                <span className="account-link-icon">
                  <NavIcon name={link.icon} />
                </span>
                <span className="account-link-body">
                  <span>{link.label}</span>
                  <em>{link.hint}</em>
                </span>
                <span className="account-link-chevron" aria-hidden>
                  ↗
                </span>
              </a>
            ))}
          </nav>
        </div>

        {signedIn && (
          <button type="button" className="account-signout" onClick={() => void handleSignOut()}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <path d="m16 17 5-5-5-5M21 12H9" />
            </svg>
            Sign out
          </button>
        )}
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
