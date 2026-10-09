import request from "supertest";
import type TestAgent from "supertest/lib/agent";
import type { RoleCode } from "@prisma/client";
import { createApp } from "../../src/app";
import { prisma } from "../../src/lib/prisma";
import { hashPassword } from "../../src/modules/auth/password";
import { drainJobs } from "../../src/jobs/queue";
import "../../src/modules/documents/documents.service";

export const app = createApp();
export const ORIGIN = "http://localhost:3000";
export const PASSWORD = "MotDePasse123";

let phoneCounter = 0;
export function nextPhone() {
  phoneCounter++;
  return `+2376${String(70000000 + phoneCounter).slice(-8)}`;
}

export async function createUser(role: RoleCode = "CUSTOMER", opts: { fullName?: string; delegate?: boolean } = {}) {
  const user = await prisma.user.create({
    data: {
      fullName: opts.fullName ?? `Utilisateur ${role} ${phoneCounter + 1}`,
      phone: nextPhone(),
      email: `u${Date.now()}${Math.random().toString(36).slice(2, 6)}@test.cm`,
      passwordHash: await hashPassword(PASSWORD),
      roleCode: role,
      customerProfile: { create: {} },
      ...(opts.delegate || role === "DELEGATE"
        ? { delegateProfile: { create: { status: "APPROVED", institution: "Université de Yaoundé I", field: "Informatique", level: "L2", className: "L2 Info A" } } }
        : {}),
    },
  });
  return user;
}

export type Agent = TestAgent;

export async function loginAs(role: RoleCode = "CUSTOMER", opts: { fullName?: string; delegate?: boolean } = {}) {
  const user = await createUser(role, opts);
  const agent = request.agent(app);
  const res = await agent.post("/api/auth/login").set("Origin", ORIGIN).send({ identifier: user.phone, password: PASSWORD });
  if (res.status !== 200) throw new Error(`Connexion échouée : ${res.status} ${JSON.stringify(res.body)}`);
  return { user, agent };
}

/** Téléverse un fichier via le flux complet (URL signée + finalisation + analyse asynchrone). */
export async function uploadDocument(agent: Agent, content: Buffer, fileName: string, opts: { analyze?: boolean } = {}) {
  const init = await agent.post("/api/documents/uploads").set("Origin", ORIGIN).send({ fileName, size: content.length });
  if (init.status !== 201) throw new Error(`Demande d'upload échouée : ${init.status} ${JSON.stringify(init.body)}`);
  const url = new URL(init.body.upload.url);
  const up = await request(app).post(url.pathname).attach("file", content, fileName);
  if (up.status !== 204) throw new Error(`Upload échoué : ${up.status} ${JSON.stringify(up.body)}`);
  const done = await agent.post(`/api/documents/${init.body.document.id}/complete`).set("Origin", ORIGIN).send({});
  if (done.status !== 200) throw new Error(`Finalisation échouée : ${done.status}`);
  if (opts.analyze !== false) await drainJobs(["document.analyze"]);
  return prisma.document.findUniqueOrThrow({ where: { id: init.body.document.id } });
}

export const defaultOptions = { colorMode: "BW", sides: "SINGLE", paperFormat: "A4", finishingCode: "NONE", copies: 1 } as const;

export function pickup() {
  return { method: "PICKUP" as const };
}
