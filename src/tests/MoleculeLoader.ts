import dotenv from 'dotenv';

const conf = dotenv.config({ path: __dirname + "/../../.env" })
if (conf.error) {
  console.log("Error while loading conf. Verify or create .env file")
  console.log("Stack trace:", 'stack' in conf.error ? conf.error : conf.error)
  process.exit(2)
}
import logger from '../logger';
logger.level=process.env.LOG_LVL as string;
import Executor from '../Builders/Executor';
//Executor.mode = "server";

import { assert } from 'chai';
import { DatabaseTestManager, MoleculeOrganizerTestManager, MartiniVersionTestManager } from './testUtils';

import { sortByLatestVersionNumber, MartiniVersion } from '../helpers/martiniVersions'

import { inspect } from 'util';
import {InputTextWrapper} from '../helpers/inputs';
import { addMetaTransform } from '../helpers/itp';
import TmpDirHelper from '../TmpDirHelper';

import { MoleculeLoader } from "../MoleculeLoaderFS"; 
/*
import MoleculeOrganizer from '../MoleculeOrganizer';
import { getFileID } from '../helpers/database/molecule';
*/
import DatabaseMoleculeDesk from '../helpers/database/molecule';
import { basename } from 'path';
/*describe('Test suite:: [MoleculeLoader]', function () {
  this.timeout(20000);
  const srcFolder = __dirname + "/data/data_submit/from_PDB/topol.top"; 
  const forcefield = "martini3001";
*/

const cleanBefore  =  (process.env.RESET_AUTOTEST === "yes");  
const cleanAfter   =  !(process.env.STICKY_AUTOTEST === "yes");  

const GRO_PATH=`${__dirname}/data/data_submit/from_GRO`;
const MANY=`${__dirname}/data/data_submit/from_many`;
const ZIPS=`${__dirname}/data/data_submit/from_ZIP/*zip`;
const HTTP_PATH=`${__dirname}/data/data_submit/from_HTTP`;

