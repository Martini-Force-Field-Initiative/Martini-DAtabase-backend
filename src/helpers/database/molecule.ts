import { BaseMolecule, User } from "../../Entities/entities";
import Errors, { ApiError, ErrorType } from "../../Errors";
import logger from '../../logger';
import { Database } from "../../Entities/CouchHelper";
import { Molecule } from '../../Entities/entities';
import { MoleculeLoaderUser, MoleculeLoadRequest, GoTerm } from '../../types';
import MoleculeOrganizer from "../../MoleculeOrganizer";
import { VersionDatum, OMD } from "../../MoleculeLoaderFS/types";
import { inspect } from "util";
import { MoleculeChecker } from '../../MoleculeChecker';
import { FileID, MoleculeID } from "./types";
import { ItpModOptions } from '../itp/meta_comments';
import ForceFieldStore, { AvailableForceField} from "../../Stores/ForceFieldStore";
import { dateFormatter } from '../../helpers/simple';
import { bold, error, error as strError, success as strSuccess } from '../../cli/views';
import { MoleculeVersionSelector } from "../../Entities/MoleculeDatabase";
import SettingsWrapper from '../../helpers/settingsManager';
import JSZip from "jszip";
import { readFileSync, createWriteStream } from "fs";
import { FORCE_FIELD_DEF } from "../../constants";
import { basename } from "path";
import {promises as FsPromise} from 'fs';
import ExternalDatabase  from "../../Entities/ExternalDatabase";
import {isValidCouchDocumentName} from "../../Entities/CouchHelper";
import { get } from "http";

type insertAtOptions = { parent?: never, tree_id: string } | { parent: Molecule, tree_id?: never } | { parent: undefined, tree_id: undefined };
type latestOpt =
  { id: string, tree_id?: never } |
  { id?: never, tree_id: string };
//{ value: number, data: string; note?: never; } |
//{ value: number, note: string; data?: never; };
/* Host operations that requires interaction with the molecuke database
* Any required/coupled interactions with the FileSystem (aka MoleculeOrganizer) will
* piloted from here also
*/

/**
 * Filters elements out of litteral into a Molecule versrion selector which is guaranted to return 0 or one model
 */
class SingleMoleculeSelectorError extends Error {};

const coherceMoleculeVersionSelector = (o:any):MoleculeVersionSelector =>  {
 
  if(o.hasOwnProperty('id'))
    return {'id' : o.id };
  if(! o.hasOwnProperty('alias'))
    throw new SingleMoleculeSelectorError("Ambigious molecule selector (missing alias property)");
  if( o.hasOwnProperty('version') && !o.hasOwnProperty('force_field'))
    throw new SingleMoleculeSelectorError("Ambigious molecule selector (a version number lacks a force_field value)");
  if( o.hasOwnProperty('force_field') && !o.hasOwnProperty('version'))
    throw new SingleMoleculeSelectorError("Ambigious molecule selector (a force_field value lacks a version number)");
  const ffStore = ForceFieldStore.getStore();
  if( o.hasOwnProperty('force_field'))
    if(! ffStore.isAvailableForceField(o.force_field))
      throw new SingleMoleculeSelectorError("Ambigious molecule selector (unknown force_field value)");
  
  const sel:MoleculeVersionSelector = { alias:o.alias };
  ['force_field', 'version'].forEach( c => { if(o.hasOwnProperty(c)) sel[c as keyof MoleculeVersionSelector] = o[c];})
  if(Object.keys(sel).length == 1)
    sel.latest = true;

  return sel;
}
export default class DatabaseMoleculeDesk {

  static async niceView(doc:Molecule){
    const settings = await SettingsWrapper.getSettingsWrapper()
    /** 
     * Eventually clean a molecule document 
     * Used in APIO-list context mostly to replace category names
     * by human readblae ones
    */
    doc.category = doc.category.map((c_id)=>
      settings.category_tree[c_id]?.name ?? c_id)
    return doc;
  }

