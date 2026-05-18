import { MoleculeLoadRequest, MulterLikeFile } from '../types';
//import { AvailableForceFields } from '../helpers/martiniVersions';
import ForceFieldStore from '../Stores/ForceFieldStore';
import { BaseMolecule, Molecule, StashedMolecule } from '../Entities/entities';
import Errors, { ErrorType, ApiError } from '../Errors';
import { MAX_ITP_FILE_SIZE, NAME_REGEX, ALIAS_REGEX, VERSION_REGEX } from '../controllers/routes/Uploader';
import { generateSnowflake } from '../helpers/simple';
import { Database } from '../Entities/CouchHelper';
import SettingsWrapper from '../helpers/settingsManager';
import MoleculeOrganizer, { MoleculeSave } from '../MoleculeOrganizer';
import { MoleculeBundle } from '../MoleculeLoaderFS/fsBundle';
import logger, { cliLogger } from '../logger';
import { inspect } from 'util';
import { nullOrString } from '../types/basics';
import { addMetaTransform } from '../helpers/itp';
import DatabaseMoleculeDesk from '../helpers/database/molecule';


export class MoleculeChecker {
  constructor(protected req: /*Request | LocalRequest*/MoleculeLoadRequest) {}
  private source:"request"|"localFs"="request";
  private moleculeBundle?: MoleculeBundle;
  
  public set bundle(bundle:MoleculeBundle) {
      this.moleculeBundle = bundle;
      this.source = "localFs"
  }
  /**
   * Check a molecule about to be published to {Molecule} database
   */
  public async check() {
    const molecule = await this.checker(false, false, this.req.body.fromVersion ? true : false) as Molecule;

    molecule.last_update = molecule.created_at;
    molecule.approved_by = this.req.full_user!.id;

    return molecule;
  }

  /**
   * Check a molecule about to be edited in {Molecule} database
   */
  public async checkEdition() {
    const molecule = await this.checker(false, true, this.req.body.fromVersion ? true : false) as Molecule;

    molecule.last_update = new Date().toISOString();
    molecule.approved_by = this.req.full_user!.id;

    return molecule;
  }

  /**
   * Check a molecule about to be published to {Stashed} database
   */
  public async checkStashed() {
    const molecule = await this.checker(true, false, this.req.body.fromVersion ? true : false) as StashedMolecule;
    
    return molecule;
  }

  /**
   * Check a molecule about to be edited in {Stashed} database
   */
  public async checkStashedEdition() {
    const molecule = await this.checker(true, true, this.req.body.fromVersion ? true : false) as StashedMolecule;

    return molecule;
  }
 
