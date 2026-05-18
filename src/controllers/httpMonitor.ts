import {Server, IncomingMessage, ServerResponse} from 'http'; 
import { Logger, createLogger, transports } from 'winston';
import /*logger, */{ FORMAT_FILE } from '../logger';
import {inspect} from 'util';

export const HTTP_trace = (server:Server<typeof IncomingMessage, typeof ServerResponse>, 
    logFilePath:string) => {

    const HTTP_logger = createLogger({
        transports: [
        new transports.File({
        filename: logFilePath,
        level: 'info',
        eol: "\n",
        format: FORMAT_FILE
        })]
    });

    server.on('request', (request, response) => {
        const socket = request.socket;

        let body:any = [];
        request.on('data', (chunk) => {
            body.push(chunk);
        }).on('end', () => {
            body = Buffer.concat(body).toString();
            HTTP_logger.info(`${request.method} ${request.url} ${socket.remoteAddress} ${socket.remotePort} ${socket.remoteFamily}\nHEADERS ${inspect(request.headers)}\nBODY \"${body}"`);
         });

    });

    /*server.on('connection', (stream) => {
//        HTTP_logger.info(`###${inspect(stream)}`);
        HTTP_logger.info(`###${stream.remoteAddress} ${stream.remotePort} ${stream.remoteFamily}`);
    })
*/
    /*
    server.on('request', (request, response) => {
        let body:any = [];
        request.on('data', (chunk) => {
            body.push(chunk);
        }).on('end', () => {
            body = Buffer.concat(body).toString();
    
        HTTP_logger.info(`==== ${request.method} ${request.url}`);
        HTTP_logger.info('> Headers');
        HTTP_logger.info(inspect(request.headers));
        HTTP_logger.info('> Connection');
        HTTP_logger.info(inspect(request.socket));
        HTTP_logger.info('> Remote address');
        HTTP_logger.info(inspect(request.socket.remoteAddress));
        HTTP_logger.info('> Body');
        HTTP_logger.info( inspect(body) );
        //response.end();
        });
    })
    */
};
