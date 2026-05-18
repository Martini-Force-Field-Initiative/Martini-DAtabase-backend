import CliHelper, { CliListener } from 'mad-cli';
import Mailer, {MailTemplateName, MAIL_TEMPLATE_NAMES, isTemplateName} from '../Mailer/Mailer';

export const MAIL_CLI = new CliListener(
  CliHelper.formatHelp("mail", {
    commands: {
      "send": `Send email to an arbitrary adress or to registred user or all users using dedicated templates.\nAvailable templates are: ${MAIL_TEMPLATE_NAMES.join(",")}`,
    },
    onNoMatch: "Command is incorrect. Type \"mail\" for help.",
  })
);

MAIL_CLI.command('send', rest => {
  rest = rest.trim();
  const [ mailType, recipient ] = rest.split(/\s+/);

  if (!isTemplateName(mailType))
    return `The desired template "${mailType}" does not exists.`;
  console.log("==>" + mailType);
  switch (mailType) {
    case "mail_create":
      return Mailer.send({ 
        to: recipient, 
        subject: "MArtini Database - John Doe: Your account has been approved" 
      }, mailType as MailTemplateName, { 
        title: "John Doe: Your account has been approved",
        new_user: {
          name: "John Doer",
        },
      });
    case "mail_ask":
      return Mailer.send({ 
        to: recipient, 
        subject: "MArtini Database - New account request: John Doe" 
      }, mailType as MailTemplateName, { 
        name: "Administrator",
        title: "New account request for John Doe",
        new_user: {
          name: "John Doe",
          email: recipient,
        },
      });
  }

  return `Unable to find desired model: \"${mailType}\"`;
}, { onSuggest: () => MAIL_TEMPLATE_NAMES });


export default MAIL_CLI;



/* NOW DEPRECATED AS TEST ARE PERFOMED IN MOCHA
STILL IT IS FOR FUTURE DEVELOPEEMNT TO FEATURE SINGLE THE SENDING OF EMAIL TO SPECIFIC USER */
/*


const TEST_RECIPIENT = "tulouca@gmail.com";

export const MAIL_CLI = new CliListener(
  CliHelper.formatHelp("mail", {
    commands: {
      "test-send": `Send a test mail to ${TEST_RECIPIENT}. Available templates: ${Object.keys(NAME_TO_TEMPLATE)}.`,
    },
    onNoMatch: "Command is incorrect. Type \"mail\" for help.",
  })
);

MAIL_CLI.command('test-send', rest => {
  rest = rest.trim();

  if (!(rest in NAME_TO_TEMPLATE)) {
    return "The desired template does not exists.";
  }

  switch (NAME_TO_TEMPLATE[rest]) {
    case "mail_created":
      return Mailer.send({ 
        to: TEST_RECIPIENT, 
        subject: "MArtini Database - Louis Béranger: Your account has been approved" 
      }, NAME_TO_TEMPLATE[rest], { 
        title: "Louis Béranger: Your account has been approved",
        new_user: {
          name: "Louis Béranger",
        },
      });
    case "mail_ask":
      return Mailer.send({ 
        to: TEST_RECIPIENT, 
        subject: "MArtini Database - New account request: Louis Béranger" 
      }, NAME_TO_TEMPLATE[rest], { 
        name: "Administrator",
        title: "New account request for Louis Béranger",
        new_user: {
          name: "Louis Béranger",
          email: "tulouca@gmail.com",
        },
      });
  }

  return "Unable to find desired model.";
}, { onSuggest: () => Object.keys(NAME_TO_TEMPLATE) });

export default MAIL_CLI;

*/
