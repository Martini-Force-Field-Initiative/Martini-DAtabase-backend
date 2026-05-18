import nodemailer from 'nodemailer';
import { TEMPLATE_DIR, URLS, DEFAULT_MAILER_NAME, DEFAULT_MAILER_ADDRESS, MAILER_ENFORCE_RECIPIENT, MAILER_TRANSPORT_SETTINGS } from '../constants';
import Twig from 'twig';
import logger from '../logger';
import { inspect } from 'util';


export const isTemplateName = (o:any): o is MailTemplateName => {
  if (typeof o !== 'string')
    return false;
  return MAIL_TEMPLATE_NAMES.includes(o);
}

export const MAIL_TEMPLATE_NAMES = [
  "mail_ask" , "mail_changed_password" , 
  "mail_contact" , "mail_created" ,
  "mail_job_completed" , "mail_lost_password" ,
   "mail_molecule_accepted" , "mail_molecule_rejected" ,
  "mail_molecule_submitted" , "mail_rejected"
];
export type MailTemplateName = typeof MAIL_TEMPLATE_NAMES[number];

/*
export type MailTemplateName = "mail_ask" | "mail_changed_password" | "mail_contact" | "mail_created" |
"mail_job_completed" | "mail_lost_password" | "mail_molecule_accepted" | "mail_molecule_rejected" |
"mail_molecule_submitted" | "mail_rejected";
*/

export default new class Mailer {
  protected transporter = nodemailer.createTransport(MAILER_TRANSPORT_SETTINGS);

  public default_sender = { name: DEFAULT_MAILER_NAME, address: DEFAULT_MAILER_ADDRESS };

  async send(send_options: nodemailer.SendMailOptions, template_name: MailTemplateName, options: { [variableName: string]: any }) {
    if (!send_options.to) {
      throw new Error("You must define a mail recipient.");
    }

    if (!options.site_url) {
      options.site_url = URLS.SERVER;
    }
    if (!options.static_site_url) {
      options.static_site_url = URLS.SERVER;
    }
    logger.debug(`[Mailer]Twig options:${inspect(options)}`);
    const file = `${TEMPLATE_DIR }/${template_name}${template_name.endsWith('.twig') ? "" : ".twig"}`;

    const content = await new Promise((resolve, reject) => {
      // @ts-ignore Incorrect typedef for options
      Twig.renderFile(file, options, (err: Error, res: string) => {
        if (err) {
          reject(err);
        }
        resolve(res);
      })
    }) as string;

    send_options.html = content;

    if (!send_options.from) {
      send_options.from = this.default_sender;
      send_options.sender = this.default_sender;
    }
    if (!send_options.subject && options.title) {
      send_options.subject = options.title;
    }

    if (MAILER_ENFORCE_RECIPIENT) {
      send_options.to = MAILER_ENFORCE_RECIPIENT;
    }
    
    return this.mail(send_options);
  }

  protected async mail(options: nodemailer.SendMailOptions) {
    try {
      const info = await this.transporter.sendMail(options);

      logger.debug('Sended email:' + info.messageId);
      return info as { messageId: string };
    } catch (e) {
      logger.error(`[Mailer:mail] Unable to send email with options:\n ${inspect(options)}`);
      logger.error(`[Mailer:mail]${e}`);
      //if(e)
      //  logger.debug(e);
      throw new Error('Unable to send email.');
    }
  }
}();