  static async isForceFieldSupported(alias:string, force_field:string):Promise<boolean> {
    const molDoc = await Database.molecule.findOne( { selector: {alias, force_field} });
    if(molDoc === undefined)
      logger.debug(`[DatabaseMoleculeDesk:isForceFieldSupported] ${alias} ${force_field} not molecule found`);
    return molDoc !== undefined;
  }
  static async findOne(sel:MoleculeVersionSelector):Promise<Molecule> {
    logger.error(inspect(sel))
    const uniqSel = coherceMoleculeVersionSelector(sel);
    logger.error(inspect(uniqSel));

    const molDoc = await Database.molecule.findOne({selector : uniqSel});
   
    if(!molDoc)
      throw new Error(`No molecule matching selection '${inspect(uniqSel)}'`);
    return molDoc;
  }

  static async getUniqZipModel(sel:MoleculeVersionSelector) {
    /**
     * Returns the zip bundle of one model
     */
    const molDoc = await this.findOne(sel);
    const molecule = await MoleculeOrganizer.getInfo(molDoc.files);    

    logger.info(`[DatabaseMoleculeDesk:getUniqZipModel] files ${molDoc.files}`);
    const f = MoleculeOrganizer.getFilenameFor(molDoc.files);
    logger.info(f);
    return f;
    /*const zip = new StreamZip({
      file: MoleculeOrganizer.getFilenameFor(molcouch[0].files),
      storeEntries: true
    });*/

  }

  static async setLatest(opt?: latestOpt) {

    //Database.molecule.updateLatestMoleculeTreeOf(tree_id)
    const tree_ids: string[] = []
    if (!opt)
      tree_ids.push(...await Database.molecule.getTreeIDs());
    if (opt?.id) {
      const _ = await Database.molecule.get(opt.id)
      tree_ids.push(_.tree_id);
    }
    if (opt?.tree_id)
      tree_ids.push(opt.tree_id);

    logger.debug(`[helpers:molecule:DatabaseMolecule] setting latest tag to ${tree_ids.length} trees:\n${tree_ids}`);
    for (const tree_id of tree_ids)
      await Database.molecule.updateLatestMoleculeTreeOf(tree_id);

  }

  /**
   * Finds the highest version number in the database for a given (alias, force_field) pair
   * and returns the next highest major version number as a string.
   * eg: if the highest version is 1.X, it returns 2.0
   * 
   * @param alias The molecule alias to search for
   * @param force_field The force field to search for
   * @returns A string representing the next highest version number
   */
  static async generateHighestVersionNumber(alias:string, force_field:string): Promise<string> {
    
    const mols = await Database.molecule.find(
      { selector: {alias, force_field} } );
    const h = mols.reduce((cur_ver:number, mol:Molecule) => {
        const cur = parseInt(mol.version.split('.')[0]);
        return cur > cur_ver ? cur : cur_ver;
        }, 0);
    return `${h +1}.0`;
  }


  static async getFileID(id: MoleculeID): Promise<FileID | undefined> {
    const molDoc: Molecule = await Database.molecule.get(id);
    if (!molDoc)
      return undefined;
    return molDoc.files as FileID;
  }

  /**
   * Make a backup copy of currently ACTIVE molecule database document under a new database endpoint
   * equals to [CURRENT_MOLECULE_DATABASE]_[tag], w/ tag~"Y-m-d_H-i-s"
   * @param tag Optional backup name
   * if the customTarget is provided and matches another couchDB server, it will be used as replication target.
   */
  static async replicate(customTarget?: string): Promise<string> {
    const src = Database.addr.molecule;
    const tgt = customTarget ? customTarget : `${Database.addr.molecule}_${dateFormatter("Y-m-d_H-i-s")}`;
    let extDb:ExternalDatabase|undefined=undefined;
    try {    
      extDb = await ExternalDatabase.connect(tgt);
      logger.info(`[DatabaseMoleculeDesk:replicate] success pooling external database @${tgt}`);
    } catch (e) {
      logger.debug(`[DatabaseMoleculeDesk:replicate] failed pooling external database @${tgt} ${e}`);        
      if (!isValidCouchDocumentName(tgt))
        return error(`[DatabaseMoleculeDesk:replicate] ${tgt} is not a valid couchDB document name nor a remote couchDB document endpoint`);
    }
    
    logger.info(`[DatabaseMoleculeDesk:replicate] Create molecule files bundle from ${src}`);
    const moleculeFilesArchive = await DatabaseMoleculeDesk.archive();

    //const tgt = customTarget ? customTarget : `${Database.addr.molecule}_${dateFormatter("Y-m-d_H-i-s")}`;
    //await Database.create(tgt, false)
    logger.info(`[DatabaseMoleculeDesk:replicate(${extDb ==undefined ? 'LOCAL' : 'REMOTE'})] from ${src} to ${tgt}`);
    try {
      await Database.replicate(src, tgt)
    } catch (e) {
      if(extDb != undefined)
        return error("A remote database was found for replication but replication failed, please check that target document (exists and is empty)");
    }

    // We use the name of the document replicated as the name of the zip file
    const allMoleculeZipFileOut = `${extDb ? extDb.document : tgt}.zip`;
    return new Promise((resolve, reject) => {
      moleculeFilesArchive.generateNodeStream({type:'nodebuffer',streamFiles:true})
      .pipe(createWriteStream(allMoleculeZipFileOut))
      .on('finish', function () {
      // JSZip generates a readable stream with a "end" event,
      // but is piped here in a writable stream which emits a "finish" event.
        resolve(`'${src}' 'molecule/' folder was saved under ${allMoleculeZipFileOut}`);
      });
    });

  }

