const P = ["package.json","tsconfig.json",".env",".env.example"];
export async function proposeCodeChange(aid: string, f: string, p: string): Promise<{branch:string}> {
  if(P.includes(f)) throw new Error("protected: "+f);
  return {branch: "agent/"+aid+"/"+Date.now()};
}
export async function createNewFile(aid: string, path: string, content: string): Promise<void> {
  if(path.includes("..")||path.startsWith("/")) throw new Error("invalid path");
}
export async function selfModify(aid: string, ch: any): Promise<void> {}