  protected async checker(stashed: boolean, edition: boolean, fromVersion: boolean) { // fromVersion ctrl the conflict check by adding ff in selector !!
    let actual_version: BaseMolecule | undefined = undefined;

    logger.debug(`[MoleculeChecker:this.checker] running with stashed:${stashed?'true':'false'} edition:${edition?'true':'false'} fromVersion:${fromVersion?'true':'false'}`);

    if (edition) {
      logger.debug(`[MoleculeChecker:this.checker] edition type`);
      const id = this.req.body.id;
      if (!id) {
        return Errors.throw(ErrorType.MissingParameters);
      }
      
      try {
        if (stashed) {
          actual_version = await Database.stashed.get(id);
        }
        else {
          actual_version = await Database.molecule.get(id);
        }
      } catch (e) {
        logger.error(`[MoleculeChecker:this.checker] no such id \"${id}\"in database[${stashed ? 'stashed' : 'regular'}]`);
        return Errors.throw(ErrorType.MoleculeNotFound);
      }
    }
    const molecule = await this.constructBaseMoleculeFromRequest(fromVersion, actual_version);
    logger.debug(`[MoleculeChecker:constructBaseMoleculeFromRequest] completed`);    

    // Must set the following fields: files, created_at, hash

    // Test if files are attached to the request
    if (!this.areFilesPresent()) {
 
      if (!edition) {   
        return Errors.throw(ErrorType.MissingParameters);
      }
      else {        
        // Edition mode, we must assure that files is defined
        if (!molecule.files) {
          return Errors.throw(ErrorType.MissingParameters);
        }

        // Check if the file exists
        if (!(await MoleculeOrganizer.exists(molecule.files))) {
          return Errors.throw(ErrorType.MissingFiles);
        }

        // Refresh the hash
        molecule.hash = await MoleculeOrganizer.hash(molecule.files);
      }
    }
    // Must insert files into upload directory
    else {
      const ffStore = ForceFieldStore.getStore();
      const files = await this.getFilesFromRequest();
      if(! ffStore.isAvailableForceField(this.req.body.force_field)) {
        logger.error(`[MoleculeChecker:checker] Unknown forcefield '${this.req.body.force_field}'`)
        return Errors.throw(ErrorType.InvalidForceField);
      }

      // Add Header meta-inf to itps if needed
      await Promise.allSettled( (files.itps)
                                  .map( 
                                    (itp) => {
                                    
                                      return addMetaTransform(itp, 
                                      { category   : this.req.body.category, //this.req.body.category.map( (nc:string) => 
                                                     //  SETTINGS.category_tree[nc].name      ),
                                        name       : this.req.body.name,
                                        forcefield : this.req.body.force_field,
                                        number     :  this.req.body.version
                                    }) }
                                  ));

      // Register the files
      // Save the molecule in ZIP format if files changed
      let save: MoleculeSave;
      try {
        if(!ffStore.isAvailableForceField(molecule.force_field)) {
          logger.error(`[MoleculeChecker:checker] Invalid Forcefield '${molecule.force_field}'`);
          return Errors.throw(ErrorType.InvalidForceField);
        } 
        save = await MoleculeOrganizer.save(
          files.pdb_file,
          files.gro_file,
          files.itps, 
          files.top, 
          files.maps,
          molecule.force_field!,
          { sanitizedName : `${molecule.alias}:${molecule.force_field}v${molecule.version}` }
        );
      } catch (e) {
        if (e instanceof ApiError) {
          throw e;
        }
        if (e instanceof Error) {
          return Errors.throw(ErrorType.InvalidMoleculeFiles, { detail: e.message });
        }
        return Errors.throw(ErrorType.InvalidMoleculeFiles);
      }

      // Remove the old files, if they exists
      if (molecule.files) {
        try {
          await MoleculeOrganizer.remove(molecule.files);
        } catch (e) {
          logger.error("Unable to remove file", e);
        }
      }

      // Register hash + file id
      molecule.hash = save.infos.hash;
      molecule.files = save.id;
    }

    if (!molecule.created_at) {
      molecule.created_at = new Date().toISOString();
    }

    // Every field is set (except molecule specific fields) !
    return molecule as BaseMolecule;
  }

  protected areFilesPresent() {
    if (!this.req.files || Array.isArray(this.req.files)) {
      return false;
    }

    // Find the ITP files
    const itps_files: (MulterLikeFile)[] = this.req.files.itp;
    const pdb_files: (MulterLikeFile)[] = this.req.files.pdb;
    const top_files: (MulterLikeFile)[] = this.req.files.top;
    
    // Requires one itp file at least
    if (!itps_files || !top_files || !pdb_files || !itps_files.length || !pdb_files.length || !top_files.length) {
      return false;
    }
    return true;
  }

  protected async getFilesFromRequest() {
    if (!this.req.files || Array.isArray(this.req.files)) {
      return Errors.throw(ErrorType.MissingParameters);
    }

    // Find the ITP files
    const itps_files: (MulterLikeFile)[] = this.req.files.itp;

    // Check the weight of each ITP file
    if (itps_files.some(f => f.size > MAX_ITP_FILE_SIZE)) {
      return Errors.throw(ErrorType.FileTooLarge);
    }

    // Get the PDB files
    const pdb_files: (MulterLikeFile)[] = this.req.files.pdb ? this.req.files.pdb : [];
    // Get the GRO files
    const gro_files: (MulterLikeFile)[] = this.req.files.gro ? this.req.files.gro : [];
    
    if ( !(pdb_files.length || gro_files.length) )
      return Errors.throw(ErrorType.MissingFiles);
    
    if (pdb_files.length  && pdb_files.length !== 1)
      return Errors.throw(ErrorType.TooManyFiles);
    if (gro_files.length  && gro_files.length !== 1)
      return Errors.throw(ErrorType.TooManyFiles);
    

  //  const extension = pdb_files[0].originalname.split('.').pop()
  //  const is_pdb = extension === "pdb" ? true : false
    const map_files: (MulterLikeFile)[] = this.req.files.map || [];

    // Find if top files are present
    let top_file: MulterLikeFile = this.req.files.top[0];

    return {
      pdb_file: pdb_files.length ? pdb_files[0] : undefined,
      gro_file: gro_files.length ? gro_files[0] : undefined,
      itps: itps_files,
      top: top_file,
      maps: map_files,
    };
  }

