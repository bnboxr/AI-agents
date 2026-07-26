import { loadAgents, updateAgent, type DynamicAgent } from "./agent-registry";
import { queryFirstResponse } from "./llm/multi-provider";
export class GenericAgent {
  constructor(public config: DynamicAgent) {}
  async execute(task: string): Promise<string> {
    const r = await queryFirstResponse([{role:"system",content:this.config.systemPrompt},{role:"user",content:task}]);
    this.config.memory.lastResult = r; this.config.memory.lastTask = task;
    await updateAgent(this.config.id, {memory: this.config.memory, status: "idle"}); return r;
  }
  async evolve(): Promise<void> { this.config.version++; await updateAgent(this.config.id, {version: this.config.version}); }
}
export async function runAllAgents(): Promise<void> { console.log("[Runner] "+(await loadAgents()).length+" agents"); }
