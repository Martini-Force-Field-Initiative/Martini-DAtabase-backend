
import { Router } from 'express';
import { cpuUsage } from 'process';
import HistoryOrganizer from '../../../HistoryOrganizer'
import { errorCatcher, sendError } from '../../../helpers/simple'
import Errors, { ApiError, ErrorType } from "../../../Errors";
import logger from '../../../logger';
import { inspect } from 'util';
import { ReadedFile } from '../../../Entities/entities/job';

const GetItpHistoryRouter = Router();

interface HistoryAnyJob {
  gro:  { name: string, type:string,  content: string },
  itps: { name: string, type:string,  content: string }[]
}

// 'src/routes/history/get.ts'
GetItpHistoryRouter.get('/:job_id', async (req, res) => {
  const job_id = req.params.job_id
  //logger.debug("ITP", job_id);
  const job_details = await HistoryOrganizer.getJob(job_id); // Trust user id exists, not check on user ownership
  // raise exception on empty results ^^
  const { files } = job_details;
  HistoryOrganizer.readFiles(job_id, files).then(readedFiles => {
    //logger.debug(`History ITPs\n${inspect(readedFiles.itp_files)}`);
    const data:HistoryAnyJob = {
      gro : readedFiles.gro,
      itps: readedFiles.itp_files.map(getValidItpFile)
    };
    res.json(data)
  }).catch(e => {
    if (e === "not_found") sendError(Errors.make(ErrorType.HistoryFilesNotFound), res)
    else sendError(Errors.make(ErrorType.Server, e), res)
  })
})

export default GetItpHistoryRouter


const getValidItpFile = (fileList:ReadedFile[]):ReadedFile => {
  for (let file of fileList) {
    if(file.name === 'go_atomtypes.itp' || file.name === 'go_nbparams.itp')
      continue;
    return file
  }  
  throw("No valid ITP file found");
}