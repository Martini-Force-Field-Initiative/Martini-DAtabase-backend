import { MoleculeLoaderUser } from '../types';
import { Molecule } from '../Entities/entities';
import { Database } from '../Entities/CouchHelper';
import logger, { cliLogger } from '../logger';
import { VersionDatum, MoleculeVersion, OMD } from './types';
import { MoleculeDatum } from './fileSystemParser';
import DatabaseMoleculeDesk from '../helpers/database/molecule';
import { rawVersionGreaterThan } from '../helpers/martiniVersions';
import { inspect } from 'util';

/** 
* Boiler plate for moleculeVersion insertion
Most of previous stuff to be trashed as its non readable
* 
*
*/
class MoleculeInsertError extends Error {};

export namespace MoleculeInsertMiddleWare {

  export const bulkInsert = async (infos:OMD, versions:VersionDatum[], who:MoleculeLoaderUser, successCallback?:(arg0:VersionDatum)=>void, errorCallback?:(arg0:VersionDatum)=>void) => {
    logger.debug(`[MoleculeInsertMiddleWare:bulkInsert] ${infos.alias}:${infos.forcefield} Checking versions numbers of ${versions.length} elements before insertions...`);
    // Stage Tree guarantees that versions are in order and 'latest' tag is last 
    if(!await isSafeVersionNumber(infos, versions )) {
      logger.error(`[MoleculeInsertMiddleWare:bulkInsert] Please fix fatal versions inconsistencies for ${infos.alias}:${infos.forcefield} and retry`);
      versions.forEach((v)=>{v.inserted = false});
      return;
    }
       
    // DVL stage : Eachinsertion remains independant
    for (let i = 0; i < versions.length; i++) {      
      try {
        if (versions[i].number === "latest") {
          versions[i].number = await DatabaseMoleculeDesk.generateHighestVersionNumber(infos.alias, infos.forcefield);
          logger.info(`[MoleculeInsertMiddleWare:bulkInsert] translating 'latest' tag for ${infos.alias}:${infos.forcefield} to ${versions[i].number}`);
        }
        await insert(infos, versions[i], who);
        versions[i].inserted = true;
        successCallback?.(versions[i]);
      } catch (e: any) {
        logger.error(`[MoleculeInsertMiddleWare:bulkInsert] ${infos.alias}:${infos.forcefield}[${versions[i].number}] insertion error: ${e.data.message}`);
        cliLogger.error(`[MoleculeInsertMiddleWare:bulkInsert] ${infos.alias}:${infos.forcefield}[${versions[i].number}] insertion error: ${e.data.message}`);
        versions[i].inserted = false;
        errorCallback?.(versions[i]);
      }
    }
  }
  /**
   * Given a list of model check that no version number collides with the ones already in database 
  */
  const isSafeVersionNumber = async(infos:OMD, versions:VersionDatum|VersionDatum[]):Promise<boolean>=> {
    const v = Array.isArray(versions) ? versions : [versions];
    const newVersNum = new Set(v.map((e)=>e.number));
    if(newVersNum.size !== v.length) {
      logger.error(`[MoleculeInsertMiddleWare] \"${infos.alias}:${infos.forcefield}\" unsafe model versions list to insert (redundant numbers) ${v.map((e)=>e.number)}`)
      return false;
    }
    const inDb = await Database.molecule.getVersions(
      { alias: infos.alias, force_field : infos.forcefield }, "versionNumber");
    if(inDb.length)
      logger.debug(`[MoleculeInsertMiddleWare:isSafeVersionNumber] ${infos.alias}:${infos.forcefield} found previous model numbered [${inDb.map(m=>m.version)}]`);
    for (let i = 0; i < inDb.length ; i++) 
      if(newVersNum.has( inDb[i].version )) {
        logger.error(`[MoleculeInsertMiddleWare] \"${infos.alias}:${infos.forcefield}\" model versions ${inDb[i].version} already in database`)
      return false;
    }
    return true;
  }

