
import { Router } from 'express'; 
import HistoryOrganizer from '../../../HistoryOrganizer'
import { errorCatcher, sendError } from '../../../helpers/simple'
import Errors, { ApiError, ErrorType } from "../../../Errors";
import logger from '../../../logger';
import { inspect } from 'util';

const ListHistoryRouter = Router(); 

ListHistoryRouter.get('/', async (req, res) => {
    logger.info("[Router:history::list] handling request.");
    const user = req.query?.user; 
    if(user) {
        try {
        const jobs = await HistoryOrganizer.getHistory(user as string);      
        res.json(jobs.reverse());
        } catch(e:any){
            logger.error(`[Router:history::list] Error while get user history : ${e}`);
            if (e.error && e.error === "not_found") 
                sendError(Errors.make(ErrorType.HistoryNotFound), res);
            else 
                sendError(Errors.make(ErrorType.Server), res);            
        }
    }
    else {
        logger.error(`[Router:history::list] UserNotProvided , \"req.user?.user_id\" missing from\n${inspect(req)}`);
        sendError(Errors.make(ErrorType.UserNotProvided), res)
    }
        
})

export default ListHistoryRouter