  static async archive(includeForceFieldFile=true):Promise<JSZip> {
    logger.info("DatabaseMoleculeDesk:archive ...");

    const mols = await Database.molecule.all()
    logger.info("Archiving " + mols.length + " molecules"); 
    const zipArch = new JSZip();
    zipArch.folder("molecules");
    for (const mol of mols) {
      //logger.info(`molecule is  ${inspect(mol)}`);
      const molInfo = await MoleculeOrganizer.getInfo(mol.files);
      zipArch.file(`molecules/${mol.files}.json`, JSON.stringify(molInfo));
      //logger.info(`molInfo ${inspect(molInfo)}`);
      const molFileArch = MoleculeOrganizer.getFilenameFor(mol.files);
      //logger.info("molArchiveArch file: " + molFileArch);
      const zipBuf = readFileSync(molFileArch);
      zipArch.file(`molecules/${mol.files}.zip`, zipBuf);     
    }
    logger.info(`DatabaseMoleculeDesk:molecule ${mols.length} models archived`);

    if(!includeForceFieldFile)
      return zipArch;

    logger.info("Archiving forcefield files..."); 
    zipArch.file(basename(FORCE_FIELD_DEF), readFileSync(FORCE_FIELD_DEF));
    zipArch.folder("forcefields");
    const forceFieldStore = ForceFieldStore.getStore();
    for( const file of forceFieldStore.allForceFiedFilesAbsPath() ) {
      logger.debug(`DatabaseMoleculeDesk: ForceField file zipping..: ${file}`);
      zipArch.file(`forcefields/${file}`, readFileSync(file));
    }
  
    logger.info("DatabaseMoleculeDesk:forcefield files archived");
    
    return zipArch;
  }

  /** 
   * Loop over all molecule entries and replace in the corresponding itp files
   * the comment sections with fields from the database documents.
   * 
  */
  static async syncing(ids?: string[]) {
    const molDocs: Molecule[] = ids ? await Database.molecule.bulkGet(ids) : await Database.molecule.all();
    logger.info(`[helpers:database:molecule:DatabaseMoleculeDesk] Syncing ${molDocs.length} elements`)
    const res = await Promise.allSettled(
      molDocs.map((molDoc) => MoleculeOrganizer.update(molDoc.files,
        {
          name: molDoc.name, number: molDoc.version,
          forcefield: molDoc.force_field as AvailableForceField,
          category: molDoc.category, alias: molDoc.alias,
          resetCategory: true
        },
        `${molDoc.alias}:${molDoc.force_field}v${molDoc.version}`)
    ));
    //logger.info("Syncing done status");
    let syncStatus = bold("Syncing done status:\n");
    res.forEach( (r, i) =>{
      let cStr = `${molDocs[i].id}\t${molDocs[i].alias}:${molDocs[i].force_field}[${molDocs[i].version}]`
      if(r.status === 'rejected')
        cStr = strError(`${cStr}\t${r.reason}`);
      else
        cStr = strSuccess(`${cStr}\t${r.value.pdb.name}`);
        
      syncStatus += cStr + "\n";
    });
    logger.info(syncStatus);
  }

