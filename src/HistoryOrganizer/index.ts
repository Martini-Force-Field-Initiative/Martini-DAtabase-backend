import logger from '../logger';
import { HISTORY_ROOT_DIR } from '../constants';
import fs, { promises as FsPromise } from 'fs';
import path, { resolve } from 'path';
import { Database } from '../Entities/CouchHelper';
import { MoleculeBuilderJob, PolyplyJob, isMoleculeBuilderJobSettings, isPolyplyJobSettings} from '../Entities/entities/job'
import { generateSnowflake, getFormattedFile, dateFormatter } from "../helpers/simple";
import { isCouchNotFound, notFoundOnFileSystem } from '../Errors';
import { PolyplyJobFilesNames, MoleculeBuilderJobFilesNames, AnyJobReadedFiles, AnyJobFilesNames } from '../Entities/entities/job';
import { promises as fsPromise} from 'fs';
import { Readable } from 'stream';
import { InputText, readableToFile, fileStringContent, stringToStream, readableToString, FilePathOrTupleStream } from '../helpers/inputs';
import { HistoryBundleFS, HistorySaveSpecs, isMoleculeBuilderHistoryBundleFS  } from './type';
import { isMoleculeBuilderJob, AnyJob } from '../Entities/entities/job';
import { pathOfFilePathOrTupleStream, srcOfFilePathOrTupleStream } from '../helpers/inputs';
import { inspect } from 'util';
function getUserJobObject(jobsDoc: AnyJob[]) {
    let obj: { [userId: string]: string[] } = {}
    jobsDoc.forEach(job => {
        if (!obj.hasOwnProperty(job.userId)) obj[job.userId] = [job.id]
        else obj[job.userId].push(job.id)
    })
    return obj
}



