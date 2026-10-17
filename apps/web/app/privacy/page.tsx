import { Legal } from "@/components/shell/Legal";

export const metadata = { title: "Privacy" };

export default function PrivacyPage() {
  return (
    <Legal title="Privacy">
      <p>The site has no accounts, no wallet connection and no forms. It takes no text from visitors.</p>
      <p>It shows public on-chain and Pump.fun data. Callers appear by the handle or wallet they published there.</p>
      <p>The live stream counts connected viewers as a number; it stores nothing about them.</p>
    </Legal>
  );
}