  /**
   * Construct a base molecule that contain 
   * id, name, alias, formula, category, version, comments, command_line, martinize_version, force_field, parent, tree_id, owner.
   * 
   * MISSING : files, created_at, hash, <last_update>, <approved_by>
   */
  protected async constructBaseMoleculeFromRequest(fromVersion: boolean, actual_version?: BaseMolecule) : Promise<Partial<BaseMolecule>> {


    const mol: Partial<BaseMolecule> = actual_version ? { ...actual_version } : {};
    let parent: Molecule | undefined = undefined;
    

    if (!mol.owner) {
      mol.owner = this.req.full_user!.id;
    }

    const body = this.req.body;
    logger.debug(`[MoleculeChecker:constructBaseMoleculeFromRequest] constructing base molecule from (src:${this.source}):\n${inspect(body)}`)
    //logger.debug(`[MoleculeChecker:constructBaseMoleculeFromRequest] PARAMETERS were fromVersion:${fromVersion? 'true':'false'},  actual_version ${actual_version ? 'none' : inspect(actual_version)}`);

    // If the molecule doesn't have any ID, set it or get it from FS bundle
    if (!mol.id) {
      if(this.source === "localFs") {
        if(!this.moleculeBundle)
          throw new Error("localFS must have a preset id attribute prvoided by existing MoleculeBundle")
        mol.id = this.moleculeBundle.id;
      } else
      mol.id = generateSnowflake();
    }
    
    logger.debug(`[MoleculeChecker:constructBaseMoleculeFromRequest]Checking parent id...`);

    // Download the parent if the molecule had one
    const parent_id = nullOrString(body.parent) || mol.parent;
    if (parent_id) {
      try {
        parent = await Database.molecule.get(parent_id);
        this.swallowCopyFromParent(mol, parent);
      } catch (e) {
        return Errors.throw(ErrorType.UnknownParent);
      }
    }
   
    // Set the right parent
    if (!mol.parent) {
      mol.parent = null;
      mol.tree_id = body.tree_id
      if (!mol.tree_id) {
        mol.tree_id = generateSnowflake();
      }
    }
    //Assign force field here to check if the molecule already exists
    logger.debug(`[MoleculeChecker:constructBaseMoleculeFromRequest]Checking forcefield... '${body.force_field}'`);
    this.checkForceField(body.force_field);
    logger.debug(`[MoleculeChecker:constructBaseMoleculeFromRequest]Checking forcefield completed`);
    mol.force_field = body.force_field; 
    // Check the parent-linked fields (copy from them only if molecule is not parented)
    if (!parent) {
      logger.debug(`[MoleculeChecker:constructBaseMoleculeFromRequest] No parent found, checking name, alias, category existence...`);
    
      if (!body.name || !body.alias || !body.category) {
        logger.error(`[MoleculeChecker:constructBaseMoleculeFromRequest] Missing parameters: ${body.name? 'name':''}, ${body.alias? 'alias':''}, ${body.category? 'category':''}`);
    
        return Errors.throw(ErrorType.MissingParameters);
      }

      logger.debug(`[MoleculeChecker:constructBaseMoleculeFromRequest]No parent specified, checking name... '${body.name}'`);
      cliLogger.debug(`[MoleculeChecker:constructBaseMoleculeFromRequest]No parent specified, checking name... '${body.name}'`);
      await this.checkName(body.name, mol.tree_id!, fromVersion ? mol.force_field! : undefined); //Not force field if we are from base
      mol.name = body.name;
      
      logger.debug(`[MoleculeChecker:constructBaseMoleculeFromRequest]No parent specified, checking alias... ${body.alias}`);    
      cliLogger.debug(`[MoleculeChecker:constructBaseMoleculeFromRequest]No parent specified, checking alias... ${body.alias}`); 
      await this.checkAlias(body.alias, mol.tree_id!, mol.force_field!); //Not force field if we are from base
     
      mol.alias = body.alias;

      // TODO introduce check
      mol.smiles = body.smiles || "";
      
      if (!this.checkCategory(body.category)) 
        return Errors.throw(ErrorType.InvalidCategory);
      mol.category = body.category;
    }
 
    // OK now: id, name, tree_id, alias, formula, category, parent, owner
    logger.debug(`[MoleculeChecker:constructBaseMoleculeFromRequest]checking forcefield, create_way, version...`);
    
    // Copy the version-specific fields
    if (!body.version || !body.force_field || !body.create_way) {
      return Errors.throw(ErrorType.MissingParameters);
    }
   
    body.version = body.version.trim();   
    this.checkVersion(body.version);
    mol.version = body.version;
   
    // Check if version already exists
    if (await this.versionExistsInTreeIdAndFf(mol.tree_id!, mol.version!, mol.id!, mol.force_field!)) {
      logger.error(`[MoleculeChecker:constructBaseMoleculeFromRequest] pre existing version of ${mol.alias}:${mol.force_field}[${mol.version}] @${mol.id}`);
      return Errors.throw(ErrorType.VersionAlreadyExists);
    }

    // Optional fields TODO limit length
    mol.comments = body.comments || "";
    mol.command_line = body.command_line || "";
    mol.citation = body.citation || "";
    mol.validation = body.validation || "";
    mol.alternative_alias = body.alternative_alias || [];
    // Check force field and martinize version
    logger.debug(`[MoleculeChecker:constructBaseMoleculeFromRequest]checking forcefield and martinize version...`);
    
    await this.checkCreateWay(body.create_way);

    mol.create_way = body.create_way;
    logger.debug(`[MoleculeChecker:constructBaseMoleculeFromRequest] completed ${mol.alias}:${mol.force_field}[${mol.version}] @${mol.id}`);
    return mol;
  }