  export const insert  = async (infos:OMD, version:VersionDatum, who:MoleculeLoaderUser) => {
    // Get closest version number for samme ff and alias curretnly in DB
    // Must modify Database.molecule.getVersions implemntation to ensure ascendant version order
    logger.debug(`[MoleculeInsertMiddleWare:insert] inputs:${inspect(infos)}\n${version}\n${who}`);
    const inDb = await Database.molecule.getVersions(
      { alias: infos.alias, force_field : version.force_field }, "versionNumber");   
    let parent:Molecule|undefined = undefined;   
    if(inDb.length) {
      logger.debug(`[MoleculeInsertMiddleWare:insert] ${infos.alias}:${infos.forcefield}:${version.number} found previous models [ ${inDb.map(_=>_.version).join(', ')} ]`);
      parent = getMoleculeWithClosestNumber(version.number, inDb);
      if(parent?.version === version.number) {
        version.inserted = false;
        throw new MoleculeInsertError(`A model with the same version is already in database for ${infos.alias}:${infos.forcefield}:${version.number}`);
      }
    }

    const insertOpt:any = {};
    if(parent) {
      logger.debug(`[MoleculeInsertMiddleWare:insert] Parental insertion @  ${infos.alias}:${infos.forcefield}[${version.number}]  (parentID:version ${parent.id}:${parent.version})`);
      insertOpt.parent = parent;
    }
    if(!parent) {
      logger.debug(`[MoleculeInsertMiddleWare:insert] Orphan insertion @  ${infos.alias}:${infos.forcefield}[${version.number}] `);
      insertOpt.tree_id = await Database.molecule.getAliasTreeID( infos.alias );
    }
    await DatabaseMoleculeDesk.insertAt(infos, version, who, insertOpt);
    logger.debug(`[MoleculeInsertMiddleWare:insert] ${infos.alias}:${infos.forcefield}[${version.number}] insertion successfull`);
    version.inserted = true;

  }
  /**
   * Find in a set of database molecule, the one ancestor (if any) with closest version number to the newVersionNumber
   * @returns Molecule - the closest molecule or undefined if the newVersionNumber is smaller than all inDatabase ones
  */
  const getMoleculeWithClosestNumber = (newVersionNumber:string, inDatabase:Molecule[]):Molecule|undefined => {
    let predecessor:Molecule|undefined = undefined;
    inDatabase.forEach( (m:Molecule) => {
      if( rawVersionGreaterThan(newVersionNumber, m.version) ) { // is it a predecessor ?
        if (!predecessor)
          predecessor = m;
        else
          if( rawVersionGreaterThan(m.version, predecessor.version) ) // is it younger than current predecessor 
            predecessor = m;
      }
    });
    return predecessor;
  }
}
 // const fetchClosestMolecule(alias:string, forcefield:AvailableForceField)

/*
  The whole file should be dismantled / renamed
  It serves no real purpose beside a layer bewteen stage and actual database insert

*/
export interface InsertionRecap {
  inserted: { [molecule_alias: string]: MoleculeInsert }
  not_inserted: { [reason: string]: { [molecule_alias: string]: MoleculeInsert } }
}

interface MoleculeInsert {
  name: string
  versions: VersionDatum[]
 // dir: string;
}

interface InsertedVersion {
  inserted: VersionDatum[]
  not_inserted: { reason: string, version: VersionDatum }[]
  parent?: string;
}
export const isMoleculeLoaderUser = (o:any): o is MoleculeLoaderUser => {
  if ( !( o.hasOwnProperty('id') &&  o.hasOwnProperty('role')) )
    return false
  return ( (typeof(o.id) === "string") && (typeof(o.role) === "string") );

};


/**
 * Read a bacth of molecule objects contained in a Json object and send their infos to the database to insert them sequentially
 * @param batch - a list of molecules informations
 */
export const moleculeDataInsert = async (moleculeData: MoleculeDatum[], who:MoleculeLoaderUser): Promise<InsertionRecap> => {
  const recap: InsertionRecap = { 'inserted': {}, 'not_inserted': { 'other': {} } }
  for (const mDatum of moleculeData) {
    
    logger.info(`[moleculeDataInsert] processing ${mDatum.name}`);
    try {
      const insertedInfo = await moleculeDatumInsert(mDatum, who)
      if (insertedInfo.inserted.length > 0) 
        recap.inserted[mDatum.alias] = { 
          name: mDatum.name,
          versions: insertedInfo.inserted, 
         // dir: mDatum.directory
        }
      if (insertedInfo.not_inserted.length > 0) {
        for (const notInserted of insertedInfo.not_inserted) {
          if (!(notInserted.reason in recap.not_inserted))
            recap.not_inserted[notInserted.reason] = {}         

          if (!(mDatum.alias in recap.not_inserted[notInserted.reason])) 
            recap.not_inserted[notInserted.reason][mDatum.alias] = { 
              name: mDatum.name, 
              versions: [], 
             // dir: mDatum.directory 
            }

          recap.not_inserted[notInserted.reason][mDatum.alias].versions.push(notInserted.version);
        }

      }


    } catch (e: any) {
      logger.warn(`[moleculeDataInsert] ${mDatum.name} insertion failed`);
      if (e.data && e.data.message) {
        if (!(e.data.message in recap.not_inserted)) 
          recap.not_inserted[e.data.message] = {}
        recap.not_inserted[e.data.message][mDatum.alias] = {
           name: mDatum.name, 
           versions: mDatum.versions, 
          // dir: mDatum.directory 
          }
      } else {
        logger.error(e)
        recap.not_inserted['other'][mDatum.alias] = { 
          name: mDatum.name,
          versions: mDatum.versions,
         // dir: mDatum.directory 
        }
      }
    }
  }

  return recap;
}
/**
 *  inserting ONE molecule (aka several versions) into the database
 * @param infos - The informations on the molecule
 * @returns a Promise with resolve true :)
 */
