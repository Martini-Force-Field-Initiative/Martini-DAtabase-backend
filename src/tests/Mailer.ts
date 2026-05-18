import dotenv from 'dotenv';
const conf = dotenv.config({ path: __dirname + "/../../.env" })
if (conf.error) {
    console.log("Error while loading conf. Verify or create .env file")
    console.log("Stack trace:", 'stack' in conf.error ? conf.error : conf.error)
    process.exit(2)
}
import logger from '../logger';
logger.level = process.env.LOG_LVL as string;
import { expect } from 'chai';

import Mailer from '../Mailer/Mailer';

const TEST_RECIPIENT = "pitooon@gmail.com";

describe(`Test suite:: [Mailer]`, function () {
    this.timeout(20000);
    it('.1 Sending \"mail ask\"', async () => {
        const eOpt = await Mailer.send({
            from : " syslog.biologie@ens-lyon.fr",
            to: TEST_RECIPIENT,
            subject: "MArtini Database - New account request: GLA"
        }, "mail_ask", {
            name: "Administrator",
            title: "New account request for GLA",
            new_user: {
                name: "GLA",
                email: "pitooon@gmail.com",
            },
        });
    });
});
it('.2 Sending \"mail created\"', async () => {
    const eOpt = await Mailer.send({
        from : "syslog.biologie@ens-lyon.fr",
        to: TEST_RECIPIENT,
        subject: "MArtini Database - GLA: Your account has been approved"
    }, "mail_created", {
        title: "GLA: Your account has been approved",
        new_user: {
            name: "GLA",
        },
    });
});
