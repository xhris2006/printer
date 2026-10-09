import { expect, test } from "@playwright/test";
import { login, makePdf, register, uniquePhone } from "./helpers";

test.describe("Pages publiques", () => {
  test("accueil, tarifs et services", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Imprimez et faites traiter");
    await expect(page.getByText("20 FCFA").first()).toBeVisible();
    await expect(page.getByRole("link", { name: /Assistance WhatsApp|Contacter l'assistance/ })).toHaveAttribute("href", /wa\.me\/237694600007/);
    await page.goto("/tarifs");
    await expect(page.getByText("Simulateur de prix")).toBeVisible();
    await page.goto("/services");
    await expect(page.getByText("Mise en forme de documents")).toBeVisible();
  });

  test("les espaces protégés redirigent vers la connexion", async ({ page }) => {
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/connexion\?next=%2Fadmin/);
  });
});

test.describe("Parcours client complet", () => {
  test("inscription → 2 documents → options → retrait → paiement (simulateur) → suivi", async ({ page }) => {
    const phone = uniquePhone();
    await register(page, "Client E2E", phone);
    await expect(page.getByText("Bonjour,")).toBeVisible();

    await page.goto("/espace/commandes/nouvelle");
    await page.locator('input[type="file"]').first().setInputFiles([
      { name: "cours-algo.pdf", mimeType: "application/pdf", buffer: makePdf(12) },
      { name: "td.pdf", mimeType: "application/pdf", buffer: makePdf(3) },
    ]);
    await expect(page.getByText("12 pages")).toBeVisible();
    await expect(page.getByText("3 pages")).toBeVisible();
    await expect(page.getByText("Analyse terminée")).toHaveCount(2);

    await page.getByRole("button", { name: "Continuer" }).click();
    // Recto verso appliqué à tous : 15 pages × 15 FCFA
    await page.getByRole("radio", { name: /Recto verso/ }).first().click();
    await expect(page.locator("aside").getByText("225 FCFA")).toBeVisible();
    await page.getByRole("button", { name: "Continuer" }).click();

    await expect(page.getByText("Centre de santé de Mvam-essakoe").first()).toBeVisible();
    await page.getByRole("button", { name: "Voir le récapitulatif" }).click();
    await expect(page.getByText("4. Récapitulatif")).toBeVisible();
    await page.getByRole("button", { name: "Confirmer la commande" }).click();
    await expect(page.getByRole("heading", { name: /Commande PS-.* enregistrée/ })).toBeVisible();

    await page.getByRole("button", { name: /Payer 225 FCFA/ }).click();
    await expect(page).toHaveURL(/\/paiement\/simulateur/);
    await page.getByRole("button", { name: "Simuler un paiement réussi" }).click();
    await expect(page.getByText("Commande envoyée !")).toBeVisible();
    await page.getByRole("link", { name: "Voir ma commande" }).click();
    await expect(page.getByText("Code de retrait")).toBeVisible();
    await expect(page.getByText("Paiement confirmé").first()).toBeVisible();
  });

  test("refuse un fichier au format non accepté", async ({ page }) => {
    await register(page, "Client Format", uniquePhone());
    await page.goto("/espace/commandes/nouvelle");
    await page.locator('input[type="file"]').first().setInputFiles({ name: "virus.exe", mimeType: "application/octet-stream", buffer: Buffer.from("MZ") });
    await expect(page.getByText("Format non accepté")).toBeVisible();
    await expect(page.getByRole("button", { name: "Continuer" })).toBeDisabled();
  });
});

test.describe("Administration", () => {
  test.skip(!process.env.E2E_ADMIN_PHONE || !process.env.E2E_ADMIN_PASSWORD, "Identifiants administrateur E2E non fournis");

  test("toutes les pages d'administration se chargent", async ({ page }) => {
    await login(page, process.env.E2E_ADMIN_PHONE as string, process.env.E2E_ADMIN_PASSWORD as string);
    await expect(page).toHaveURL(/\/admin/);
    for (const [path, heading] of [
      ["/admin", "Tableau de bord"],
      ["/admin/production", "Production"],
      ["/admin/commandes", "Commandes"],
      ["/admin/groupes", "Commandes groupées"],
      ["/admin/paiements", "Paiements"],
      ["/admin/devis", "Devis"],
      ["/admin/utilisateurs", "Utilisateurs"],
      ["/admin/tarifs", "Tarifs"],
      ["/admin/livraison", "Retrait & livraison"],
      ["/admin/parametres", "Paramètres"],
      ["/admin/audit", "Journal d'audit"],
    ]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
      await expect(page.getByText("Une erreur est survenue")).toHaveCount(0);
    }
  });

  test("lance en production une commande payée depuis la file de production", async ({ page }) => {
    await login(page, process.env.E2E_ADMIN_PHONE as string, process.env.E2E_ADMIN_PASSWORD as string);
    await page.goto("/admin/production");
    await expect(page.getByText("À lancer").or(page.getByText("Aucune commande en production"))).toBeVisible();
    const launch = page.getByRole("button", { name: "Lancer la préparation" }).first();
    if ((await launch.count()) === 0) test.skip(true, "Aucune commande payée à lancer");
    await launch.click();
    await expect(page.getByText(/: À préparer/)).toBeVisible();
  });
});

test.describe("Délégué de classe", () => {
  test.skip(!process.env.E2E_ADMIN_PHONE || !process.env.E2E_ADMIN_PASSWORD, "Identifiants administrateur E2E non fournis");

  test("demande d'espace délégué → validation admin → création d'un lot avec lien de collecte", async ({ browser }) => {
    const delegateCtx = await browser.newContext();
    const delegate = await delegateCtx.newPage();
    const phone = uniquePhone();
    await register(delegate, "Déléguée E2E", phone);
    await delegate.goto("/espace/delegue");
    await delegate.getByLabel("Établissement").fill("Université de Yaoundé I");
    await delegate.getByLabel("Filière").fill("Informatique");
    await delegate.getByLabel("Niveau").fill("L2");
    await delegate.getByLabel("Classe").fill("L2 Info A");
    await delegate.getByRole("button", { name: "Envoyer ma demande" }).click();
    await expect(delegate.getByText("Demande en cours d'examen")).toBeVisible();

    const adminCtx = await browser.newContext();
    const admin = await adminCtx.newPage();
    await login(admin, process.env.E2E_ADMIN_PHONE as string, process.env.E2E_ADMIN_PASSWORD as string);
    await admin.goto("/admin/utilisateurs?delegateStatus=PENDING");
    const row = admin.getByRole("row", { name: /Déléguée E2E/ }).first();
    await row.getByRole("button", { name: "Approuver" }).click();
    await admin.getByRole("button", { name: "Valider" }).click();
    await expect(admin.getByText("Décision enregistrée.")).toBeVisible();

    await delegate.goto("/espace/delegue/groupes/nouveau");
    await delegate.getByLabel("Nom du lot").fill("Fascicules E2E");
    await delegate.getByRole("button", { name: "Créer le lot" }).click();
    await expect(delegate.getByRole("heading", { name: "Lien de collecte" })).toBeVisible();
    const link = await delegate.getByLabel("Lien de collecte").inputValue();
    expect(link).toMatch(/\/g\/[\w-]{20,}/);

    const studentCtx = await browser.newContext();
    const student = await studentCtx.newPage();
    await student.goto(link);
    await expect(student.getByText("Fascicules E2E")).toBeVisible();
    await expect(student.getByText("Collecte ouverte")).toBeVisible();
    await Promise.all([delegateCtx.close(), adminCtx.close(), studentCtx.close()]);
  });
});
