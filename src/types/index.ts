import { SharedProperties } from './generics';


export const GoTerms = {
  "MC:0001": "<Go Term Regular Name>",
  "MC:0005": "",
  "MC:0002": "",
  "MC:0003": "",
  "MC:0004": "",
};
export type GoTerm = keyof typeof GoTerms;
export const isGoTerm = (a:any): a is GoTerm => {
  return Object.keys(GoTerms).includes(a);
}

export interface MoleculeLoaderUser {
  id:string;
  role:string;
}

export const translateGoName = (o:GoTerm) => {

}

export type UserRole = "admin" | "curator" | "dev";

/* A type common to files from http request-multer ot filesystem*/
export type MulterLikeFile = SharedProperties<Express.Multer.File, {
      "originalname" : string, 
      "size" : number,
      "path" : string;
  }>;
export interface JSONWebTokenPartial {
  /** Issued at */
  iat: string;
  /** Expiration (timestamp) */
  exp: string;
  /** Issuer */
  iss: string;
  /** ID */
  jti: string;
}

export interface TokenPayload {
  user_id: string,
  created_at: string;
}

export type JSONWebToken = JSONWebTokenPartial & TokenPayload;



interface ForceFielsdInfo {
  [ff_name: string]: {
    polarizable: boolean
  };
}

/* element common between request and Couch reflection */
export interface ConcreteMolecule {
  id?:string,
  /** Molecule name (free text) */
  name: string;
  /** Molecule short alias */
  alias: string;
  /** Mol smiles formula (optional) */
  smiles: string;
  /** Category, should be a GO Term */
  category: GoTerm[];
  /** Molecule version (free text) */
  version: string;
  /** Free comment text. */
  comments: string;
  /** Citation */
  citation: string;
  /** Information about a protein validation, model quality */
  validation: string;
  /** String version of the used command line (other parameters) */
  command_line: string;
  /** Way to create the martinized molecule (id that refers in create_way field of settings.json) */
  create_way: string;
  /** Force field version */
  force_field: string;
  /** Tree snowflake ID. Shared between parent and children */
  tree_id?: string;
  alternative_alias?: string[];
  fromVersion?:any
  /** Molecule parent version. If string, ref to <Molecule.id> */
  parent: null | string;
  /** representative of the tree */
  latest:boolean;
  /** Tags displayed in molecule entry viewer, list of strings eg : lipid2025*/
  tags?: string[],
}

export interface MoleculeLoadRequest {
  full_user: {
    id: string,
    role: string
  };
  body:ConcreteMolecule; /*{
    name: string,
    alias: string,
    smiles: string,
    version: string,
    category: string[],
    command_line: string,
    comments: string,
    create_way: string,
    force_field: string,
    validation: string,
    citation: string,
    parent: string | null
    tree_id?: string
    fromVersion?:any
    alternative_alias?:string[]
  }*/
  files: {
    itp: MulterLikeFile[],
    pdb: MulterLikeFile[],
    gro: MulterLikeFile[],
    top: MulterLikeFile[] | [],
    map: MulterLikeFile[] | [],
    others: MulterLikeFile[] | []
  };
}

export interface FileFromHttp {
  name: string; 
  type: string; 
  content: string; 
}