export type MusicTrack = {
  title: string;
  artist: string;
  src: string;
};

// Crys (Ellis) — soundtrack layered over the in-game audio. Files live in
// `public/music/` (gitignored, deployed via scp). A missing file is skipped
// gracefully by the player.
export const MUSIC_TRACKS: MusicTrack[] = [
  { title: "flatlining", artist: "crys", src: "/music/crys-flatlining.mp3" },
  { title: "friend", artist: "crys", src: "/music/crys-friend.mp3" },
  { title: "impure", artist: "crys", src: "/music/crys-impure.mp3" },
  { title: "stolen city", artist: "crys", src: "/music/crys-stolen-city.mp3" },
  { title: "thinking about thinking about thinking", artist: "crys", src: "/music/crys-thinking.mp3" },
  { title: "hope for a better tomorrow", artist: "crys", src: "/music/crys-hope-for-a-better-tomorrow.mp3" },
  { title: "0530121524", artist: "crys", src: "/music/crys-0530121524.mp3" },
];
