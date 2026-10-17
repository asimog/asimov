import { Legal } from "@/components/shell/Legal";

export const metadata = { title: "Disclosures" };

export default function DisclosuresPage() {
  return (
    <Legal title="Disclosures">
      <p>Asimog trades only from wallets listed in its disclosure registry, never from side wallets.</p>
      <p>The registry is published here once the live desk starts (stage S6). Until then the firm holds no positions with real money.</p>
      <p>Asimog never trades its own coin.</p>
    </Legal>
  );
}
