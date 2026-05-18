
import { parseManyMoleculeData, parseManyMoleculeArchives, MoleculeDatum, MoleculeDatumFailure } from './fileSystemParser';
import { MoleculeLoaderUser } from '../types';
import { moleculeDataInsert, InsertionRecap, isMoleculeLoaderUser,  } from './infoSetter';
import logger, {cliLogger} from '../logger';
import { inspect } from 'util';
import { StageTree } from './stageTree';
import { ItpModOptions } from '../helpers/itp/meta_comments';
import { MoleculeInsertMiddleWare } from './infoSetter';
import {success, error as errorStl} from '../cli/views';
import SettingsWrapper from '../helpers/settingsManager';
import { MoleculeID } from '../helpers/database/types';
import { VersionDatum } from './types';



export namespace MoleculeLoader {
    const batched:MoleculeDatum[]       = [];
    const errors:MoleculeDatumFailure[] = [];

    let stageTree:StageTree|undefined=undefined;
    //infoCard : InfosJson[] = [];
    let who:MoleculeLoaderUser|undefined = undefined; 
    /**
    * parse the molecule files inside a hierarchy of directories
    * with one bottom directory for each molecule
    * @param  path - The path to the top directory
    * @returns - The main molecule informations list updated w/ the newly parsed ones 
    * @example
    * 
    */
  export const connect = (user: string, role: string) => {
    who = { id: user, role };
  }
  /**
   * Get a Batch Elemnent from the queue based on its single version ID
   * @param elemID 
   * @returns a BatchElement instance
   */
  export const getFromBatch = (elemID:string):MoleculeDatum|undefined => {
    const alreadyInBatch = batched.find((batchElem) => batchElem.versions[0].id === elemID);
    if(!alreadyInBatch)
      logger.error(`[MoleculeLoader] No such element ${elemID} in batch`);
    return alreadyInBatch;
  }   

  /**
   * Just get whatever first batch element ID (for auto testing purposes) 
   * @returns a BatchElement instance
   */
  export const popBatch = ():string => {
    if(!batched.length)
        throw new Error("[MoleculeLoader] Attempting to pop an empty batch");
    return batched[0].versions[0].__bundle__.id;
  }  
  /**
  * Batch is just a queue of MoleculeDatum w/ one single version of themselves
  */
  export const addToBatch = (...batchables:MoleculeDatum[]) => {
    for (let elemBatch of batchables) {
      const conflictMdl = batched.find(md => md.alias === elemBatch.alias 
                                               && md.versions[0].force_field === elemBatch.versions[0].force_field
                                               && md.versions[0].number === elemBatch.versions[0].number);
      if(conflictMdl)
        logger.warn(`[MoleculeLoader:addToBatch] Conflicting models for \"${conflictMdl.alias}\" [${conflictMdl.versions[0].force_field}:${conflictMdl.versions[0].number}]\nTo be added batch Elemnt details:\n${inspect(elemBatch)}\nAlready in batch Elemnt details:\n${inspect(conflictMdl)}`)
      batched.push(elemBatch)
    }
  }

  const addToErrors = (parseErrors:MoleculeDatumFailure[]) => {
    errors.push(...parseErrors);
  }

  /**
   * 
   * @param elemID The identifier of the batch element to modify
   * @param opt The attribute to modify
   * 
   * TO OD update the MolecularDatum
   */
  export const touch = async(elemID:string, opt:ItpModOptions):Promise<void> => {
    const e = getFromBatch(elemID);
    if(!e) {
      logger.error(`[MoleculeLoader] ${elemID} is not found in batch!`);
      return;
    }

    await e.versions[0].__bundle__.alter(opt);
  }
  /**
   * 
   * @param elemID a bach elemnt identifier
   * @returns a short description of the element
   * 
   */
  export const look = async (elemID:string) => {
    const e = getFromBatch(elemID);
    if(!e) {
      logger.error(`[MoleculeLoader] ${elemID} is not found in batch!`);
      return;
    }   
  
    return {
      id: e.versions[0].__bundle__.id,
      alias : e.alias,
      category : e.category,
      name : e.name,
      //model : e.versions[0].__bundle__.asJSON(),
      itp: await e.versions[0].__bundle__.ItpComments()     
    };
  }

  /**
   * Delete from STAGE the element dsignated by its ID
   * TO IMPLEMENT
   * @param elemID 
   * @returns 
   */
  export const deleteFromBatch = (elemID?:string):boolean => {
    logger.debug(`[MoleculeLoader] deleteFromBatch`);
    return true;
  }

  /**
   * Restore specified batch element to its original content
   * @param elemID the element to restore
   * If no parameter is provided, all batch Element will be restored
   */
  export const checkout = async(elemID?:string) => {
    let toRestore = batched;
    if(elemID) {
      const _ = getFromBatch(elemID);
      if(!_)
        return;
      toRestore = [_];
    }      

    return Promise.allSettled(
      toRestore.map( (e:MoleculeDatum) => e.versions[0].__bundle__.reset() )
    );
  }

