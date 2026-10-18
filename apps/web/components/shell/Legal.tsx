import type { ReactNode } from "react";

/** Legal pages are written by counsel (docs/UI.md). Until then each page states only what is true of the site today. */
export function Legal({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="room">
      <header className="room-head">
        <div>
          <h1>{title}</h1>
          <p>Counsel writes this page. Until counsel publishes it, these are the facts that hold today.</p>
        </div>
      </header>
      <article className="prose">{children}</article>
    </main>
  );
}
