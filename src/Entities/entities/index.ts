import { ConcreteMolecule, UserRole } from '../../types';
import { MergeRightPrio } from '../../types/generics';
export interface BaseCouchDocument {
  _id?: string;
  _rev?: string;
  update_date?: string; 
}

type Configuration = "handmade" | "automatic";

export interface AbstractBaseMolecule extends BaseCouchDocument {
  /** Molecule snowflake ID */
  id: string;
  /** Tree snowflake ID. Shared between parent and children */
  tree_id: string;
  /** Stringified ISO date of creation date */
  created_at: string;

  /** Hash of generated zip file attached to this molecule */
  hash: string;
  /** Reference to <User.id> owner/curator of this mol */
  owner: string;
  /** ID of related file containing `.itp` and `.gro`/`.pdb` files */
  files: string;
  
  /** Boolean for setting this molecule as the latest among the tree elements */
  latest:boolean;
  /** string describing if the coordinates configuration are reliable or produced by us through slow cooking */
  configuration:Configuration;
}
// Local type that extends and reshape request molecule
export type BaseMolecule = Required<MergeRightPrio<ConcreteMolecule, AbstractBaseMolecule>>;

const x:BaseMolecule = {

  name: "kik",
  /** Molecule short alias */
  alias: "kik",
  /** Mol smiles formula (optional) */
  smiles: "kik",
  /** Category, should be a GO Term */
  //@ts-ignore
  category: "MC:0002",
  /** Molecule version (free text) */
  version: "kik",
  /** Free comment text. */
  //comments: "kik",
  /** Citation */
  citation:  "kik",
  /** Information about a protein validation, model quality */
  validation:  "kik",
  /** String version of the used command line (other parameters) */
  command_line:  "kik",
  /** Way to create the martinized molecule (id that refers in create_way field of settings.json) */
  create_way:  "kik",
  /** Force field version */
  force_field:  "kik",
}

export interface Molecule extends BaseMolecule {
  /** <User.id> that have approved this molecule */
  approved_by: string;
  /** Last time as ISO date the user/admin edited this molecule */
  last_update: string;
}

export interface StashedMolecule extends BaseMolecule {}

export interface User extends BaseCouchDocument {
  /** User snowflake ID */
  id: string;
  /** User unique e-mail address */
  email: string;
  /** Display name */
  name: string;
  /**full name provided by user */
  fullname: string;
  /**affiliation provided by user */
  affiliation: string; 
  /** Stringified ISO Date of the user creation */
  created_at: string;
  /** bcrypt-hashed password of the user */
  password: string;
  /** User role */
  role: UserRole;
  /** Is approved or not */
  approved: boolean;
  /** Lost token ID */
  lost_token?: string;

}

export interface Token extends BaseCouchDocument {
  /** JTI UUID snowflake */
  id: string;
  /** <User.id> who own this token */
  user_id: string;
  /** Stringified ISO date of the token creation */
  created_at: string;
}

// extract all lennar johns > grep -P "^\s*(?'g1'\S+)\s+(\k{g1})\b" kwalp/martini_v.3.0.4.26/martini_v3.0.4.itp | sort | cut -d' ' -f-2,4- | uniq
export interface VanDerWaalsRadius extends BaseCouchDocument {
  /** Martinize force field related to the defined radius. It is a reference to _id, when it's present. */
  id: string;
  /** Map between atom name > van der waals radii. */
  atoms: {
    /** Van der Waals Radii */
    [name: string]: number
  };
}

export interface Lipid extends BaseCouchDocument {
  /** Lipid id. DO NOT USE. */
  id: string;
  /** Lipid short name. */
  name: string;
  /** Content of the ITP file for this lipid. */
  itp: string;
}

export interface History extends BaseCouchDocument {
  id : string; //user id
  job_ids : string[]; 
}