  /**
   * 
   * Send the staged molecule to the database -- NEED TO TEST EDGE / ERROR CASE tested below
   */
  export const push = async(start?:number, end?:number, successCallback?:(arg0:VersionDatum)=>void, errorCallback?:(arg0:VersionDatum)=>void):Promise<MoleculeID[]|undefined> => {
    const successId:string[] = [];
    if(!stageTree) {
      logger.error("[MoleculeLoader] Nothing to push, maybe commit first ?");
      return;
    }
    if(errors.length) {
      logger.error("[MolestatusculeLoader] added molecule-models are in error states, correct or drop them first");
      return;
    }
    if (!who)      
        throw new Error("[MoleculeLoader:push] You need to \"user connect\" to insert");
    
    logger.info(`[MoleculeLoader:push] pushing...\n`);
    let i = -1;
    await stageTree.forEachMolecule( async (alias, molecules) => {
        await molecules.forEachForcefield( async ( molData, versions) => {    
          i++;
          if(start !== undefined &&  i < start)
            return;  
          if(end !== undefined &&  i >= end)
            return;
          const { name, alias, category, forcefield } = molData;
          logger.debug(`[MoleculeLoader:push] ${alias}\t${forcefield}\t[${versions.map(v=>v.number).join(', ')}]`);
          try {
            // This can fail for an entier versions list
            // cathc this and allow modicaiton b4 repush
            await MoleculeInsertMiddleWare.bulkInsert(molData, versions, who as MoleculeLoaderUser,
              successCallback, errorCallback
            );
            successId.push(...versions.map(v=>v.id));            
          } catch(e) {

          }
          //await moleculeDataInsert(batched, who);
      }) 
    });
    return successId;
  }
  /**
   * 
   * @param path A file system path, if it ends with zip or contains a wilcard '*', A search for zip archive files 
   * will be performed and all matching files will be parsed. If the path points to a single directory, deep search for 
   * "leave" directory will be performed and each matching folder will be assumed to contain the files of one molecule/model
   * @returns A promise with the eventual parsing failures
   */
  export const add = async(path: string): Promise<MoleculeDatumFailure[]|undefined> => {
    logger.debug(`[MoleculeLoader] parse ${path}`);
    const { batched, errors } = path.endsWith('.zip') || path.includes('*') ? await parseManyMoleculeArchives(path)
                                                                            : await parseManyMoleculeData(path);
    
    logger.debug(`[MoleculeLoader] adding ${batched.length} bundles to batch pool`);
    addToBatch(...batched);
    if(errors.length)
      logger.debug(`[MoleculeLoader] adding ${errors.length} bundles to error pool`);
    addToErrors(errors);
  
    return errors.length === 0 ?
      undefined : errors;
  }
  
  /**
   * 
   * @param opt_usr Insert a staged batch element in database
   * DEPRECATED
   */
  export const insert = async (opt_usr?: MoleculeLoaderUser): Promise<InsertionRecap> => {
    if (!who)
      if (!opt_usr)
        throw new Error("[MoleculeLoader:insert] You need to \"user connect\" to insert");
      else
        if (!isMoleculeLoaderUser(opt_usr))
          throw new Error(`[MoleculeLoader:insert] invalid optional user provided \"${inspect(opt_usr)}\"`);
        else
          who = opt_usr;

    const recap = await moleculeDataInsert(batched, who);
    return recap;
  }


  /* list version ID, forcefield, location, parsing status, insertion status
  *
  */
  export const status = (start?:number, end?:number):string=> {

    logger.info(`[MoleculeLoader] Batch parsing status`)
    if(errors.length) {
      logger.info(`${errors.length} Parsing errors:\n${inspect(errors, {depth:4})}`);
    }
    else 
      logger.info(`No parsing error`);
    
    if(!stageTree)
      //logger.info(`[MoleculeLoader] No staged molecule`);
      return `[MoleculeLoader] No staged molecule`
    else{
      stageTree.report(start, end).forEach( l => cliLogger.info(inspect(l)) );
      const report = stageTree.report(start, end);

      const widths = report.reduce( (acc:number[], l:string[]) => {
        return acc.map( (v:number, i:number) => Math.max(v, l[i].length) )
      }, [0, 0, 0, 0, 0, 0]);
      const cliString = `[MoleculeLoader] ${stageTree.dim.versionCount} staged molecule status\n` + report.map(l => { 
        const _ = l.map((field:string, i:number) => field.padEnd(widths[i])).join(" | ");
          if(l[5]==="NO")
            return errorStl(_)
          return success(_);
        }).join('\n');
      return cliString;
    }
    // const errors:MoleculeDatumFailure[] = [];

    //let stageTree:StageTree|undefined=undefined;
  }

  /** Sort currently staged molecule in a hierarchical structure
   * [ force_field_version ] = {
   *    [molecule_alias] 
   * }
   * 
   * @returns Get a descritpion of currently staged molecules
   * Version are regrouped under molecules/ff combo and by subsequent version umber
   */

