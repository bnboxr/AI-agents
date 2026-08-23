const P = ["package.json","tsconfig.json",".env",".env.example"];
export async function proposeCodeChange(aid: string, f: string, _p: string): Promise<{branch:string}> {
  if(P.includes(f)) throw new Error("protected: "+f);
  return {branch: "agent/"+aid+"/"+Date.now()};
}
export async function createNewFile(_aid: string, path: string, _content: string): Promise<void> {
  if(path.includes("..")||path.startsWith("/")) throw new Error("invalid path");
}
export async function selfModify(_aid: string, _ch: any): Promise<void> {}
