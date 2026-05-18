import axios from 'axios';

/**
 * Interacting with another CouchDB instance, Basic Operations
 * 
 * 
 * 
 */
const reExtDatabase =  new RegExp('(https{0,1}):\/\/([A-Za-z0-9]+):([^@]+)@([^:]+):([0-9]+)\/([^\/]+)$');
class ExternalDatabaseParsingError extends Error {};
class ExternalDatabaseConnectError extends Error {};
// We keep it simple with HTTP managment, no nano.db object required yet
//https://USERNAME:PASSWORD@hostname:port'

export default class ExternalDatabase {
    /**
     * ExternalDatabase.create(https://USERNAME:PASSWORD@hostname:port/document_endpoint)
     * @param input 
     * 
     * @returns 
     */
    static async connect(input:string):Promise<ExternalDatabase> {
        const extDb = new ExternalDatabase(input);
        try {
            console.log(extDb.rootUrl);
            const resp = await axios.get(extDb.rootUrl);
            console.log(resp.data);
        }
        catch(e:any) {
            throw new ExternalDatabaseConnectError(e?.message);
        }
        return extDb;
    }

    port: number;
    host: string;
    user: string;
    password:string;
    document:string;
    protocol:string;
    constructor(input:string) {
        const m = reExtDatabase.exec(input);
        if(!m)
            throw new ExternalDatabaseParsingError(`Not a valid external database url \"${input}\"`);
        this.port     = parseInt(m[5]);
        this.host     = m[4];
        this.user     = m[2];
        this.password = m[3];
        this.document = m[6];
        this.protocol = m[1];
    }
    get url () {
        return `${this.protocol}://${this.user}:${this.password}@${this.host}:${this.port}/${this.document}`;
    }
    get rootUrl () {
        return `${this.protocol}://${this.user}:${this.password}@${this.host}:${this.port}`;
    }
}
