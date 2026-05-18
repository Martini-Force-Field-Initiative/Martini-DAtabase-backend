// Taken from backend identical interface defintions
import { FileFromHttp } from "../../../types";
import { Readable } from "stream";
export interface PolymerView {
  targetPolyplyLib: string;
  vermouthLibs: string[];

  directed: boolean;
  multigraph: boolean;
  graph: { [k: string]: any };
  nodes: NodeView[];
  links: LinkView[];
}

export interface NodeView {
  resname: string;
  seqid: number;
  id: number;
  from_itp?: string;
}

export interface LinkView {
  source: number;
  target: number;
}

export interface VermouthHolder {
  vermouthLibs: string[];
}

export interface ClientPipelineInputsGRO extends VermouthHolder {
  //forcefield:string,
  itp: FileFromHttp;
  userStartGRO?: FileFromHttp;
  userStartITP?: UserModelItps;
  listGraphComponent: string[][];
  //uiPatchedLinks: string[]; // it is appended to the userStartITP.content
  name: string;
  box: string;
  number: string;
}
export interface GenerateITPInputs extends VermouthHolder {
  polymer: PolymerView;
  name: string;
  customITP: {
    customMolecules?: string; // all uploaded itp in a single file
    customLinks: string;
    userStart?: UserModelItps;
  };
}

export interface UserModelItps {
  // Taken from front-end identical interface defintion
  moleculeITP: FileFromHttp[];
  goITP?: [FileFromHttp, FileFromHttp];
  elasticITP?: FileFromHttp[];
}

export interface ClientPipelineInputsPDB extends VermouthHolder {
  itp: FileFromHttp;
  readyGro: string;
  userStartITP?: UserModelItps;
  readyTop: string;
  name: string;
  userId: string;
  doSendEmail: boolean;
  targetPolyplyLib: string;
}

export interface ClientPipeLineFinalFilesBundle {
  /* coarse_grained: [ string, "polymer.pdb" ],
       gro           : [ string, "polymer.gro" ],
       top_file      : [ string, "polymer.top" ],
       itp_files      : [ string, string][][] */
  pdb: FileFromHttp;
  gro: FileFromHttp;
  top: FileFromHttp;
  itps: FileFromHttp[];
}

export interface ClientPipeLineResult {
  jobid: string;
  files: ClientPipeLineFinalFilesBundle;
}
