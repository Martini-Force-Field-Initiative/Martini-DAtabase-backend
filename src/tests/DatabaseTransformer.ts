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

import { DatabaseTestManager, MoleculeOrganizerTestManager, MartiniVersionTestManager } from './testUtils';


import { MoleculeLoader } from "../MoleculeLoaderFS"; 
import DatabaseMoleculeDesk  from '../helpers/database/molecule';


const cleanBefore  =  (process.env.RESET_AUTOTEST === "yes");  
const cleanAfter   =  !(process.env.STICKY_AUTOTEST === "yes");  

const GRO_PATH=`${__dirname}/data/data_submit/from_GRO`;
const MANY=`${__dirname}/data/data_submit/from_many`;
const ZIPS=`${__dirname}/data/data_submit/from_ZIP/731655746785695979.zip`;
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
  
      it(`1.0 Replicating a database`, async () => {
        let errors:any = await MoleculeLoader.add(ZIPS);
    
        MoleculeLoader.connect('admin', 'admin');
        MoleculeLoader.commit();
        const ok_ids = await MoleculeLoader.push();    
        MoleculeLoader.status();
        await DatabaseMoleculeDesk.replicate();
        
      });
      it(`2.0 Applying molecule meta-inf to ITP files`, async () => {
        // Read the meta-inf of all molecule
        let errors:any = await MoleculeLoader.add(ZIPS);
        MoleculeLoader.connect('admin', 'admin');
    
        MoleculeLoader.connect('admin', 'admin');
        MoleculeLoader.commit();
        const ok_ids = await MoleculeLoader.push();    
        MoleculeLoader.status();
        await DatabaseMoleculeDesk.syncing();
      });
});