  export const commit = ():void => {
      if(!batched.length) {
        logger.error("[MoleculeLoader] Nothing to commit!");
        return;
      }
      stageTree = StageTree.createFromBatch(batched);
      const { versionCount, moleculeCount, forcefieldCount} = stageTree.dim
      logger.info(`[MoleculeLoader:commit] Just staged ${versionCount} model(s) accross ${moleculeCount} molecule(s) and ${forcefieldCount} forcefield(s)`);
      
      
      
      //logger.silly(inspect(stageTree, {depth:10}));
  }

  export const length = () => batched.length;
  export const isEmpty = () => batched.length == 0;

  export const decodeCategory = async (cat: string) => {
    const settings = await SettingsWrapper.getSettingsWrapper();
    return settings.category_tree[cat].name
  }

  /*  
  Iterate over validation errors
  Trying to fix trivial fileparsing errors
  If it manages, the error is moved to the batch
  */
 export const fixMany = async() => {
  logger.debug(`[MoleculeLoader] fixMany...`);
    const results = await Promise.allSettled(
      errors.map( (e:MoleculeDatumFailure) => {
        return new Promise( (res, rej) => {
            logger.debug("Browing error from ==>" + e.bundle.path);
            fix(e);
        })
    })
    );
    logger.debug(`[MoleculeLoader fixMany] results:\n${inspect(results)}`);
    
    return results;
 }

 /**
  * 
  * Need to put all stuff under concurrent async 
  * 
  * @param reasons 
  */
  const fix = async(error:MoleculeDatumFailure): Promise<string> => {
    //const mol = await MoleculeBundle.create(path);
    //1/

    //logger.debug(`[MoleculeLoader fix] Attempting to fix \n${path} inside ${tmpDir}`);
    /*
    const excepts:Set<ParserExceptionType> = new Set(Object.keys(reasons).map((_:any)=>  _ as ParserExceptionType));
    if ( excepts.has("groNumber") ) {
        if( reasons.groNumber?.[1] === 'No gro found' ) {
          logger.debug(`PDB2GRO@${path}`);

          let jobOpt: JobOptAPI = {
            "exportVar": {             
            },
            "inputs": { 'molecule.pdb' : InputTextWrapper(tmpDir)}
          };
      
          if(molecule_pdb) 
            jobOpt['inputs'] = {   
              "insaneHackBefore.py": INSANE_HACK_SCRIPT.BEFORE,
              "insaneHackAfter.py": INSANE_HACK_SCRIPT.AFTER,
              "input.pdb" : molecule_pdb 
            };
          
          // Start insane
          let insane_top_content: string; 
          let gro_results_stream : Readable; 
          try {
      
            logger.info(`[INSANE] sent to JM  with options:\n${inspect(jobOpt)}`);
            const {stdout, jobFS} = await Executor.run('insane', jobOpt)
          }
    }*/
    return `Coucou@${error}`;
}

} //ns
/*
const nbMol = Object.keys(recapInsertion.inserted).length
    logger.info(`${nbMol} molecules inserted`);
    if(logged !== '' && nbMol > 0){
      logged += '\n## Inserted \n'
      for(const inserted in recapInsertion.inserted){
        logged += inserted + "\t" + recapInsertion.inserted[inserted].name + "\t" + recapInsertion.inserted[inserted].versions.map(v => v.force_field + ";" + v.number + ";" + v.directory).join("\t") + "\n"
      }
    }
    
    logger.warn(`Molecules not inserted :`)
    if (logged !== '') logged += "\n## Not inserted"
    for(const reason in recapInsertion.not_inserted){
      const nbMol = Object.keys(recapInsertion.not_inserted[reason]).length
      if (nbMol > 0){
        console.log('##', reason, nbMol)
        if (logged !== '') logged += `\n### ${reason}\n`
        for(const alias in recapInsertion.not_inserted[reason]){
          const mol = recapInsertion.not_inserted[reason][alias]
          if(logged === '') console.log(alias + "\t" + mol.name + '\t' + mol.versions.map(v => v.force_field + ";" + v.number + ";" + v.directory).join("\t"))
          else {
            logged += alias + "\t" + mol.name + '\t' + mol.versions.map(v => v.force_field + ";" + v.number + ";" + v.directory).join("\t") + "\n"
          }
        }
      }
      
    }
    */



  // These shall be removed

  export const GenerateModItpFiles = (path: string, erase: boolean = true) => {
    /* Should be calling 
    completeItpFiles from FileSystemParser
    But it should not be required as 
    parseMany Molecule Info should depend on that/do it on the fly.
    */
    throw ("[MoleculeLoader:GenerateModItpFiles] TO BE DONE");
  }
  export const addGroFiles = async () => {
    /* Should be calling 
    addGro from FileSystemParser
    But it should not be required as 
    parseMany Molecule Info should depend on that/do it on the fly.
    */
    throw ("[MoleculeLoader:addGroFiles] TO BE DONE");
  }