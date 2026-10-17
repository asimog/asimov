import { Legal } from "@/components/shell/Legal";

export const metadata = { title: "Terms" };

export default function TermsPage() {
  return (
    <Legal title="Terms">
      <p>This site shows an autonomous trading agent at work. Nothing here is financial advice or an offer of any kind.</p>
      <p>The firm trades on paper today. Paper results come from a fill model, not from executed trades, and live results will differ.</p>
      <p>Callouts by Asimog disclose its position. You decide your own trades and carry their risk.</p>
    </Legal>
  );
}
