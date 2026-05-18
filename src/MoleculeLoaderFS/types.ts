import { MulterLikeFile } from '../types';
import { MoleculeBundle } from './fsBundle';
import { AvailableForceField } from '../Stores/ForceFieldStore';

export interface OMD {
  name:string, alias:string, category:string[], forcefield:AvailableForceField
};

/** VersionDatum
 * The version of a molecule which stored in a files bundle 
 * It features a unique combination of:
 * - force-field
 * - number
*/
export interface VersionDatum extends VersionCore {
    __bundle__:MoleculeBundle,
    directory: string;
    itp: MulterLikeFile,
    top: MulterLikeFile,
    map: MulterLikeFile[],
    others: MulterLikeFile[],
    gro: MulterLikeFile,
    pdb: MulterLikeFile,
    protonation?: string,
    comments: string,
    citation: string,
    command_line: string
    inserted?: boolean;
    id:string, // this is the bundle id
    customTags?: string[],
    create_way: string, // moved from MoleculeDatum

  };
  
  export interface VersionCore {
    number: string,
    force_field: string
  }
  
  /** MoleculeDatum
   * A collection of versions of the same molecule
   * Versions of the same molecule share the same ALIAS property
   * Collection can be splited to regroup version of similar ALIAS and FORCE_FIELD
   */
  export interface MoleculeDatum {
    versions: VersionDatum[],
    /* Name of the molecule */
    name: string,
    alias: string,
    category: string[],
    //directory: string, // Should be removed or not if used to return obj from DB ???
  };



export type stageTree = { [K in AvailableForceField]? : { [alias:string]: MoleculeDatum } };
/* eg:
const g:stageTree = {
  "elnedyn" : { "POPC" : <MoleculeDatum>}
};
*/

export interface MoleculeVersion { 
  version : VersionDatum
  children : MoleculeVersion[]
  root: boolean;
}

  //export type BatchElement = [MoleculeDatum, MoleculeBundle];