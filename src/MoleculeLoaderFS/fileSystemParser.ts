
import logger from "../logger";
import { VersionDatum } from "./types";
import { parseItpComments, ItpCommentFieldError, ItpCommentFields } from '../helpers/itp/meta_comments';

import { dirRecursive } from './utils';

import { MoleculeBundle } from './fsBundle';
import { glob } from 'glob';
import SettingsWrapper from "../helpers/settingsManager";
import { inspect } from "util";


export type FolderLocation = string;
type ItpFieldExceptions = string;
export type ParserExceptionReason = 'Not found' | 'Too many';
export type ParserExceptionType = "itpNumber"| "groNumber" | "topNumber" | "itpMissingField" | "other" | "pdbNumber";
export type ParserExceptions = Partial< Record<ParserExceptionType, ParserExceptionReason>>;



interface BatchValidationStage {
    errors  : MoleculeDatumFailure[],
    batched : MoleculeDatum[]
}


export interface MoleculeDatumFailure{
    bundle : MoleculeBundle,
    error : MolecularDatumValidationError
}

export interface MolecularDatumValidationError {
    fileFailures:ParserExceptions,
    itpFailures?:ItpFieldExceptions,
};

//const validateMoleculeBundle = async(path:string):

export class MoleculeDatum {
    versions: VersionDatum[];
    name: string;
    alias: string;
    _category?: string[];
    

    // Quick and dirty duck typing
    static isa(a:any): a is MoleculeDatum {
        if(typeof a !== 'object')
            return false;
        const _ = new Set<string>( Object.keys(a) );
       
        return _.has('versions') && _.has('name') &&_.has('alias');
    }
    static async update(mDatum:MoleculeDatum) {

    }
    static async create(m:MoleculeBundle, ic:ItpCommentFields) {
        const md = new MoleculeDatum(m, ic);
        const settings = await SettingsWrapper.getSettingsWrapper();
        md._category = ic.category.map( (c) => settings.reverse_category(c));
        return md;
    }
    
    constructor(m:MoleculeBundle, ic:ItpCommentFields) {
        logger.debug(`[fileSystemParser:MoleculeDatum] itp fields:\n${inspect(ic)}`);
      //  console.log("MMI" + inspect(SettingsWrapper.reverse_category_tree));
      //  console.log('KIKOI' + SettingsWrapper.reverse_category_tree[ic.category]);
        this.name     = ic.name;
        this.alias    = ic.alias;
       
       // console.log("KIKI" + inspect(this.category));
        this.versions = [ {
            ...m.asJSON(),
            id : m.id,
            __bundle__       : m,
            number       : ic.version,
            force_field  : ic.forceField,
            comments     : ic.comments ?? '',
            citation     : ic.references ?? '',
            command_line : ic.cmdLine ?? '',
            create_way : "hand",
        } ];
    }
    get category() {
        return this._category ?? [];
    }
    /** 
     * Parse a folder for molecule-model informations and file
     * 
    */
    static async parse(inputDirOrArchive:string):Promise<MoleculeDatum|MoleculeDatumFailure> {
        logger.debug(`[fileSystemParser:parse] reading from ${inputDirOrArchive}...`);
        const m =  await MoleculeBundle.create(inputDirOrArchive);
       
        const error:MolecularDatumValidationError = { fileFailures : {} };

        if (m.nb_itp > 1)
            error.fileFailures['itpNumber'] = 'Too many';
        else if (m.nb_itp == 0)
            error.fileFailures['itpNumber'] = 'Not found';

        if (m.nb_gro > 1)
            error.fileFailures['groNumber'] = 'Too many';
        else if (m.nb_gro == 0)
            error.fileFailures['groNumber'] = 'Not found';

        if (m.nb_top > 1)
            error.fileFailures['topNumber'] = 'Too many';
        else if (m.nb_top == 0)
            error.fileFailures['topNumber'] = 'Not found';

        if (m.nb_pdb > 1)
            error.fileFailures['pdbNumber'] = 'Too many';
        else if (m.nb_pdb == 0)
            error.fileFailures['pdbNumber'] = 'Not found';

        if (m.nb_itp == 0)
            error.fileFailures['itpNumber'] = 'Not found';

        if (m.nb_itp > 1)
            error.fileFailures['itpNumber'] = 'Too many';  

        
        if ( m.nb_itp != 1 ) {
            return {
                bundle:m,
                error                    
            } as MoleculeDatumFailure;
        }
        // ITP parsing section
        let itpInfos:ItpCommentFields;
        try {
            itpInfos = await parseItpComments(m.itp);
            return await MoleculeDatum.create(m, itpInfos);           
        } catch(e) {
            if(e instanceof ItpCommentFieldError ) {
            //Catch the missing field error
                error.itpFailures = e.message;
                return {
                    bundle:m,
                    error                    
                } as MoleculeDatumFailure;
            } else {
                logger.debug(e);
                throw(`[MoleculeDatum:parser] : Unexpected error parsing ${m.itpFilePath}`);
            }
        }
    }   
  };


export const parseManyMoleculeData = async (path: string):Promise<BatchValidationStage> => { 
    const errors:MoleculeDatumFailure[]        = [];
    const batched:MoleculeDatum[] = [];
    
    logger.debug(`[parseManyMoleculeData] ... starting @${path}`);
    for ( let inputDir of dirRecursive(path) ) {
        const res = await MoleculeDatum.parse(inputDir)

        if (MoleculeDatum.isa(res) )
            batched.push(res);
        else
            errors.push(res);  
    }
    return { errors, batched };
}

export const parseManyMoleculeArchives = async (path: string):Promise<BatchValidationStage> => { 
    const errors:MoleculeDatumFailure[]        = [];
    const batched:MoleculeDatum[] = [];
    // ppbly sanitize path name
    const maybeArch = await glob(path);
    logger.debug(`[parseManyMoleculeArchives] Found ${maybeArch.length} archive file(s) matching expression \"@${path}\"`);
    for ( let archiveFile of maybeArch ) {
        //logger.debug(`[parseManyMoleculeArchives] found what maybe archive @\"${archiveFile}\"`);
        const res = await MoleculeDatum.parse(archiveFile);
        if (MoleculeDatum.isa(res) ) 
            batched.push(res);        
        else           
            errors.push(res);      
    }
    logger.debug(`[parseManyMoleculeArchives] ${errors.length} errors, ${batched.length} success`);
    
    return { batched, errors };
}