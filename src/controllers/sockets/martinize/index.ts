import { promises as FsPromise } from 'fs';
import TmpDirHelper from '../../../TmpDirHelper';
import HistoryOrganizer from "../../../HistoryOrganizer";
import {  URLS } from '../../../constants';

import { plainToInstance } from 'class-transformer';
import { validateOrReject } from 'class-validator';

import { ClientSettingsMartinize } from '../../dto/molecule.dto';
import { ClientSettings } from '../../common/martinize';
import Errors, { ErrorType, ApiError } from '../../../Errors';
import logger from '../../../logger';
import { MartinizeSettings, Martinizer } from '../../../Builders/Martinizer';
import path from 'path';
import { inspect } from 'util';
import { Database } from '../../../Entities/CouchHelper';

import Mailer from '../../../Mailer/Mailer';
import { SocketController, ListenTo, Socket, SocketControllerRegister } from 'socket-controller-rdy';

type MartinizeRunFailedPayload = {
    error: string,
    type: string,
    stdout?: string,
    stderr?: string,
    items: string[],
    code: ErrorType,
    message: string,
    dir: any
};

async function sendMailMartinizeEnd(userId: string, jobId: string) {
    logger.debug(`[socket:martinize:sendMailMartinizeEnd] userId:'${userId}' jobId:'${jobId}'`);
    const user = await Database.user.get(userId);
    logger.debug(`Send an email to ${user.email} for job completion`)
    logger.debug(`[socket:martinize:sendMailMartinizeEnd] Generating this url: ${URLS.SERVER + '/builder/' + jobId}`)
    Mailer.send({
      to: user.email,
      subject: "MArtini Database - Job completed"
    },
      "mail_job_completed", {
      name: user.name,
      job_id: jobId,
      job_url: URLS.SERVER + '/builder/' + jobId
    }).catch(logger.error)
  }

  async function martinizeRun(parameters: ClientSettingsMartinize, pdb_path: string, path: string, onStep?: (step: string, ...data: any[]) => void) {
  
    logger.debug(`[ROUTE:MOLECULE::MARTINIZE] martinizeRun parameters\n${inspect(parameters)}\npdb_path: ${pdb_path}\npath: ${path}`);
    const martinizeSettings: MartinizeSettings = Object.assign({}, {
      input: pdb_path,
      ff: 'martini22',
      position: 'none',
      commandline: ''
    }, parameters);
  
    try {
      const { pdb, itps, top, warns, jobId, elastic_bonds, final_gro } = await Martinizer.run(martinizeSettings, path, onStep );
  
      return {
        pdb,
        itps,
        top,
        warns,
        jobId,
        elastic_bonds,
        final_gro
      };
    } catch (e) {
      logger.error(`[ROUTE:MOLECULE::MARTINIZE]Error:\n${e}`);
      if (e instanceof ApiError) {
        logger.error("Martinize Error.");
        logger.error(e.stack!);
  
        throw e;
      }
      if (e instanceof Error && e.stack?.startsWith('Error: Command failed')) {
        logger.error("Martinize Error.");
        logger.error(e.stack);
  
        return Errors.throw(ErrorType.MartinizeRunFailed);
      }
  
      // If any matches
      throw e;
    }
  }

@SocketControllerRegister
export class Martinize extends SocketController {

