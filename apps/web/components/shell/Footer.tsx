import Link from "next/link";

export function Footer() {
  return (
    <footer className="footer micro">
      <nav aria-label="Legal and proofs">
        <Link href="/terms">Terms</Link>
        <Link href="/privacy">Privacy</Link>
        <Link href="/disclosures">Disclosures</Link>
        <Link href="/treasury">Proofs</Link>
        <Link href="/charter">Constitution</Link>
      </nav>
      <p>Paper trading. No live money yet. Not financial advice.</p>
    </footer>
  );
}
