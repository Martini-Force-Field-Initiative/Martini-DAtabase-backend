import { Router } from 'express';
import { sendError } from '../../../helpers/simple';
import HistoryOrganizer from '../../../HistoryOrganizer'
import Errors, { ApiError, ErrorType } from "../../../Errors";
import { ReadedJob } from '../../../Entities/entities/job';
import logger from '../../../logger';
import {inspect} from 'util';

const GetHistoryRouter = Router()

GetHistoryRouter.get('/', async (req, res) => {
  const jobId = req.query.jobId as string;
  
  logger.info(`[router:GetHistoryRouter] handling request for ${jobId}`);
  if (jobId) {
    HistoryOrganizer.getJob(jobId).then(job => {

      const { files, ...jobBase } = job;
      logger.info(`[router:GetHistoryRouter] fetched following jobs files info :\n ${inspect(files)}`);
      logger.info(`[router:GetHistoryRouter] fetched following jobs parameters info :\n ${inspect(jobBase)}`);
      HistoryOrganizer.readFiles(jobId, files).then(readedFiles => {
        const readedJob: ReadedJob = {
          ...jobBase,
          files: readedFiles
        }
        
        res.json(readedJob)
      }).catch(e => {
        logger.error(`[router:GetHistoryRouter] ${e}`);
        if (e === "not_found") sendError(Errors.make(ErrorType.HistoryFilesNotFound), res)
        else sendError(Errors.make(ErrorType.Server, e), res)
      })
    }).catch(e => {     
      if (e === "not_found") sendError(Errors.make(ErrorType.JobNotFound), res)
      else sendError(Errors.make(ErrorType.Server, e), res)
    })
  }
  else sendError(Errors.make(ErrorType.JobNotProvided), res)
})

export default GetHistoryRouter