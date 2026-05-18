import { Database } from '../Entities/CouchHelper';
import { UserRole } from "../types";
import { User } from "../Entities/entities";
import { glob } from 'glob';
import { generateSnowflake } from '../helpers/simple';
import logger from '../logger';
import MoleculeOrganizer from '../MoleculeOrganizer';
import { basename } from 'path';
import TmpDirHelper from '../TmpDirHelper';
import  bcrypt  from 'bcrypt';

export class DatabaseTestManager {
  static admin_id = generateSnowflake();
  static lambda_id = generateSnowflake();

  static ADMIN_USER_TEST = "admin";
  static ADMIN_PWD_TEST = "admin";

  static LAMBDA_USER_TEST = "lambda";
  static LAMBDA_PWD_TEST = "lambda";

  static DBTEST_NS = "auto_test";

  static async init() {
    try {
      await Database.ping();
      Database.setNamespace(DatabaseTestManager.DBTEST_NS);
      await Database.createAll();
      const adminUser: User = {
        id: DatabaseTestManager.admin_id,
        name: DatabaseTestManager.ADMIN_USER_TEST,
        email: "john@doe.com",
        fullname: "auto_admin",
        affiliation: "auto_affil",
        role: "admin" as UserRole,
        created_at: new Date().toISOString(),
        password: await bcrypt.hash(DatabaseTestManager.ADMIN_PWD_TEST, 10),
        approved: true,
      };

      let _ = await Database.user.save(adminUser);

      const lambdaUser: User = {
        id: DatabaseTestManager.lambda_id,
        name: DatabaseTestManager.LAMBDA_USER_TEST,
        email: "john@doe.com",
        fullname: "auto_lambda",
        affiliation: "auto_affil",
        role: "dev" as UserRole,
        created_at: new Date().toISOString(),
        password: await bcrypt.hash(DatabaseTestManager.LAMBDA_PWD_TEST, 10),
        approved: true,
      };

      _ = await Database.user.save(lambdaUser);


      logger.info(`Database @${DatabaseTestManager.DBTEST_NS} NS Created`);
    } catch (e) {
      logger.error("Did not create new Databases");
    }
  }

  static async cleanup() {
    try {
      await Database.ping();
      Database.setNamespace(DatabaseTestManager.DBTEST_NS);
      await Database.deleteAll();
      logger.info(`Databases @${DatabaseTestManager.DBTEST_NS} NS Cleaned`);
    } catch (e) {
      logger.error(`Did not delete @${DatabaseTestManager.DBTEST_NS} Databases`);
    }
    try {
      await TmpDirHelper.clean();
      const _ = await TmpDirHelper.nuke();
      logger.info(`Local cache folder @${TmpDirHelper.rootDir} Cleaned`);
    } catch (e) {
      logger.error(`Did not delete cache folder @${TmpDirHelper.rootDir} (${e})`);
    }
  }
}


export class MoleculeOrganizerTestManager {
  static MOLECULE_DIR_TEST = "auto_test";
  /*static async wipe() {

  }*/
  static async init() {
    logger.info(`[MoleculeOrganizerTestManager] Setting NS to ${MoleculeOrganizerTestManager.MOLECULE_DIR_TEST}`);
    MoleculeOrganizer.setNamespace(MoleculeOrganizerTestManager.MOLECULE_DIR_TEST);
  }
} 



export class MartiniVersionTestManager {
  static sortedFfTuples:[string, any][] = [
    ["some_funky_ff.itp", undefined],      
    ["martini_v2.0_ions.itp", undefined],
    ["martini_v2.0_solvents.itp", undefined],
    ["martini_v2.2P.itp", undefined],   
    ["martini_v2.2.itp", undefined],   
    ["martini_v2.3P.itp", undefined],
    ["martini_v2.3_CNP.itp", undefined],       
    ["martini_v3.0_ions.itp", undefined],
    ["martini_v3.0.0_ions_v1.itp", undefined],
    ["martini_v3.0_solvents.itp", undefined],
    ["martini_v3.0.0_solvents_v1.itp", undefined],
    ["martini_v3.0.0.itp",undefined],
    ["martini_v3.0.4.itp", undefined]
  ];

  static shuffle() {
    return MartiniVersionTestManager.sortedFfTuples.toSorted((a, b) => 0.5 - Math.random());
  }
  static get expected() {    
    return MartiniVersionTestManager.sortedFfTuples;
  }
  /**
   * Generate the list of current martini itp file labelss
   */
  private async generate(){
    let ffFile:any = await glob(`${process.env.FORCE_FIELD_DIR}/*itp`);
    ffFile = ffFile.map((fname:string)=>[ basename(fname), undefined]);
  }
} 