const moleculeDatumInsert = async (molDatum: MoleculeDatum, who:MoleculeLoaderUser): Promise<InsertedVersion> => {
  //return new Promise(async (resolve, reject) => {
  let inserted: VersionDatum[] = []
  const not_inserted: { reason: string, version: VersionDatum }[] = []
  let tree_id;

  //1. Get versions already in database based on alias 
  //2. Discard versions to insert with pre-existing identical force-field and version number
  const alreadyInDb = await Database.molecule.getVersions({alias:molDatum.alias});
  if (alreadyInDb.length > 0)
    tree_id = alreadyInDb[0].tree_id
  const versionsToInsert = molDatum.versions.filter(v => {
    const inDb = alreadyInDb.find(mol => mol.force_field === v.force_field && mol.version === v.number)
    if (inDb) {
      logger.warn(`${molDatum.alias} ${v.force_field} ${v.number} already in database`)
      not_inserted.push({ reason: "already in database", version: v })
      return false
    }
    return true
  });
  // Nothing to actually insert
  if (versionsToInsert.length === 0)
    return { inserted, not_inserted };

  // Sort all models by forcefield class and inside each class discard models with identical version number
  const versionsByFf = separateVersionsByForcefield(versionsToInsert)

  for (const ff in versionsByFf) {
    let to_insert = versionsByFf[ff]

    const versions_number = versionsByFf[ff].map(v => v.number)
    const duplicates = versions_number.filter((item, index) => versions_number.indexOf(item) != index)
    if (duplicates.length > 0) {
      for (const v of duplicates) {
        logger.warn(`${molDatum.alias} v${v} is duplicated`)
        to_insert = [versionsByFf[ff].find(ver => ver.number === v)!]
        const allOthers = versionsByFf[ff].filter(ver => ver.number === v).slice(1, versionsByFf[ff].length)
        for (const mol of allOthers) {
          not_inserted.push({ reason: "duplicate version", version: mol })
        }
      }

    }
    // This is weird, no previous version is a no GO ?? -> to check
    const { nodes, notTreated } = versionTree(to_insert)
    if (notTreated.length > 0) {
      for (const v of notTreated) {
        logger.warn(`${molDatum.alias} v${v} has no available parent version. Not inserted.`)
        not_inserted.push({ reason: 'no previous sibling available', version: v })
      }
    }

    logger.debug(`[moleculeDatumInsert] versionTree \"nodes\" output: ${nodes}`);


    for (const root of nodes) {
      if (!tree_id) {
        // root looks like that
        /*
          export interface MoleculeVersion { 
          version : VersionDatum
          children : MoleculeVersion[]
          root: boolean;
        }*/
        const inDb = await Database.molecule.getVersions(
          { alias : molDatum.alias, force_field : root.version.force_field}
          ); //This is probably shit but my brain is tired and it works
        // correct this indeed = > We collect a previous version in DB w/ simialr forcefield 
        logger.debug(`[moleculeDatumInsert] getVersions from "${{ alias : molDatum.alias, force_field : root.version.force_field}}":\n${inDb}`);
        if (inDb.length > 0) tree_id = inDb[0].tree_id
      }
      let parentId;
      const parentNumber = getParent(root.version.number)
      if (parentNumber) {
        const parentDb = alreadyInDb.find(mol => mol.force_field === root.version.force_field && mol.version === parentNumber)
        if (!parentDb && root.version.number.split(".").length > 1) {
          logger.warn(`${molDatum.alias} v${root.version.number} has no available parent version. Not inserted.`)
          not_inserted.push({ reason: 'no parent available', version: root.version })
          continue
        }


        if (parentDb) parentId = parentDb.id
      }

      if (!getPreviousSiblingExistence(root.version.number, root.version.force_field, nodes, alreadyInDb)) {
        logger.warn(`${molDatum.alias} v${root.version.number} has no previous sibling version. Not inserted.`)
        not_inserted.push({ version: root.version, reason: "no previous sibling available" })
        continue
      }

      try { // COMMENTED B4 GO TRASH
        // await insertAt(root, who, molDatum, tree_id, parentId) //<-- This should be over version range
        //inserted = inserted.concat(flatRoot(root))
      } catch (e) {
        throw (e)
      }


    }
  }

  return { inserted, not_inserted };
}

