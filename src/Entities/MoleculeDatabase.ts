import { BaseMolecule, Molecule } from "./entities";
import AbstractDatabase from "./AbstractDatabase";
import CompleteMoleculeVersionTree from "./MoleculeVersionTree";
import nano = require("nano");
import SearchWorker from "../search_worker";
import { rawVersionGreaterThan } from '../helpers/martiniVersions';
import logger from '../logger';
import { popLatestForceField } from '../helpers/martiniVersions';
import ForceFieldStore, {AvailableForceField} from "../Stores/ForceFieldStore";

export type MoleculeVersionSelector = {
  alias?:string,
  force_field?:string,
  version?:string,
  id?:string,
  latest?:boolean
};

export default class MoleculeDatabase extends AbstractDatabase<Molecule> {
  async getTreeIDs():Promise<string[]> {
    const mols = await this.find({ limit: 999999, selector: {"_id":{"$gt": null}} });
    const tree_ids = mols.reduce((tree_ids, curr) => tree_ids.add(curr.tree_id), new Set<string>())
    return [...tree_ids]
  }
  /**
   * Construct the `MoleculeVersionTree` of {tree_id}
   *
   * If any molecule have this tree id, returns `undefined`
   */
  async moleculeTreeOf(tree_id: string) {
    const mols = await this.find({ limit: 999999, selector: { tree_id } });

    if (mols.length) {
      return new CompleteMoleculeVersionTree(mols);
    }
  }
    /**
   * assign the latest tag to one single molecule in the entiere tree accoutning for:
   * version number
   * FF precedence
   * An optional parameter mol_id can force a specific molecule to be set to latest mol of the tree
   * This option is deprecated in favor of version number consistency
   */
    async updateLatestMoleculeTreeOf(tree_id: string/*, mol_id?:string*/):Promise<string|undefined> {
      const ffStore = ForceFieldStore.getStore();
      logger.debug(`[MoleculeVersionTree:updateLatest] tree_id:${tree_id}`);   
      const currModelTree = await this.moleculeTreeOf(tree_id);
      if(!currModelTree) {
        logger.error(`[MoleculeDatabase:updateLatestMoleculeTreeOf] unexpected undefined molecule tree`);
        return undefined;
      }
      logger.debug(`[MoleculeVersionTree:updateLatestMoleculeTreeOf] ${currModelTree.molecules.length} elements`);   
      //console.log(">>" + Object.keys(currModelTree.trees));
      const ffTreeKeys:AvailableForceField[] = Object.keys(currModelTree.trees).filter(e=>ffStore.isAvailableForceField(e)).map( e=>e as AvailableForceField);
      let latest:[AvailableForceField, BaseMolecule|undefined] = [ 
        popLatestForceField(ffTreeKeys),
        undefined
      ];
      for (const ff in currModelTree.trees) {
        for (const tree of currModelTree.trees[ff]) {
          tree.walk( (n)=>{ 
            n.content.latest = false;
            logger.debug(`[updateLatestMoleculeTreeOf] walk:callback ${n.content.alias}:${n.content.force_field}[${n.content.version}] ltst:${n.content.latest ? 'true':'false'}`)
            if(n.content.force_field !== latest[0])
              return;
            if(latest[1] === undefined)
              latest[1] = n.content;
            if( rawVersionGreaterThan(n.content.version, latest[1].version) ) {
              latest[1] = n.content;
            }
          });
      }}
      if(latest[1] === undefined) {
        logger.error(`[updateLatestMoleculeTreeOf] Unable to get a latest tag element for tree_id ${tree_id}`);
        return;
      }

      logger.debug(`[updateLatestMoleculeTreeOf] Assigning latest tag tree_id ${tree_id} @${latest[1].id} ie ${latest[1].alias}:${latest[1].force_field}[${latest[1].version}]`);
      latest[1].latest = true;
      /*for (let mol of currModelTree.molecules ) {
        let _molDoc = await this.find({ limit: 999999, selector: { id:mol.id } });
        if(!_molDoc.length)
          throw new Error("This should not happen");
        _molDoc[0].latest = mol.latest;
        await this.save(_molDoc[0]);
      }*/
     await this.bulkUpdate(currModelTree.molecules as (Molecule & { _id: string; _rev: string; })[])
      // Iterate reset, store
  }
  /** Bulk create */
  bulkCreate(docs: Molecule[]) {    
    SearchWorker.clearCache();
    return super.bulkCreate(docs);
  }