  @ListenTo('martinize end')
  async martinize(file: Buffer, run_id: string, settings: ClientSettings, socket:Socket) {
    function sendFile(path: string, infos: { id?: string, name: string, type: string, mol_idx?: number }) {
      return new Promise(async (resolve, reject) => {
        const timeout = setTimeout(reject, 1000 * 60 * 60);
        infos.id = run_id;
        socket.emit(
          'martinize download',
          infos,
          await FsPromise.readFile(path),
          () => {
            clearTimeout(timeout);
            resolve();
          }
        );
      }) as Promise<void>;
    }
    const rootOutputName =  `${
                            settings.pdb_name ? 
                            path.basename(settings.pdb_name, path.extname(settings.pdb_name))
                            : "structure"
                            }_CG`;

    if (!run_id || !file || !settings || !settings.user_id)
      return;
    if (run_id.length > 64)
      return;
    
      const tmp_dir = await TmpDirHelper.get();
      const INPUT = `${tmp_dir}/input.pdb`
      try {
        const validatedParams = plainToInstance(ClientSettingsMartinize, settings)
        try {
          await validateOrReject(validatedParams)
        } catch (e) {
          throw new Error(e as any);
        }
  
        logger.debug(`[SOCKET::MARTINIZE] save input to ${tmp_dir}`)
  
        await FsPromise.writeFile(INPUT, file);
        
        logger.debug(`[SOCKET::MARTINIZE] save successfull calling \"martinizeRun\"`);
    
        const { pdb, itps, top, warns, jobId, elastic_bonds, final_gro } = await martinizeRun(
          validatedParams,
          INPUT,
          tmp_dir,
          (step, ...data) => {
            socket.emit('martinize step', {
              id: run_id,
              step,
              data,
            });
          },
          
        );

        await sendFile(top, {
          name: rootOutputName + ".top", //path.basename(top),
          type: 'chemical/x-topology'
        });
  
        await sendFile(pdb, {
          name: rootOutputName + ".pdb", //path.basename(pdb),
          type: 'chemical/x-pdb'
        });
  
        if(final_gro) {
          await sendFile(final_gro, {
            name : rootOutputName + ".gro", //path.basename(final_gro),
            type : 'chemical/x-gro'
          }) 
        }
        
        
        for (const [mol, itp_files] of itps.entries()) {
          for (const itp of itp_files) {
              await sendFile(itp, {
                name: path.basename(itp),
                type: 'chemical/x-include-topology',
                mol_idx: mol
              });
          }
        }
  
        await sendFile(warns, {
          name: path.basename(warns),
          type: 'martinize-warnings'
        });
  
        socket.emit('martinize before end', { id: run_id });

        let savedToHistory = false;
        const userId =  validatedParams.user_id;
        let radius;
        try {
          const fileBundle = {
            all_atom: INPUT,
            coarse_grained: pdb,
            itp_files: itps,//.flat(),
            top_file: top,
            warnings: warns,
            gro : final_gro ?? undefined
          };
          //await HistoryOrganizer.saveToHistory(job, [INPUT, top, pdb, ...itps.flat(), warns, final_gro!])
            await HistoryOrganizer.save( { files : fileBundle, 
            jobId: jobId,
            userId: userId,
            type: "martinize",
            settings: validatedParams,
            name: validatedParams.pdb_name as string
            }
          );
          savedToHistory = true;
        } catch (e) {
          logger.warn("[SOCKET::MARTINIZE] error save to history", e)
        }
  
        finally {
          
          if (validatedParams.send_mail && userId){
            logger.debug(`[SOCKET:martinize]success sending email to ${userId}`)
            sendMailMartinizeEnd(userId, jobId);
          } 
          const radius = await Database.job.getJobRadius(jobId);
          // successfull run
          return ({ id: run_id, elastic_bonds, radius, savedToHistory, jobId });
        }
  
  
      } catch (e:any) {
        // Error catch, test the error :D
        logger.error(`[SOCKET::MARTINIZE] Error:\n${e}`);
        if (e instanceof ApiError) {
          if (e.code === ErrorType.MartinizeRunFailed) {
            const { error, type, dir } = e.data as MartinizeRunFailedPayload;
            logger.error(`[SOCKET::MARTINIZE] Error:\n${error} ${type}`);
  
            // Compress the directory
            //const compressed_run = await Martinizer.zipDirectory(dir);
  
            const chunksArray: Uint8Array[] = [];
            dir.on('data', (chunk: Uint8Array) => {
              chunksArray.push(chunk)
            })
            dir.on('end', () => {
              const chunkArray = Buffer.concat(chunksArray)
              socket.emit('martinize error', {
                id: run_id,
                error,
                type,
                stack: e.stack,
              }, chunkArray);
            })
  
            
          }
          else {
            const { error } = e.data
            socket.emit('martinize error', {
              id: run_id,
              error,
              stack: e.stack
            })
          }
        }
  
  
        else {
          socket.emit('martinize error', {
            id: run_id,
            error: e instanceof Error ? e.message : String(e),
            stack: e instanceof Error ? e.stack : "",
          });
        }
      } finally {
        await FsPromise.unlink(INPUT);
      } 
  }
}

