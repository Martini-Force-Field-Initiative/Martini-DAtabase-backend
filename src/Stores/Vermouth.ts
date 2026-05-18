import { inspect } from "node:util";

const PolyplyTargetLibs = ["martini2", "martini3"];
export type PolyplyTargetLib = typeof PolyplyTargetLibs[number];
const isPolyplyTargetLib = (o: unknown): o is PolyplyTargetLib => {
  return typeof o === 'string' && PolyplyTargetLibs.includes(o);
};

export interface VermoutLib {
  name: string,
  files: string[],
  target_polyply_lib: PolyplyTargetLib,
  metadata? : {
    comments:string,
    cite:string
  },
}

export const parseVermouthLib = (o:any): VermoutLib => {
  if (!('name' in o))
    throw (`ForceFieldStore:parseVermouthLib has no name  ${inspect(o)}`);
  if (!('files' in o))
    throw (`ForceFieldStore:parseVermouthLib has no files  ${inspect(o)}`);
  if(!Array.isArray(o.files))
    throw (`ForceFieldStore:parseVermouthLib files is not an array  ${inspect(o)}`);
  o.files.forEach((f:any) => {
    if (typeof f !== 'string')
      throw (`ForceFieldStore:parseVermouthLib file is not a string  ${inspect(o)}`);
  })
  if (!('target_polyply_lib' in o))
    throw (`ForceFieldStore:parseVermouthLib has no target_polyply_lib  ${inspect(o)}`);
  if(!isPolyplyTargetLib(o.target_polyply_lib))
    throw (`ForceFieldStore:parseVermouthLib target_polyply_lib is not a PolyplyTargetLib  ${inspect(o)}`);

  return {
    'name' : o.name,
    'files' : o.files,
    'target_polyply_lib' : o.target_polyply_lib,
    'metadata' : o.metadata ?? undefined
  };
}