  /** Bulk update */
  bulkUpdate(docs: Molecule[]) {
    SearchWorker.clearCache();
    return super.bulkUpdate(docs);
  }

  /** Bulk delete */
  bulkDelete(documents: Molecule[]) {
    SearchWorker.clearCache();
    return super.bulkDelete(documents);
  }

  /** Bulk create, update or delete */
  bulk(docs: nano.BulkModifyDocsWrapper) {   
    SearchWorker.clearCache();
    return super.bulk(docs);
  }

  save(element: Molecule) {
    SearchWorker.clearCache();
    return super.save(element);
  }

  delete(element: Molecule) {
    SearchWorker.clearCache();
    return super.delete(element);
  }
  /**
   * Returns the tree_id common to all molecules version w/ the same alias
   */

  async getAliasTreeID(alias:string) {
    const mols = await this.find({ limit: 999999, selector: { alias } });
    let tree_id = undefined;
    for (let m of mols) {
      if(tree_id === undefined)
        tree_id = m.tree_id;
      if(tree_id !== m.tree_id)
        throw new Error(`Following molecules w/ identical aliases (${alias}) have different tree_id (id:tree_id): ${mols.map( (_) => `${_.id}:${_.tree_id}`).join(', ') } )`)
    }

    return tree_id;
  }

  async getVersions(versionSel:MoleculeVersionSelector, sortBy?:string) {
    const mols = await this.find({ limit: 999999, selector: { ...versionSel } });    
    if(sortBy)
      if(sortBy === 'versionNumber') {
        const _:(Molecule & {_rev:string, _id:string})[] = [];
        mols.forEach( (m) => {
          for( let i = 0; i < _.length ; i++)
            if (rawVersionGreaterThan( _[i].version, m.version)){
              _.splice(i,0, m);
              return;
          }
          _.push(m);
        });
        return _;
      }

    return mols
  }

  /* Returns Molecule document(s) which are direct children of document(s) matching selector
  */
  async getFirstChildren(versionSel:MoleculeVersionSelector):Promise<Molecule[]> {
    const parents = await this.find({ limit: 999999, selector: { ...versionSel } });
    if(parents.length !=1)
      logger.warn(`[Entities.MoleculeDatabase:getFistChildren] provided parent selector matches ${parents.length} element(s)`);

    const mols = await this.find({ limit: 999999, selector: { 'parent':{'$or': parents.map( n=>n.id ) } } });
    return mols;
  }

  async stats(){
    SearchWorker.clearCache();
    const mols = await this.all()
    const aliased: {[alias: string]: Molecule[]} = {}
    let byCategories: any = {}
    let byForceField: any = {}
    for (const mol of mols){
      if(!(mol.alias in aliased)) aliased[mol.alias] = []
      aliased[mol.alias].push(mol)
    }     
    for (const alias in aliased){
      const mols = aliased[alias]
      const ffs = new Set(mols.map(mol => mol.force_field))
      const cats = new Set(mols.map(mol => mol.category).flat())
    /*  
      if(alias === "ALA"){
        console.log("FFS", ffs)
        console.log("CATS", cats)
      }
      */
      for (const ff of ffs){
        if(!(ff in byForceField)) byForceField[ff] = 0
        byForceField[ff] += 1
      }
      for (const cat of cats){
        if(!(cat in byCategories)) byCategories[cat] = 0
        byCategories[cat] += 1
      }
    }
    return({byCategories, byForceField, all:aliased})
  }
}
