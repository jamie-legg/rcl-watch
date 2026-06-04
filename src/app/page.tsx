import Link from "next/link";

const DEMO_MATCH_ID = "69b85ba1c5015455ee9b0412";

export default function Home() {
  return (
    <main className="home-shell">
      <section className="home-card">
        <header className="brand">
          <span className="brand-mark">
            Retrocycles <em>League</em>
          </span>
          <span className="brand-tag">RCL · WATCH</span>
        </header>

        <p className="eyebrow">Cinematic match playback</p>
        <h1 className="display">
          Replay the
          <br />
          <span className="ghost">Grid</span>
        </h1>
        <p className="lede">
          Reconstructed Armagetron matches from cached tronstats logs — accurate cycle physics, finite walls that
          recede along the odometer, the shrinking sumo zone, and explosions on death. Built for the Retrocycles League.
        </p>

        <ul className="feature-row">
          <li className="feature">
            <strong>True wall physics</strong>
            <span>CYCLE_WALL_LENGTH 400 + 8s death decay</span>
          </li>
          <li className="feature">
            <strong>Sumo zone</strong>
            <span>The fortress shrinks as the round runs</span>
          </li>
          <li className="feature">
            <strong>Director cameras</strong>
            <span>Cinematic, smart follow, and cycle POV</span>
          </li>
        </ul>

        <Link className="launch-link" href={`/watch/${DEMO_MATCH_ID}`}>
          Launch demo playback ▸
        </Link>
      </section>
    </main>
  );
}