export const HistoryOrganizer = new class HistoryOrganizer {
    constructor() {
        logger.info("HistoryOrganizer constructor")
        try {
            fs.mkdirSync(HISTORY_ROOT_DIR)
        } catch { }

    }
    // LEt's make it work w/ polyply 1st
    public async save(opt:HistorySaveSpecs):Promise<string> {
        const { jobId, userId, files, type, settings, name } = opt
        // The eventual itps streams has to be consumed twice :p 
        // So we clone this way ...
        const flatItps:FilePathOrTupleStream[] = [];
        for (let i = 0 ; i < files.itp_files.length ; i++) 
           for (let j = 0 ; j < files.itp_files[i].length ; j++) {               
                const itp = files.itp_files[i][j]; 
                if(typeof(itp) === "string")
                    flatItps.push(itp);
                else {                   
                    const _ = await readableToString(itp[0]);
                    flatItps.push([stringToStream(_), itp[1]]);
                    files.itp_files[i][j] = [stringToStream(_), itp[1]];
                }
        }
        
        files.itp_files.flat()
        const radius = await Database.radius.getRadius(
          settings.ff || 'martini22',
          flatItps.map( srcOfFilePathOrTupleStream )
        );

        try {
            const doc:Partial<PolyplyJob|MoleculeBuilderJob> = {
                id:jobId,
                jobId,
                date  : dateFormatter("Y-m-d H:i"),
                name,           
                userId,
                radius                         
            }
            
            if (type === "polyply" && isPolyplyJobSettings(settings)) {
                logger.debug("[HistoryOrganizer:save] Attempting to save polyply job to file system");
                const base_files:PolyplyJobFilesNames = await this.savePolyplyJobToFileSystem( jobId, files );
                logger.debug("[HistoryOrganizer:save] Attempting to save polyply job to couchDB");
                await this.saveToCouch({
                ...doc,
                type,
                files:base_files,
                settings
                } as PolyplyJob);
            }

            if (type === "martinize"&& isMoleculeBuilderJobSettings(settings)) {     
                logger.debug("[HistoryOrganizer:save] Attempting to save molecule builder job to file system")
                const base_files:MoleculeBuilderJobFilesNames = await this.saveMoleculeBuilderJobToFileSystem( jobId, files );
                logger.debug("[HistoryOrganizer:save] Attempting to save martinize job to couchDB");
                await this.saveToCouch( {
                    ...doc,
                    type,                  
                    radius,
                    settings,
                    files:base_files
                } as MoleculeBuilderJob);
            }
        } catch(e:any) {
            await this.deleteFromFileSystem(jobId);
            throw(e)
        }
        return jobId;
    }

    private async savePolyplyJobToFileSystem(job_id: string, data: HistoryBundleFS): Promise<PolyplyJobFilesNames> {
        await this.saveToFileSystem(job_id, data);
        logger.info("peeking in polymer.top")
        //logger.debug( await fileStringContent(HISTORY_ROOT_DIR + "/" + job_id + "/polymer.itp") );
        logger.debug("[HistoryOrganizer:savePolyplyJobToFileSystem] Successfull, Extracting base names...");
        return this.baseFileFields(data) as PolyplyJobFilesNames ; 
    }
    private async saveMoleculeBuilderJobToFileSystem(job_id: string, data: HistoryBundleFS): Promise<MoleculeBuilderJobFilesNames> {
        await this.saveToFileSystem(job_id, data);
        return this.baseFileFields(data) as MoleculeBuilderJobFilesNames ; 
    }

    private async saveToFileSystem(job_id: string, data: HistoryBundleFS): Promise<void> {
        const dirPath = HISTORY_ROOT_DIR + "/" + job_id
 
        await fsPromise.mkdir(dirPath);      
        const dumpToWait:Promise<void>[] = [];  
        dumpToWait.push(this.dump(data.coarse_grained, dirPath));
        dumpToWait.push(this.dump(data.top_file, dirPath));
          

        for ( const itp_elem of data.itp_files.flat() )    
            dumpToWait.push(this.dump(itp_elem, dirPath))          
        //logger.debug(`Here ${inspect(data.coarse_grained)}`);
    

  
        if(data.all_atom)
            dumpToWait.push(this.dump(data.all_atom, dirPath));
        if(data.warnings)
            dumpToWait.push(this.dump(data.warnings, dirPath));
        if(data.gro)
            dumpToWait.push(this.dump(data.gro, dirPath));

        await Promise.all(dumpToWait);
        
    }

    private baseFileFields(files:HistoryBundleFS):MoleculeBuilderJobFilesNames|PolyplyJobFilesNames {
        
        let doc = {
            coarse_grained : path.basename(path.basename(pathOfFilePathOrTupleStream(files.coarse_grained))),
            itp_files:  
            files.itp_files.map( (itps) => 
                itps.map( (itp)=>path.basename(pathOfFilePathOrTupleStream(itp)) )           
            ),
            top_file : path.basename(pathOfFilePathOrTupleStream(files.top_file)),
            gro      : files.gro ?  path.basename(pathOfFilePathOrTupleStream(files.gro)) : undefined
        } as PolyplyJobFilesNames
        if(isMoleculeBuilderHistoryBundleFS(files)) {
            doc = {
                ...doc,
                all_atom : files.all_atom ? path.basename(pathOfFilePathOrTupleStream(files.all_atom)) : undefined,
                warnings : files.warnings ? path.basename(pathOfFilePathOrTupleStream(files.warnings)) : undefined,
            } as MoleculeBuilderJobFilesNames
        }
        logger.debug(`[HistoryOrganizer:baseFileFields] Extracted basename document section as ${inspect(doc)}`);
        return doc;
    }
    private async dump(src:string|[Readable, string], tgtDir:string):Promise<void>{
        if (typeof(src) === "string") {
            const name = path.basename(src);
            logger.verbose(`[HistoryOrganizer:dump](from file) ${tgtDir}/${name} ...`);   
            return  fsPromise.copyFile(src, `${tgtDir}/${name}`);
        }
        logger.verbose(`[HistoryOrganizer:dump](from stream) ${tgtDir}/${src[1]} ...`); 
        return readableToFile(src[0], `${tgtDir}/${src[1]}`);
    }

    public async updateJobInFileSystem(jobId: string, itp_files: Express.Multer.File[]) {
        const jobDir = HISTORY_ROOT_DIR + "/" + jobId;
        if (!fs.existsSync(jobDir)) {
            throw new Error("Job directory doesn't exist")
        }
        const newUuid = generateSnowflake()
        const newDir = HISTORY_ROOT_DIR + "/" + newUuid;
        fs.mkdirSync(newDir)
        const files = await FsPromise.readdir(jobDir)
        logger.debug(`copy ${jobId} to ${newUuid}`)
        await Promise.all(files.map(async (currentFile) => {
            await FsPromise.copyFile(jobDir + "/" + currentFile, newDir + "/" + currentFile)
        }))
        logger.debug(`move new itp files to new job directory ${newUuid}`)
        await Promise.all(itp_files.map(async (file) => {
            await FsPromise.rename(file.path, newDir + "/" + file.originalname)
        }))

        return newUuid
    }

    public async replaceJobInFileSystem(jobId: string, itp_files: Express.Multer.File[]) {
        const jobDir = HISTORY_ROOT_DIR + "/" + jobId;
        if (!fs.existsSync(jobDir)) {
            throw new Error("Job directory doesn't exist")
        }
        logger.debug(`move new itp files to job directory ${jobId}`)
        return await Promise.all(itp_files.map(async (file) => {
            await FsPromise.rename(file.path, jobDir + "/" + file.originalname)
        }))

    }

    public async updateJobForSavedBonds(jobId: string, itp_files_names: string[][]) {
        return await Database.job.updateManuallySavedBonds(jobId, itp_files_names);
    }

    public async updateJobAndCreateANewOne(jobId: string, newId: string, newItpFiles: string[][], comment?: string) {
        const updateFnc = (doc: MoleculeBuilderJob) => {

            for (const [idx, mol_files] of newItpFiles.entries()) {

                if (doc.files.itp_files.length <= idx) {
                    doc.files.itp_files.push(mol_files)
                }
                else {
                    const newMolFiles = mol_files.filter(itp => !doc.files.itp_files[idx].includes(itp))
                    doc.files.itp_files[idx] = [...doc.files.itp_files[idx], ...newMolFiles]
                }
            }

            if (doc.manual_bonds_edition) return doc
            doc.manual_bonds_edition = true
            return doc
        }

        const originalJob = await Database.job.get(jobId);
        if(!isMoleculeBuilderJob(originalJob))
            throw (`[HistoreyOrganizer:updateJobAndCreateANewOne] pulled a job whic is not a molecule builder one => \n${originalJob}`);
        const newDoc = updateFnc(originalJob)
        delete newDoc._id
        delete newDoc._rev
        newDoc.id = newId
        newDoc.jobId = newId
        newDoc.comment = comment
        newDoc.date = dateFormatter("Y-m-d H:i")
        newDoc.type 
        this.saveToCouch(newDoc)

    }

    private async deleteFromFileSystem(jobId: string) {
        logger.debug(`Delete ${jobId} from file system`)
        const dirPath = HISTORY_ROOT_DIR + "/" + jobId
        await FsPromise.rm(dirPath, { recursive: true });
    }

    private async deleteMultipleFromFileSystem(jobIds: string[]) {
        logger.debug(`Delete ${jobIds} from file system`)
        return await Promise.all(jobIds.map(id => FsPromise.rmdir(HISTORY_ROOT_DIR + "/" + id, { recursive: true })))
    }

    private async _deleteFromFileSystemIfExists(jobId: string) {
        const dirPath = HISTORY_ROOT_DIR + "/" + jobId
        try {
            await FsPromise.rmdir(dirPath, { recursive: true })
            logger.debug(`${jobId} deleted from file system`)
        } catch (e) {
            if (notFoundOnFileSystem(e)) logger.debug(`job ${jobId} doesn't exist on file system, no deletion`)
            else throw (e)
        }
    }

    private async deleteFromCouch(jobId: string) {
        const job = await Database.job.get(jobId)
        const user = job.userId
        return await Promise.all([Database.job.delete(job), Database.history.deleteJobs(user, [jobId])]);
    }

    private async deleteMultipleFromCouch(jobIds: string[]) {
        logger.debug(`Delete multipe ${jobIds} from couch`)
        const jobs = await Database.job.bulkGet(jobIds)
        let notFoundIdx: number[] = [];
        const filteredJobs = jobs.filter((job, idx) => {
            if (job === null) {
                notFoundIdx.push(idx);
                return false
            }
            return true
        })

        const usersRelatedToJobs = getUserJobObject(filteredJobs)
        let promises = jobs.map(job => Database.job.delete(job))
        for (const [user, jobIds] of Object.entries(usersRelatedToJobs)) {
            promises.push(Database.history.deleteJobs(user, jobIds))
        }
        return await Promise.all(promises);

    }

    private async saveToCouch(doc:PolyplyJob|MoleculeBuilderJob) {
        logger.debug(`[HistoryOrganizer:saveToCouch] b/t to save follwoing document : ${inspect(doc)}`);
        const jobDoc = { ...doc }
        await Database.job.addToJob(jobDoc)
        await Database.history.addToHistory(doc.userId, doc.jobId)
    }

    public async getHistory(userId: string) {
        logger.debug(`[HistoryOrganizer:getHistory] Getting history for user ${userId}`)
        const jobIds = await Database.history.getAllJobs(userId)
        logger.debug(`[HistoryOrganizer:getHistory] Found ${jobIds.length} jobs for user ${userId}`)
        const jobsDetails = await Database.job.getJobsDetails(jobIds, userId);
        logger.debug(`[HistoryOrganizer:getHistory] Details: ${inspect(jobsDetails)}`);
        
        return jobsDetails;
    }

    public async getJob(jobId: string): Promise<AnyJob> {
        return new Promise(async (res, rej) => {
            try {
                const job = await Database.job.get(jobId)
                
                res(job)

            } catch (e) {
                if (isCouchNotFound(e)) {
                    this._deleteFromFileSystemIfExists(jobId)
                    rej("not_found")
                }
                else rej(e)
            }
        })
    }

    public async readFiles(jobId: string, files: MoleculeBuilderJobFilesNames|PolyplyJobFilesNames):Promise<AnyJobReadedFiles> {
        const location = `${HISTORY_ROOT_DIR}/${jobId}`;
        logger.debug(`[HistoryOrganizer:readFiles] Assiging archive directory to ${location}`);
        if("all_atom" in files) // That is weak
            return await this.readMoleculeBuilderFiles(location, files);
        return await this.readPolyplyFiles(location, files);
    }

    public async readMoleculeBuilderFiles(location: string, files: MoleculeBuilderJobFilesNames): Promise<AnyJobReadedFiles> {
        return new Promise(async (res, rej) => {
            logger.debug(`[HistoryOrganizer:readMoleculeBuilderFiles] files are :\n${inspect(files)}`);
            let readedFiles = {
                gro: await getFormattedFile(`${location}/${files.gro}`),
                all_atom: await getFormattedFile(`${location}/${files.all_atom}`),
                top_file: await getFormattedFile(`${location}/${files.top_file}`),
                coarse_grained: await getFormattedFile(`${location}/${files.coarse_grained}`),
                itp_files: await Promise.all(files.itp_files.map(async mol_itp => await Promise.all(mol_itp.map(i => getFormattedFile(`${location}/${i}`))))),
                warnings: await getFormattedFile(`${location}/${files.warnings}`),
            }

            res(readedFiles)
        })
    }

    public async readPolyplyFiles(location: string, files: PolyplyJobFilesNames): Promise<AnyJobReadedFiles> {
        return new Promise(async (res, rej) => {
            logger.debug(`[HistoryOrganizer:readPolyplyFiles] files are :\n${inspect(files)}`);
            let readedFiles = {
                gro: await getFormattedFile(`${location}/${files.gro}`),                
                top_file: await getFormattedFile(`${location}/${files.top_file}`),
                coarse_grained: await getFormattedFile(`${location}/${files.coarse_grained}`),
                itp_files: await Promise.all(files.itp_files.map(async mol_itp => await Promise.all(mol_itp.map(i => getFormattedFile(`${location}/${i}`)))))               
            }

            res(readedFiles)
        })
    }

    public async deleteJobs(jobIds: string[]) {
        return Promise.all([this.deleteMultipleFromCouch(jobIds), this.deleteMultipleFromFileSystem(jobIds)])

    }

    public async wipe () {
    //TO DO : delete history function that delete everything (couch jobs, couch history, file system)
    }
}


export default HistoryOrganizer;