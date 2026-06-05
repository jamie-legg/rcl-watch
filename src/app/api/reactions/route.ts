import { NextResponse } from "next/server";
import {
  getCurrentProfileId,
  getRatingTotals,
  getUserReactions,
  isMatchKind,
  setReaction,
  ZERO_TOTALS,
  type RatingTotals,
  type UserReaction,
} from "@/lib/reactions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ReactionsPayload = {
  totals: Record<string, RatingTotals>;
  mine: Record<string, UserReaction>;
  signedIn: boolean;
};

// GET /api/reactions?kind=tst&ids=a,b,c
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const kind = searchParams.get("kind");
  const idsParam = searchParams.get("ids") ?? "";
  const ids = idsParam.split(",").map((s) => s.trim()).filter(Boolean);

  if (!isMatchKind(kind)) {
    return NextResponse.json({ error: "invalid kind" }, { status: 400 });
  }

  const profileId = await getCurrentProfileId();
  const totalsMap = await getRatingTotals(kind, ids);
  const mineMap = profileId ? await getUserReactions(profileId, kind, ids) : new Map();

  const payload: ReactionsPayload = {
    totals: Object.fromEntries(totalsMap),
    mine: Object.fromEntries(mineMap),
    signedIn: Boolean(profileId),
  };
  return NextResponse.json(payload);
}

// POST /api/reactions  { kind, id, favorite?, vote? }
export async function POST(request: Request) {
  const profileId = await getCurrentProfileId();
  if (!profileId) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const { kind, id, favorite, vote } = (body ?? {}) as {
    kind?: unknown;
    id?: unknown;
    favorite?: unknown;
    vote?: unknown;
  };

  if (!isMatchKind(kind)) {
    return NextResponse.json({ error: "invalid kind" }, { status: 400 });
  }
  if (typeof id !== "string" || !id.trim()) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  const patch: { favorite?: boolean; vote?: -1 | 0 | 1 } = {};
  if (typeof favorite === "boolean") patch.favorite = favorite;
  if (vote === -1 || vote === 0 || vote === 1) patch.vote = vote;
  if (patch.favorite === undefined && patch.vote === undefined) {
    return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  }

  try {
    const result = await setReaction(profileId, kind, id.trim(), patch);
    return NextResponse.json(result);
  } catch {
    return NextResponse.json(
      { error: "Could not save reaction", reaction: { favorite: false, vote: 0 }, totals: ZERO_TOTALS },
      { status: 500 },
    );
  }
}