describe(`Test suite:: [MoleculeLoader]`, function() {
  this.timeout(40000);
  before( 'molecule_organizer-test-init', MoleculeOrganizerTestManager.init );

  if(cleanBefore) {
    before('database-test-cleanup', DatabaseTestManager.cleanup);
  }
  before( 'database-test-init', DatabaseTestManager.init );

  
  if(cleanAfter)
    after ( 'database-test-cleanup', DatabaseTestManager.cleanup );


  it(`0.0 MoleculeLoader Clean-up...`, () => {
    logger.info("Need to implement actual cleaning of tmp folders here");
  });
  
  it(`1. Force fields version syntax`, () => {
    
    const forcefieldLabels = MartiniVersionTestManager.shuffle();
    const sortLabels = sortByLatestVersionNumber(forcefieldLabels);
    assert.deepEqual( sortLabels, MartiniVersionTestManager.expected);
  });
  
  it(`2. Parsing from ${GRO_PATH}`, async () => {
      const _ = MoleculeLoader.add(GRO_PATH);
      assert.equal(_ ,null);
      const recapInsertion = await MoleculeLoader.insert({id:DatabaseTestManager.ADMIN_USER_TEST, role:'admin'});
      logger.info(recapInsertion);

    });

  it(`3. Parsing from ${MANY}, testing parsing logic`, async () => {
    const _ = MoleculeLoader.add(MANY);      
    assert.equal(_ ,null);
    const recapInsertion = await MoleculeLoader.insert({id:DatabaseTestManager.ADMIN_USER_TEST, role:'admin'});
    logger.info(inspect(recapInsertion));

  });
  it(`3.1 Editing batch elements from ${MANY}`, async () =>{
    let _:any = await MoleculeLoader.add(MANY);
    if(!_)
      logger.debug("No parsing errors reported");
    else
      logger.error("Parsing errors reported:\n" + inspect(_));
    const id2mod = MoleculeLoader.popBatch();
    let eView = await MoleculeLoader.look(id2mod);
    logger.info(`${eView?.alias}\t${eView?.name}\t${eView?.category}\t[${eView?.id}]\n${eView?.itp}`);
    
    logger.debug(`Editing  ${id2mod} ...`);
    await MoleculeLoader.touch(id2mod, {number:'3.3.3.3.3', forcefield:'elnedyn22'})

    logger.debug(`looking at the results`);
    eView = await MoleculeLoader.look(id2mod)
    logger.info(`${eView?.alias}\t${eView?.name}\t${eView?.category}\t[${eView?.id}]\n${eView?.itp}`);
    
    logger.debug(`Restoring ${id2mod} in original state ...`);
    await MoleculeLoader.checkout(id2mod);

    eView = await MoleculeLoader.look(id2mod)
    logger.info(`${eView?.alias}\t${eView?.name}\t${eView?.category}\t[${eView?.id}]\n${eView?.itp}`);


  });
  //Make below start dependant on above success ^^
  it(`3.2 Inserting elements from ${MANY}`, async () => {
    let _:any = await MoleculeLoader.add(MANY);
    if(!_)
      logger.debug("No parsing errors reported");
    else
      logger.error("Parsing errors reported:\n" + inspect(_));
    MoleculeLoader.connect('admin', 'admin');
    MoleculeLoader.commit();
    await MoleculeLoader.push();

    MoleculeLoader.status();
  });
  it(`3.3 Inserting ZIP archives from ${ZIPS}`, async () => {
    let errors:any = await MoleculeLoader.add(ZIPS);
   
    if(!errors)
      logger.debug("No parsing errors reported");
    else
      logger.error(`${errors.length} parsing errors reported:\n${inspect(errors)}`);
    
    MoleculeLoader.connect('admin', 'admin');
    MoleculeLoader.commit();
    await MoleculeLoader.push();

    MoleculeLoader.status();

  });
  it(`3.X dummy`, async () => {
    const s = InputTextWrapper("/tmp/toto");
    s.on('end', ()=>{logger.info("END")})
    s.on('data', (c)=>logger.info(c.toString()))
    });
    /*
    it('2. getCcMapRCSU', function(done) {
    let c2 = new Cube(5);
    expect(c2.getSurfaceArea()).to.equal(150);
    done();
    });

    it('3. createPdbWithConect', function(done) {
    let c3 = new Cube(7);
    expect(c3.getVolume()).to.equal(343);
    done();
    });
    */


  it(`4.0 Decorating ITP from ${HTTP_PATH}`, async () => {

  const tgtDir = await TmpDirHelper.get([`${HTTP_PATH}/POPC.itp`]);
  await addMetaTransform({originalname:'POPC.itp', path : `${tgtDir}/POPC.itp`, size:3333},
    { name:"titi", category:['MC:0001', 'MC:0005'], number:"1.0", forcefield:'martini3001'});
    logger.info(`Decorated ${HTTP_PATH}/POPC.itp into ${tgtDir}/POPC.itp`);
  });

  it(`4.1 Modifying ITP Database`, async () => {
  /**
   * - Parse an element in DB molecule
   * - Modify one of its property in document
   * - Update its itp comment section file accordignly
  */
  
  let _:any = await MoleculeLoader.add(MANY);
  if(!_)
    logger.debug("No parsing errors reported");
  else
    logger.error("Parsing errors reported:\n" + inspect(_));
  MoleculeLoader.connect('admin', 'admin');
  MoleculeLoader.commit();
  const ok_ids = await MoleculeLoader.push();

  MoleculeLoader.status();
  if(ok_ids) {
      logger.info("of_ids " + ok_ids);
      logger.info(`Trying to updateMolecule ${ ok_ids[0]}`);
      await DatabaseMoleculeDesk.updateMolecule( { name:"titi", category:['MC:0001', 'MC:0005'], version:"18.0", force_field:'martini3001'}, ok_ids[0]);
    /*  const f_id = await getFileID(ok_ids[0])
    
      if(f_id)
        await MoleculeOrganizer.update(f_id,  { name:"titi", category:['MC:0001', 'MC:0005'], number:"18.0", forcefield:'martini3001'});
      else
        logger.error(`No file id found @${ok_ids[0]}`);
    }
  */
  }
  });

  it(`5.0 Sanitize a zip archive`, async ()=> {
    if(!process.env.npm_config_zip)
      throw new Error("Please provide a zip archive with \"--zip\" flag");
    console.log(process.env.npm_config_zip);
    MoleculeLoader.connect('admin', 'admin');
    MoleculeLoader.add(process.env.npm_config_zip);
    MoleculeLoader.commit();
    const ok_ids = await MoleculeLoader.push();
  });
  

  it(`5.1 Decorate an itp`, async ()=> {
    if(!process.env.npm_config_itp)
      throw new Error("Please provide a itp file with \"--itp\" flag");

    const tgtDir = await TmpDirHelper.get([process.env.npm_config_itp]);
    await addMetaTransform({originalname:process.env.npm_config_itp, 
                            path : `${tgtDir}/${basename(process.env.npm_config_itp)}`,
                             size:3333},
      { name:"titi", category:['MC:0001', 'MC:0005'], number:"1.0", forcefield:'martini3001', resetCategory : true});
      logger.info(`Decorated ${process.env.npm_config_itp} into ${tgtDir}/${basename(process.env.npm_config_itp)}`);
  });

});