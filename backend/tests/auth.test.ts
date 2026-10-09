import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { prisma } from "../src/lib/prisma";
import { resetDb } from "./helpers/db";
import { createPasswordResetToken } from "../src/modules/auth/auth.service";
import { app, ORIGIN } from "./helpers/api";

beforeEach(resetDb);

describe("Authentification", () => {
  it("inscription, session httpOnly, profil puis déconnexion", async () => {
    const agent = request.agent(app);
    const reg = await agent.post("/api/auth/register").set("Origin", ORIGIN).send({ fullName: "Rebero Dior", phone: "6 94 60 00 07", email: "Rebero@Example.cm", password: "Secret2026" });
    expect(reg.status).toBe(201);
    expect(reg.body.user).toMatchObject({ phone: "+237694600007", email: "rebero@example.cm", role: "CUSTOMER" });
    expect(reg.body.user).not.toHaveProperty("passwordHash");
    const cookie = String(reg.headers["set-cookie"]);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");

    const stored = await prisma.user.findUniqueOrThrow({ where: { phone: "+237694600007" } });
    expect(stored.passwordHash.startsWith("$argon2id$")).toBe(true);

    expect((await agent.get("/api/auth/me")).body.user.fullName).toBe("Rebero Dior");
    await agent.post("/api/auth/logout").set("Origin", ORIGIN).send({});
    expect((await agent.get("/api/auth/me")).body.user).toBeNull();
  });

  it("connexion par téléphone ou email ; message identique en cas d'échec", async () => {
    await request(app).post("/api/auth/register").set("Origin", ORIGIN).send({ fullName: "Awa", phone: "677000001", email: "awa@test.cm", password: "Secret2026" });
    expect((await request(app).post("/api/auth/login").set("Origin", ORIGIN).send({ identifier: "awa@test.cm", password: "Secret2026" })).status).toBe(200);
    expect((await request(app).post("/api/auth/login").set("Origin", ORIGIN).send({ identifier: "+237677000001", password: "Secret2026" })).status).toBe(200);
    const bad = await request(app).post("/api/auth/login").set("Origin", ORIGIN).send({ identifier: "awa@test.cm", password: "mauvais" });
    const unknown = await request(app).post("/api/auth/login").set("Origin", ORIGIN).send({ identifier: "inconnu@test.cm", password: "mauvais" });
    expect(bad.status).toBe(401);
    expect(unknown.body.error.message).toBe(bad.body.error.message);
  });

  it("valide les données (téléphone camerounais, mot de passe robuste) et refuse les doublons", async () => {
    const weak = await request(app).post("/api/auth/register").set("Origin", ORIGIN).send({ fullName: "X", phone: "12345", password: "abc" });
    expect(weak.status).toBe(400);
    expect(weak.body.error.code).toBe("VALIDATION_ERROR");
    await request(app).post("/api/auth/register").set("Origin", ORIGIN).send({ fullName: "Awa", phone: "677000001", password: "Secret2026" });
    const dup = await request(app).post("/api/auth/register").set("Origin", ORIGIN).send({ fullName: "Awa 2", phone: "+237 677 00 00 01", password: "Secret2026" });
    expect(dup.status).toBe(409);
  });

  it("un compte désactivé ne peut plus se connecter", async () => {
    await request(app).post("/api/auth/register").set("Origin", ORIGIN).send({ fullName: "Awa", phone: "677000001", password: "Secret2026" });
    await prisma.user.update({ where: { phone: "+237677000001" }, data: { isActive: false } });
    expect((await request(app).post("/api/auth/login").set("Origin", ORIGIN).send({ identifier: "677000001", password: "Secret2026" })).status).toBe(401);
  });

  it("réinitialisation du mot de passe par lien à usage unique", async () => {
    await request(app).post("/api/auth/register").set("Origin", ORIGIN).send({ fullName: "Awa", phone: "677000001", password: "Secret2026" });
    const user = await prisma.user.findUniqueOrThrow({ where: { phone: "+237677000001" } });
    const token = await createPasswordResetToken(user.id);
    expect((await request(app).post("/api/auth/reset-password").set("Origin", ORIGIN).send({ token, password: "Nouveau2026" })).status).toBe(200);
    expect((await request(app).post("/api/auth/reset-password").set("Origin", ORIGIN).send({ token, password: "Encore2026" })).status).toBe(400);
    expect((await request(app).post("/api/auth/login").set("Origin", ORIGIN).send({ identifier: "677000001", password: "Nouveau2026" })).status).toBe(200);
  });
});
