// The relay base URL, chosen by env: shared by server pages and the client store (lib/live.ts is a client module).
export const RELAY = process.env.NEXT_PUBLIC_RELAY_URL ?? "http://localhost:7401";
