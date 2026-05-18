import { inspect } from 'util';
import logger from '../../../logger';


// WARNING - general - Missing link between residue 1 SER and residue 4 SER

interface ErrorToClient {
    boxerror: boolean;
    ok: boolean,
    disjoint: boolean,
    errorlinks: any[],
    message: string[],
    itp? : string,
}


export default checkError;

function checkError(output: string):ErrorToClient {
    logger.debug(`[PolymerGenerator:errorParser:checkError] input is ${output}`)
    //Init dico error
    let dicErreur: ErrorToClient = { boxerror: false, ok: true, disjoint: false, message: [], errorlinks: [] }
    let pythonerror: boolean = false
    let oserror: boolean = false
    //Parse every line 
    for (let l of output.split('\n')) {
        logger.error(`[polymerGenerator:ErrorParser] line content\n${l}`);

        if (l == '') continue

        if (pythonerror === true) {
            dicErreur.message.push(l)
        }

        if (oserror === true) {
            dicErreur.message.push(l)
        }

        if ((l.includes('Traceback (most recent call last):'))) {
            logger.debug("error disconnected parts", l)
            dicErreur.ok = false
            pythonerror = true
        }

        if ((l.includes('Some input data are greater than the size of the periodic box'))) {
            logger.debug("Box size problem", l)
            dicErreur.ok = false
            dicErreur.boxerror = true
        }
        if (l.includes('Make sure all coordiantes are wrapped inside the box')) {
            logger.debug("Box size problem", l)
            dicErreur.ok = false
            dicErreur.boxerror = true
        }
        if ((l.includes('disconnected parts. ')) || (l.includes('disjoint parts'))) {
            logger.debug("error disconnected parts", l)
            dicErreur.disjoint = true
            dicErreur.ok = false
        }

        if ((l.includes('unrecognized arguments'))) {
            logger.debug("unrecognized arguments", l)
            dicErreur.message.push(l)
            dicErreur.ok = false
        }

        if (l.includes('disjoint parts')) {
            logger.debug("error disjoint parts", l)
            dicErreur.disjoint = true
            dicErreur.ok = false
        }
        // WARNING - general - Missing link between residue 1 SER and residue 4 SER

        if (l.includes('Missing a link')) {
            l =  l.replace(/^.+Missing a link between[\s]+/, '')
            // Adding this
            l = l.replace(/\.$/, '');
            dicErreur.ok = false;
            logger.error(`[PolymerGenerator:checkError] \"Missing link\" line detected:${l}`);
            let splitline = l.split(' ')
            logger.debug(`[PolymerGenerator:checkError] parsed buffer: ${splitline}`);
            
            let resname1 = splitline[2] //9
            let idname1 = parseInt(splitline[1]) - 1 //[8]
            
            let resname2 = splitline[6] // 14
            let idname2 = parseInt(splitline[5]) - 1 //[12]
            dicErreur.errorlinks.push([resname1, idname1, resname2, idname2])
            logger.debug(`[PolymerGenerator:checkError] parsed elemnts {resname1, idname1, resname2, idname2}: { ${resname1}, ${idname1}, ${resname2}, ${idname2}} `);
        }

        if (l.includes('OSError:')) {
            dicErreur.ok = false
            dicErreur.message.push(l)
            oserror = true
        } else if( l.includes("JobStderrNotEmptyFS:") ) {
            dicErreur.ok = false
            dicErreur.message.push(l)
        }

    }
    return dicErreur
}