  /**
   * Update molecule database document fields 
   *    We could operate on stash?
   * eventually trickle mod down to fs
   * Version tree consistency (aka version number sequence insertion) is not ensured in below code
   */
  static async updateMolecule(infos: Partial<Molecule>, id: string) { // Get the right obect shape
    logger.debug(`[helpers:database:molecule] Updating ${id} with ${inspect(infos)}`);
    const molDoc: Molecule = await Database.molecule.get(id);
    molDoc.parent = infos.parent ?? molDoc.parent;
    molDoc.latest = infos.latest ?? molDoc.latest;

    molDoc.name = infos.name ?? molDoc.name;
    molDoc.version = infos.version ?? molDoc.version;
    molDoc.force_field = infos.force_field ?? molDoc.force_field;
    molDoc.category = infos.category ?? molDoc.category;
    molDoc.tags = infos.tags ?? molDoc.tags;
    
    await Database.molecule.save(molDoc);

    if (infos.category || infos.version || infos.force_field || infos.name) {
      const mod: ItpModOptions = {
        category: infos.category,
        number: infos.version,
        forcefield: infos.force_field as AvailableForceField,
        name: infos.name
      }
      logger.info(`[helpers:database:molecule] ${molDoc.alias}:${molDoc.force_field}[${molDoc.version}] Updating ITP files w/ ${inspect(mod)}`);
      await MoleculeOrganizer.update(molDoc.files, mod);
    }
  }

  static async deleteMolecule(id: string, user: User, stashed = false, checked_attached = true) {
    // Delete a stashed molecule

    const getChilds = async (id: string, stashed = false): Promise<BaseMolecule[]> => {
      const db = stashed ? Database.stashed : Database.molecule
      const molDoc = await db.get(id)
      const tree = await db.moleculeTreeOf(molDoc.tree_id)
      if (tree) {
        const childs = tree.getChilds(molDoc)
        return childs
      }

      return []
    }

    const dels = []
    if (stashed) {
      if (user.role !== "admin") {
        return Errors.throw(ErrorType.Forbidden);
      }

      try {
        const mol = await Database.stashed.get(id)
        const childMols = await getChilds(mol.id, true)

        // Delete attached ZIP
        await MoleculeOrganizer.remove(mol.files);
        const delResp = await Database.stashed.delete(mol);
        dels.push(delResp.id)
        for (const child of childMols) {
          const molDoc = await Database.stashed.get(child.id)
          await MoleculeOrganizer.remove(child.files);
          const delResp = await Database.stashed.delete(molDoc);
          dels.push(delResp.id)
        }

      } catch (e) {
        return Errors.throw(ErrorType.ElementNotFound);
      }
      return;
    }

    // Delete a published molecule
    try {
      const mol = await Database.molecule.get(id);
      const childMols = await getChilds(mol.id)
      if (user.role !== "admin" && user.id !== mol.owner) {
        return Errors.throw(ErrorType.Forbidden);
      }

      await MoleculeOrganizer.remove(mol.files)

      const delResp = await Database.molecule.delete(mol)
      dels.push(delResp.id)

      for (const mol of childMols) {
        const molDoc = await Database.molecule.get(mol.id)
        await MoleculeOrganizer.remove(mol.files)
        const delResp = await Database.molecule.delete(molDoc)
        dels.push(delResp.id)
      }

      return dels

      /*if (checked_attached) {
        // Recherche les sous-versions attachées à cette molecule
        const versions_attached = await Database.molecule.find({
          limit: 99999,
          selector: {
            parent: mol.id,
            tree_id: mol.tree_id,
          },
        });
    
        // Met à jour les liens de parenté
        if (versions_attached.length) {
          if (mol.parent) {
            // If the deleted molecule has a parent: Every molecule will be attached to the new parent
            for (const m of versions_attached) {
              m.parent = mol.parent;
            }
          }
          else {
            // If the deleted molecule doesn't have a parent: The first molecule will be the new parent for everyone
            const first = versions_attached[0];
            for (const other of versions_attached.slice(1)) {
              other.parent = first.id;
            }
            first.parent = null;
          }
    
          // Save everyone
          await Promise.all(versions_attached.map(v => Database.molecule.save(v)));
          SearchWorker.clearCache();
        }
      }
  
      // Delete attached ZIP
      await MoleculeOrganizer.remove(mol.files);
      await Database.molecule.delete(mol); */
    } catch (e) {
      return Errors.throw(ErrorType.ElementNotFound);
    }
  }