const getParent = (version: string) => {
  const _versionSplit = version.split(".")
  const versionSplit = _versionSplit.slice(-1)[0] === '0' ? _versionSplit.slice(0, _versionSplit.length - 1) : _versionSplit
  if (versionSplit.length === 1) return null
  const parentVersion = versionSplit.slice(0, versionSplit.length - 1)
  if (parentVersion.length === 1) return parentVersion[0] + ".0"
  return parentVersion.join(".")
}

const getPreviousSibling = (version: string) => {
  const _versionSplit = version.split(".")
  const versionSplit = _versionSplit.slice(-1)[0] === '0' ? _versionSplit.slice(0, _versionSplit.length - 1) : _versionSplit
  const last = versionSplit.slice(-1)[0]
  const newLast = parseInt(last) - 1
  if (newLast === 0) {
    return
  }
  const newVersion = versionSplit.length > 1 ? versionSplit.slice(0, versionSplit.length - 1).join(".") + "." + newLast.toString() : newLast.toString() + ".0"
  return newVersion
}

const getPreviousSiblingExistence = (version: string, force_field: string, treeVersions: MoleculeVersion[], alreadyInDb?: Molecule[]) => {
  const previousSibling = getPreviousSibling(version)
  if (previousSibling) {
    const siblingDb = alreadyInDb ? alreadyInDb.find(mol => mol.force_field === force_field && mol.version === previousSibling) : alreadyInDb
    if (!siblingDb) {
      const siblingRoot = treeVersions.find(root => root.version.number === previousSibling)
      if (!siblingRoot) {
        logger.warn(`v${version} has no previous sibling version. Not inserted.`)
        return false
      }
    }
  }
  return true
}

const getAllPreviousSiblings = (version: string) => {
  const _versionSplit = version.split(".")
  const versionSplit = _versionSplit.slice(-1)[0] === '0' ? _versionSplit.slice(0, _versionSplit.length - 1) : _versionSplit
  const last = versionSplit.slice(-1)[0]
  const newLast = parseInt(last) - 1
  if (newLast === 0) {
    return
  }
  const _allLast = [...Array(newLast).keys()];
  const allLast = _allLast.slice(1, _allLast.length)
  const newVersion = versionSplit.length > 1 ? allLast.map(l => versionSplit.slice(0, versionSplit.length - 1).join(".") + "." + l.toString()) : allLast.map(l => newLast.toString() + ".0")
  return newVersion
}

/** 
* Chained link of versions sorted by version number
*/
const versionTree = (versions: VersionDatum[]) => {
  const allNodes: MoleculeVersion[] = versions.map(v => ({ version: v, children: [], root: true }))
  const not_treated: VersionDatum[] = []

  for (const n of allNodes) {
    const previousSiblings = getAllPreviousSiblings(n.version.number)
    if (previousSiblings && previousSiblings.length > 0) {
      const inTree = allNodes.filter(n => previousSiblings?.includes(n.version.number))
      if (inTree.length != previousSiblings.length)
        not_treated.push(n.version)
      n.root = false;
      continue
    }
    const parentNumber = getParent(n.version.number)
    if (parentNumber) {
      const parentNode = allNodes.find(node => node.version.number === parentNumber)
      if (parentNode) {
        parentNode.children.push(n)
        n.root = false
      }
    }
  }

  return { nodes: allNodes.filter(n => n.root), notTreated: not_treated }

}

function separateVersionsByForcefield(versions: VersionDatum[]) {
  const sorted: { [ff: string]: VersionDatum[] } = {}
  for (const v of versions) {
    if (!(v.force_field in sorted)) sorted[v.force_field] = []
    sorted[v.force_field].push(v)
  }
  return sorted
}

const flatRoot = (root: MoleculeVersion): VersionDatum[] => {
  const _flatRootRec = (root: MoleculeVersion) => {
    all.push(root.version)
    for (const child of root.children) _flatRootRec(child)
  }

  const all: VersionDatum[] = []
  _flatRootRec(root)
  return all


}