import { User, StashedMolecule } from "../../Entities/entities";
import { Database } from "../../Entities/CouchHelper";

import Mailer from "../../Mailer/Mailer";

export async function informAdminFromAskCreation(new_user: User) {
  const admins = await Database.user.find({
    selector: { role: "admin" },
    limit: 99999
  });

  const promises: any[] = [];
  for (const admin of admins) {
    // Send a mail
    promises.push(Mailer.send({
      to: admin.email,
      subject: "MArtini Database - New account request",
    }, "mail_ask", {
      new_user: {
        name: new_user.name
      },
      name: admin.name
    }));
  }

  await Promise.all(promises);
}

export async function informAdminFromNewMolecule(new_molecule: StashedMolecule, submitter: User) {
  const admins = await Database.user.find({
    selector: { role: "admin" },
    limit: 99999
  });

  const promises: any[] = [];
  for (const admin of admins) {
    // Send a mail
    promises.push(Mailer.send({
      to: admin.email,
      subject: "MArtini Database - New molecule submitted",
    }, "mail_molecule_submitted", {
      submitter,
      name: admin.name,
      molecule: new_molecule
    }));
  }

  await Promise.all(promises);
}

export async function informAdminContact(content: string, sender: string) {
  const admins = await Database.user.find({
    selector: { role: "admin" },
    limit: 99999
  });

  const promises: any[] = [];
  for (const admin of admins) {
    // Send a mail
    promises.push(Mailer.send({
      to: admin.email,
      subject: "MArtini Database - New question asked from contact page",
    }, "mail_contact", {
      content,
      name: admin.name,
      email: sender
    }));
  }

  await Promise.all(promises);
}