  /**
   * Insert the molecule into the database 
   * 
   * @param infos { name, alias, category[], force_field }
   * @param version The molecule
   * @param who 
   * @param opt parent and/or tree ids
   * @returns 
   */
  static async insertAt(
    infos: OMD,
    version: VersionDatum,
    who: MoleculeLoaderUser,
    opt: insertAtOptions
  ) {
    const { tree_id = undefined, parent = undefined } = opt;
    logger.debug(`[helpers:database:molecule:insertAt] (parent:${parent ? parent.id : 'n/a'} xor tree_id:${tree_id ? tree_id : 'n/a'}) processing ${infos.alias}:${infos.forcefield}[${version.number}]`);

    const req: MoleculeLoadRequest = {
      full_user: { ...who },
      body: {
        //?id:   // How do we set this up smartly ? // LOOk it up in the original, logic would call for fsBundle property related to folder location
        name: infos.name,
        alias: infos.alias,
        smiles: '',
        version: version.number,
        category: infos.category as GoTerm[],
        command_line: version.command_line,
        comments: version.comments,
        create_way: version.create_way,
        force_field: version.force_field,
        validation: '',
        citation: version.citation,
        parent: parent ? parent.id : null,
        tree_id: parent ? parent.tree_id : tree_id,
        latest: false
      },
      files: {
        itp: [version.itp,],
        pdb: [version.pdb,],
        gro: [version.gro],
        others: version.others,
        top: [version.top,],
        map: version.map
      }
    }

    if (req.full_user.role != 'admin') {
      return Errors.throw(ErrorType.Unallowed);
    }

    // Error if the user connected is not an admin
    if (req.full_user.role != 'admin') {
      return Errors.throw(ErrorType.Unallowed);
    }

    const checker = new MoleculeChecker(req); // <--- binding to original logic
    checker.bundle = version.__bundle__;

    const molecule = await checker.check()

    // Assessing the side effects of the impeding insertion 
    // 1. [SHIFTING the version list] Scanning for potentials previous content w/ more recent version: aka children of the inserted molecules
    const descendants = await Database.molecule.getVersions(
      { alias: infos.alias, force_field: version.force_field }, "versionNumber");
    // 2. [INSERTING in the version list] The parent of the new molecule may have presexisting children. Make the new molecule their parent
    const newChildren = !parent ? [] : await Database.molecule.getFirstChildren({ id: parent.id });


    logger.debug(`[helpers:database:molecule:insertAt] finalizing save for ${infos.alias}:${infos.forcefield}[${version.number}]!!!`);
    const res = await Database.molecule.save(molecule as Molecule);


    /*
    * Managing the eventual side-effects: updates to manage DB integrity 
    */

    if (descendants.length && !parent) { 
      // Same alias && ff  but none with version number lower than just inserted one
      logger.debug(`[helpers:database:molecule:insertAt] ${infos.alias}:${infos.forcefield}[${molecule.version}] Plausible new root @${molecule.id} updated for ${descendants[0].id} (${descendants[0].version})!`);
      await DatabaseMoleculeDesk.updateMolecule({ parent: version.id }, descendants[0].id);
      return;
    }

    if (newChildren.length) { // Check for children of the new molecule parent and swap their reference to the parent bwith the new molecule 
      logger.debug(`[helpers:database:molecule:insertAt] ${infos.alias}:${infos.forcefield}[${molecule.version}] is the new step dad of molecules: ${newChildren.map(m => m.id).join(', ')}`);
      newChildren.forEach(m => m.parent = molecule.id);
      await Database.molecule.bulkUpdate(newChildren);
    }

    // Updating the latest tag of concerned tree
    logger.debug(`[helpers:database:molecule:insertAt] updating latest tag for ${infos.alias}:${infos.forcefield}[${version.number}] !!!`);
    await Database.molecule.updateLatestMoleculeTreeOf(molecule.tree_id);
  }
}
