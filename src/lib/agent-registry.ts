export interface DynamicAgent {
  id: string; name: string; specialization: string; model: string;
  systemPrompt: string; capabilities: string[]; memory: Record<string, any>;
  status: "idle" | "working" | "evolving"; version: number; parent?: string;
  createdAt: number; updatedAt: number;
}
const agents = new Map<string, DynamicAgent>();
export async function loadAgents(): Promise<DynamicAgent[]> { return Array.from(agents.values()); }
export async function registerAgent(a: DynamicAgent): Promise<void> { agents.set(a.id, a); }
export async function updateAgent(id: string, ch: Partial<DynamicAgent>): Promise<void> {
  const a = agents.get(id); if(a) Object.assign(a, ch, {updatedAt: Date.now(), version: a.version+1});
}
export async function spawnAgent(pid: string, spec: string): Promise<DynamicAgent> {
  const p = agents.get(pid);
  const c: DynamicAgent = { id: "a-"+Date.now(), name: spec, specialization: spec, model: p?.model??"local",
    systemPrompt: "You are a "+spec+" agent.", capabilities: [spec], memory: {}, status: "idle", version: 1,
    parent: pid, createdAt: Date.now(), updatedAt: Date.now() };
  agents.set(c.id, c); return c;
}
export async function deleteAgent(id: string): Promise<void> { agents.delete(id); }
export async function dissolveAgent(id: string): Promise<void> { agents.delete(id); }