/*
export function SocketIoMartinizer(socket: SocketIo.Socket) {
    //socket.emit('martinizeVersion', version);
    logger.debug("[ROUTE:SOCKET_IO::MARTINIZE] Running SocketIoMartinizer ...");
    socket.on('martinize', async (file: Buffer, run_id: string, settings: ClientSettings) => {
      function sendFile(path: string, infos: { id?: string, name: string, type: string, mol_idx?: number }) {
        return new Promise(async (resolve, reject) => {
          const timeout = setTimeout(reject, 1000 * 60 * 60);
          infos.id = run_id;
          socket.emit(
            'martinize download',
            infos,
            await FsPromise.readFile(path),
            () => {
              clearTimeout(timeout);
              resolve();
            }
          );
        }) as Promise<void>;
      }
  
      if (!run_id || !file || !settings || !settings.user_id) {
        return;
      }
      if (run_id.length > 64) {
        return;
      }
  
      // // Verify token
      // try {
      //   await validateToken(token);
      // } catch {
      //   socket.emit('martinize error', { id: run_id, message: 'Invalid token.' });
      //   return;
      // }
  
      // Save to a temporary directory
  
      //SECURITY : CHECK PDB CONTENT BEFORE WRITE
  
      const tmp_dir = await TmpDirHelper.get();
      const INPUT = `${tmp_dir}/input.pdb`
      try {
        const validatedParams = plainToInstance(ClientSettingsMartinize, settings)
        try {
          await validateOrReject(validatedParams)
        } catch (e) {
          throw new Error(e as any);
        }
  
        logger.debug(`[ROUTE:SOCKET_IO::MARTINIZE] save input to ${tmp_dir}`)
  
        await FsPromise.writeFile(INPUT, file);
  
        logger.debug(`[ROUTE:MOLECULE::MARTINIZE] save successfull calling \"martinizeRun\"`);
    
        const { pdb, itps, top, warns, jobId, elastic_bonds, final_gro } = await martinizeRun(
          validatedParams,
          INPUT,
          tmp_dir,
          (step, ...data) => {
            socket.emit('martinize step', {
              id: run_id,
              step,
              data,
            });
          },
          
        );
  
  
        await sendFile(top, {
          name: path.basename(top),
          type: 'chemical/x-topology'
        });
  
        await sendFile(pdb, {
          name: path.basename(pdb),
          type: 'chemical/x-pdb'
        });
  
        if(final_gro) {
          await sendFile(final_gro, {
            name : path.basename(final_gro),
            type : 'chemical/x-gro'
          }) 
        }
        
  
        for (const [mol, itp_files] of itps.entries()) {
          for (const itp of itp_files) {
            await sendFile(itp, {
              name: path.basename(itp),
              type: 'chemical/x-include-topology',
              mol_idx: mol
            });
          }
  
        }
  
        await sendFile(warns, {
          name: path.basename(warns),
          type: 'martinize-warnings'
        });
  
        socket.emit('martinize before end', { id: run_id });
        const flatItps = itps.flat()
        const radius = await Database.radius.getRadius(
          validatedParams.ff || 'martini22',
          flatItps
        );
  
  
        const job: MartinizeJobToSave = {
          jobId: jobId,
          userId: validatedParams.user_id,
          type: "martinize",
          date: dateFormatter("Y-m-d H:i"),
          files: {
            all_atom: path.basename(INPUT),
            coarse_grained: path.basename(pdb),
            itp_files: itps.map(mol_itps => mol_itps.map(itp => path.basename(itp))),
            top_file: path.basename(top),
            warnings: path.basename(warns),
            gro : final_gro ? path.basename(final_gro) : undefined
          },
          settings: validatedParams, //To avoid class into class that create conflicts for plainToInstance later (why ??)
          radius,
          name: validatedParams.pdb_name
        }
  
        let savedToHistory = false;
        try {
          await HistoryOrganizer.saveToHistory(job, [INPUT, top, pdb, ...itps.flat(), warns, final_gro!])
          savedToHistory = true;
        } catch (e) {
          logger.warn("[ROUTE:SOCKET_IO::MARTINIZE] error save to history", e)
        }
  
        finally {
  
          socket.emit('martinize end', { id: run_id, elastic_bonds, radius, savedToHistory, jobId: job.jobId });
  
          if (validatedParams.send_mail && job.userId) sendMailMartinizeEnd(job.userId, job.jobId);
        }
  
  
      } catch (e:any) {
        // Error catch, test the error :D
        logger.error(`[ROUTE:SOCKET_IO::MARTINIZE] Error:\n${e}`);
        if (e instanceof ApiError) {
          if (e.code === ErrorType.MartinizeRunFailed) {
            const { error, type, dir } = e.data as MartinizeRunFailedPayload;
            logger.error(`[ROUTE:SOCKET_IO::MARTINIZE] Error:\n${error} ${type}`);
  
            // Compress the directory
            //const compressed_run = await Martinizer.zipDirectory(dir);
  
            const chunksArray: Uint8Array[] = [];
            dir.on('data', (chunk: Uint8Array) => {
              chunksArray.push(chunk)
            })
            dir.on('end', () => {
              const chunkArray = Buffer.concat(chunksArray)
              socket.emit('martinize error', {
                id: run_id,
                error,
                type,
                stack: e.stack,
              }, chunkArray);
            })
  
            
          }
          else {
            const { error } = e.data
            socket.emit('martinize error', {
              id: run_id,
              error,
              stack: e.stack
            })
          }
        }
  
  
        else {
          socket.emit('martinize error', {
            id: run_id,
            error: e instanceof Error ? e.message : String(e),
            stack: e instanceof Error ? e.stack : "",
          });
        }
      } finally {
        await FsPromise.unlink(INPUT);
      }
    });
  }
  */