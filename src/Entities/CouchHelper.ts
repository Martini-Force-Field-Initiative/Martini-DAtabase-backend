import nano from 'nano';
import TokenDatabase from './TokenDatabase';
import MoleculeDatabase from './MoleculeDatabase';
import UserDatabase from './UserDatabase';
import StashedMoleculeDatabase from './StashedMoleculeDatabase';
import { URLS, DB_PREFIX } from '../constants';
import logger from '../logger';
import RadiusDatabase from './RadiusDatabase';
//import LipidDatabase from './LipidDatabase';
import HistoryDatabase from './HistoryDatabase'; 
import JobDatabase from './JobDatabase';
import { inspect } from 'util';

export const isValidCouchDocumentName = (name: string) => {
  return /^[a-z][a-z0-9_\-]+$/i.test(name);
};

export class CouchDatabase<T> {
  constructor(protected collection: nano.DocumentScope<T>) {}

  get db() {
    return this.collection;
  }
}

interface Databases {
  molecule: MoleculeDatabase;
  stashed: StashedMoleculeDatabase;
  user: UserDatabase;
  token: TokenDatabase;
  radius: RadiusDatabase;
 // lipid: LipidDatabase;
  history: HistoryDatabase; 
  job : JobDatabase; 
}

interface Adresses {
  molecule: string;
  stashed: string;
  user: string;
  token: string;
  radius: string;
  //lipid: string;
  history: string; 
  job : string; 
}

export default class CouchHelper {
  public link!: nano.ServerScope;
  private dbs!: Databases;
  private ns:string = `${DB_PREFIX}`;
  readonly addr!:Adresses;
  /*
  MOLECULE_COLLECTION = `${DB_PREFIX}molecule`;
  STASHED_MOLECULE_COLLECTION = `${DB_PREFIX}stashed`;
  USER_COLLECTION = `${DB_PREFIX}user`;
  TOKEN_COLLECTION = `${DB_PREFIX}token`;
  RADIUS_COLLECTION = `${DB_PREFIX}vanderwaalsradii`;
  LIPID_COLLECTION = `${DB_PREFIX}lipid`;
  HISTORY_COLLECTION = `${DB_PREFIX}history`;
  JOB_COLLECTION = `${DB_PREFIX}job`; 
  DBS = [
    `${DB_PREFIX}molecule`,
    `${DB_PREFIX}stashed`,
    `${DB_PREFIX}user`,
    `${DB_PREFIX}token`,
    `${DB_PREFIX}vanderwaalsradii`,
    `${DB_PREFIX}lipid`,
    `${DB_PREFIX}history`, 
    `${DB_PREFIX}job`
  ];
  */
  constructor(private url: string) {
    
    this.addr =  { 
      molecule : `${DB_PREFIX}molecule`,
      stashed  : `${DB_PREFIX}stashed`,
      user     : `${DB_PREFIX}user`,
      token    : `${DB_PREFIX}token`,
      radius   : `${DB_PREFIX}vanderwaalsradii`,
     // lipid    : `${DB_PREFIX}lipid`,
      history  : `${DB_PREFIX}history`, 
      job      : `${DB_PREFIX}job`
    };

    this.refresh();

  }
  