  protected swallowCopyFromParent(molecule: Partial<BaseMolecule>, parent: Molecule) {
    molecule.name = parent.name;
    molecule.alias = parent.alias;
    molecule.smiles = parent.smiles;
    molecule.category = parent.category;
    molecule.tree_id = parent.tree_id;
    molecule.parent = parent.id;
  }

  // changed from protected to public
  public async checkName(name: string, tree_id: string, force_field?: string) {
    if (!name.match(NAME_REGEX)) {
      return Errors.throw(ErrorType.InvalidName);
    }

    let selector = {}
    if(force_field){
      selector = {name, force_field}
    } else {
      selector = {name}
    }
    logger.debug(`[MoleculeChecker:checkName] selector:${inspect(selector)}`);
    const mols = await Database.molecule.find({ limit: 99999, selector });
    for (const mol of mols) {
      if (mol.tree_id !== tree_id) {
       logger.error(`[MoleculeChecker:checkName] NameAlreadyExists ${inspect(selector)} @id:${mol.id} and tree_id missmatch [ ${mol.tree_id} vs ${tree_id}]`);
        return Errors.throw(ErrorType.NameAlreadyExists, {'id':mol.id});
      }
    }
  }
  

  protected async checkAlias(name: string, tree_id: string, force_field: string) {
    if (!name.match(ALIAS_REGEX)) {
      return Errors.throw(ErrorType.InvalidAlias);
    }

    let selector = {}
    if(force_field){
      selector = {alias : name, force_field}
    } else {
      selector = {alias : name}
    }

    const mols = await Database.molecule.find({ limit: 99999, selector });

    for (const mol of mols) {
      if (mol.tree_id !== tree_id) {
        return Errors.throw(ErrorType.AliasAlreadyExists);
      }
    }
  }



  protected checkVersion(v: string) {
    if (!v.match(VERSION_REGEX)) {
      return Errors.throw(ErrorType.InvalidVersion);
    }
  }

  /*protected async checkExists(name:string, alias: string) {
    if (!name.match(NAME_REGEX)) {
      return Errors.throw(ErrorType.InvalidName);
    }
    
    let mols = await Database.molecule.find({ limit: 99999, selector: { name } });
    if(mols.length === 0) mols = await Database.molecule.find({ limit: 99999, selector: { alias } });
    if(mols.length === 0) return undefined

    const treeIds = new Set(mols.map(mol => mol.tree_id))
    if(treeIds.size !== 1) return Errors.throw(ErrorType.ConsistencyVersionTree)

  }*/

  protected async checkCategory(cat: string[]) {    
    const correctedCat = typeof cat === "string" ? [cat] : cat;
    const settings = await SettingsWrapper.getSettingsWrapper();
    const unk_cat = correctedCat.filter( (category) => !settings.findInCategoryTree(category) )
    if(unk_cat.length) {
        logger.error(`[MoleculeChecker:checkCategory] unknwon category(ies) \"${unk_cat}\" `);
    }
    return unk_cat.length === 0;
  }

  protected async checkCreateWay(v: string) {
    const settings = await SettingsWrapper.getSettingsWrapper();
    if (!(v in settings.create_way)) {
      return Errors.throw(ErrorType.InvalidMartinizeVersion);
    }
  }

  protected checkForceField(v: string) {
    const ffStore = ForceFieldStore.getStore();
    if (!ffStore.isAvailableForceField(v)) {
      logger.error(`[Moleculechecker:checkForcefield] Not a valid forcefield '${v}'`);
      return Errors.throw(ErrorType.InvalidForceField);
    }
  }

  protected async versionExistsInTreeIdAndFf(tree_id: string, version: string, current_id: string, force_field: string) {
    const versions = await Database.molecule.find({ limit: 20, selector: { tree_id, version, force_field } });
    for (const v of versions) {
      if (v.id !== current_id) {
        return true;
      }
    }

    return false;
  }

}
