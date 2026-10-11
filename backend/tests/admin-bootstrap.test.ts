import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { prisma } from "../src/lib/prisma";
import { ensureEnvAdmin } from "../src/modules/auth/admin-bootstrap";
import { resetDb } from "./helpers/db";
import { app, ORIGIN } from "./helpers/api";

beforeEach(resetDb);

const config = { phone: "6 94 60 00 07", fullName: "Admin Principal", password: "AdminSecret2026", email: "Admin@Print.cm" };

describe("Administrateur défini par les variables d'environnement", () => {
  it("crée le compte au premier démarrage puis permet la connexion avec le numéro et le mot de passe", async () => {
    const first = await ensureEnvAdmin(config);
    expect(first.status).toBe("created");
    const user = await prisma.user.findUniqueOrThrow({ where: { phone: "+237694600007" } });
    expect(user).toMatchObject({ fullName: "Admin Principal", roleCode: "ADMIN", email: "admin@print.cm", isActive: true });
    expect(user.passwordHash).not.toContain("AdminSecret2026");

    const login = await request(app).post("/api/auth/login").set("Origin", ORIGIN).send({ identifier: "694600007", password: "AdminSecret2026" });
    expect(login.status).toBe(200);
    expect(login.body.user.role).toBe("ADMIN");

    expect((await ensureEnvAdmin(config)).status).toBe("unchanged");
  });

  it("synchronise le nom, le rôle, l'activation et le mot de passe quand les variables changent", async () => {
    await prisma.user.create({
      data: { fullName: "Ancien Nom", phone: "+237694600007", passwordHash: "x", roleCode: "CUSTOMER", isActive: false },
    });
    const result = await ensureEnvAdmin({ ...config, fullName: "Nouveau Nom", password: "NouveauMdp2026" });
    expect(result.status).toBe("updated");
    if (result.status === "updated") expect(result.changes).toEqual(expect.arrayContaining(["rôle", "réactivation", "nom", "mot de passe"]));
    const user = await prisma.user.findUniqueOrThrow({ where: { phone: "+237694600007" } });
    expect(user).toMatchObject({ fullName: "Nouveau Nom", roleCode: "ADMIN", isActive: true });
    const login = await request(app).post("/api/auth/login").set("Origin", ORIGIN).send({ identifier: "+237694600007", password: "NouveauMdp2026" });
    expect(login.status).toBe(200);
    expect(await prisma.auditLog.count({ where: { action: "user.admin_env_synced" } })).toBe(1);
  });

  it("ne fait rien sans configuration", async () => {
    expect((await ensureEnvAdmin(null)).status).toBe("skipped");
    expect(await prisma.user.count()).toBe(0);
  });
});