  get symbols():string[] {
    /*
    returns the 'fixed database names for cli'
    */
    return Object.keys(this.dbs);
  }
  get endpoints():string[] {
    /*
    returns the 'fixed database names for cli'
    */
    return Object.values(this.addr);
  }
  setNamespace(ns:string) {
    if ( !ns.match(/^[\S]+$/) )
      throw(`[CouchHelper:setNamespance]Custom database prefix must not contain space \"${ns}\"`);
    this.ns = `${ns}_`;
    logger.info(`[constant:setDbPrefix] Setting couch endpoints prefix to \"${ns}\"`);

    for (const k in this.addr)
      this.addr[k as keyof Adresses] = `${ns}_${k}`;


      /*
    this.MOLECULE_COLLECTION = `${this.ns}molecule`;
    this.STASHED_MOLECULE_COLLECTION = `${this.ns}stashed`;
    this.USER_COLLECTION = `${this.ns}user`;
    this.TOKEN_COLLECTION = `${this.ns}token`;
    this.RADIUS_COLLECTION = `${this.ns}vanderwaalsradii`;
    this.LIPID_COLLECTION = `${this.ns}lipid`;
    this.HISTORY_COLLECTION = `${this.ns}history`;
    this.JOB_COLLECTION = `${this.ns}job`; 

    this.DBS = [
      this.MOLECULE_COLLECTION,
      this.STASHED_MOLECULE_COLLECTION,
      this.USER_COLLECTION,
      this.TOKEN_COLLECTION ,
      this.RADIUS_COLLECTION,
      this.LIPID_COLLECTION,
      this.HISTORY_COLLECTION,
      this.JOB_COLLECTION, 
    ];
    */
    this.refresh();
  }
  /**
   * Link the given url to collections.
   */
  refresh(url?:string) {
    if(url)
      this.url = url;
    this.link = nano({ url : this.url, requestDefaults: { proxy: null } });

    this.dbs = {
      molecule: new MoleculeDatabase(this.link.use(this.addr.molecule)),
      stashed: new StashedMoleculeDatabase(this.link.use(this.addr.stashed)),
      user: new UserDatabase(this.link.use(this.addr.user)),
      token: new TokenDatabase(this.link.use(this.addr.token)),
      radius: new RadiusDatabase(this.link.use(this.addr.radius)),
     // lipid: new LipidDatabase(this.link.use(this.addr.lipid)),
      history: new HistoryDatabase(this.link.use(this.addr.history)), 
      job : new JobDatabase(this.link.use(this.addr.job))
    };
  }

  async ping() {
    // This is not valid check a database 
    logger.debug(`[CouchHelper:ping] Couch Server handshaking @${this.url}...`);
    try {
      const _ = await this.link.db.list();
    } catch (e:any) {            
      logger.error(`[CouchHelper:ping] Failed ${e.message}`);     
      throw new Error(`[CouchHelper:ping] Failed ${e.message}`);
    }

    logger.debug(`[CouchHelper:ping] handshake successfull`);
  }
    /**
   * 
   * @param name CouchDB user
   * @param password CouchDB password
   * @param target name of the backup
   */
  async replicate(src:string, target:string):Promise<void> {
    logger.info("[CouchHelper:replicate] Replicating from " + src + " to " + target);
    await this.link.db.replicate(src, target);
  };
  
  get molecule() {
    return this.dbs.molecule;
  }

  get token() {
    return this.dbs.token;
  }

  get user() {
    return this.dbs.user;
  }

  get stashed() {
    return this.dbs.stashed;
  }

  get radius() {
    return this.dbs.radius;
  }

  /*get lipid() {
    return this.dbs.lipid;
  }*/

  get history() {
    return this.dbs.history
  }

  get job() {
    return this.dbs.job
  }

  /** Create a database */
  create(symbol: string, toPrefix:boolean=true) {
    const name = toPrefix ? this.addr[ symbol as keyof Adresses ] : symbol;
    logger.debug(`[CouchHelper:create] Creating ${name}`);
    return this.link.db.create(name);
  }

  async createAll() {
    for (const db of this.endpoints ) {
      try {
        const _ = await this.create(db, false);
        logger.debug(`[CouchHelper:create] ${db} ${JSON.stringify(_)}`);
      } catch(e) {
        logger.warn(`[CouchHelper:create] Could not create ${db}, \"${e}\"`);
      }
    }
  }

  /** Delete a database */
  async delete(symbol: string) {
    if (! (symbol in this.dbs) )
      throw(`[CouchDbHelper:delete]${symbol} is not a valid database symbol, valid are:\n${this.dbs}`);
    //const name:unknown = this.dbs[symbol as keyof Databases];
    const name = this.addr[ symbol as keyof Adresses ];
    logger.debug(`[CouchHelper:delete] Deleting endpoints ${name}`);
    return this.link.db.destroy(name as string).catch(e => e);
  }

  async deleteAll() {
    for (const db of this.symbols) {
      await this.delete(db);
    }
  }

  /** Wipe all databases and recreate them all */
  async wipeAndCreate() {
    await this.deleteAll();
    await this.createAll();
  }
}

export const Database = new CouchHelper(URLS.COUCH);
