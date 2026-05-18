import { AvailableForceField } from '../../Stores/ForceFieldStore';
import { BaseCouchDocument } from '.';
import { FilePathOrTupleStream } from "../../helpers/inputs";

export type AnyJob = MoleculeBuilderJob | PolyplyJob;
export function isMoleculeBuilderJob(o:unknown): o is MoleculeBuilderJob {
    if(typeof(o) !== "object")
        return false;
    if(o ===null)
        return false;
    if ( 'type' in o )
       return o.type === "martinize";
    return false;
}

export function isPolyplyJob(o:unknown): o is PolyplyJob {
    if(typeof(o) !== "object")
        return false;
    if(o ===null)
        return false;
    if ( 'type' in o )
       return o.type === "polyply";
    return false;
}

export interface AnyJobFilesNames {
    gro: any; // just job files names or job files content
    coarse_grained: FilePathOrTupleStream;
    itp_files: FilePathOrTupleStream[][];
    top_file: FilePathOrTupleStream;
}
export interface MoleculeBuilderJobFilesNames extends AnyJobFilesNames{
    all_atom:FilePathOrTupleStream;
    warnings: FilePathOrTupleStream;
}

export interface PolyplyJobFilesNames extends AnyJobFilesNames { }
  
  export interface AnyJobReadedFiles {
    gro: ReadedFile
    all_atom?: ReadedFile
    coarse_grained: ReadedFile
    itp_files: ReadedFile[][]
    top_file: ReadedFile
    warnings?: ReadedFile
  }
  
  export interface ReadedFile {
    content: string;
    type: string;
    name: string;
  }
  
  export interface MoleculeBuilderJobSettings {
    builder_mode: "classic" | "go" | "elastic";
    ff: AvailableForceField;
    advanced?: boolean;
    commandline?: string;
    cter: "COOH-ter";
    nter: "NH2-ter";
    sc_fix: boolean;
    position: "backbone" | "all" | "none"
    cystein_bridge: "none" | "auto"
    elastic?: boolean;
    use_go?: boolean;
    ea?: number;
    ef?: number;
    el?: number;
    em?: number;
    ep?: number;
    eu?: number;
  }
  export function isMoleculeBuilderJobSettings(o:unknown): o is MoleculeBuilderJobSettings {
        if(typeof(o) !== "object")
            return false;
        if(o ===null)
            return false;
        if ( 'builder_mode' in o )
            if(Object.keys(o).length == 1)
                return false
        return true
  }

  // Polyplysettings for now we don't reeally why it should contain stuff
  // these look like fillers, actually important specifics of a polyply run may be put instead 

  /** from previous history router
    if (data["polymer"]["forcefield"] === "martini3") 
        settings = { ff: "martini3001", position: "none", cter: "COOH-ter", nter: "NH2-ter", sc_fix: false, cystein_bridge: "auto", builder_mode: "classic", send_mail: false, user_id: data["userId"] }
    else if (data["polymer"]["forcefield"] === "martini2") 
        settings = { ff: "martini22", position: "none", cter: "COOH-ter", nter: "NH2-ter", sc_fix: false, cystein_bridge: "auto", builder_mode: "classic", send_mail: false, user_id: data["userId"] }
    else {
        logger.warn(`[route:polymer_generator::add_to_history] Unregistred forcefield \"${data["polymer"]["forcefield"]}\"`);
        settings = { ff: "martini3001", position: "none", cter: "COOH-ter", nter: "NH2-ter", sc_fix: false, cystein_bridge: "auto", builder_mode: "classic", send_mail: false, user_id: data["userId"] }
    }

   */
  export interface PolyplyJobSettings {
    ff: AvailableForceField;
  }
  export function isPolyplyJobSettings(o:unknown): o is PolyplyJobSettings {
    if(typeof(o) !== "object")
        return false;
    if(o ===null)
        return false;
    if ( 'ff' in o )
        return Object.keys(o).length == 1;
    
    return false;
}
 
  
  export interface ReadedJob extends JobBase {
    files: AnyJobReadedFiles
  }
  
  export interface JobBase extends BaseCouchDocument {
    id: string; 
    jobId: string; 
    userId : string; 
    date : string; 
    name : string;
    radius : {[atom_name : string] : number};
  }

export interface MoleculeBuilderJob extends JobBase {
    type : "martinize"; 
    
    manual_bonds_edition?: boolean; 
    comment?: string;
    settings : MoleculeBuilderJobSettings; 
    files:MoleculeBuilderJobFilesNames;
}

export interface PolyplyJob extends JobBase {
    type : "polyply";
    settings: PolyplyJobSettings; 
    files: PolyplyJobFilesNames;
} 
