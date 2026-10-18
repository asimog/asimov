// Graph state in Postgres (docs/18): one LangGraph checkpoint thread per job, in the agents schema.
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";

export async function makeCheckpointer(url: string): Promise<PostgresSaver> {
  const saver = PostgresSaver.fromConnString(url, { schema: "agents" });
  await saver.setup();
  return saver;
}
