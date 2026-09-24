import { test, expect, type Locator, type Page, type Route } from "@playwright/test";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, cp, mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, extname } from "node:path";
const passphrase = "Exemple-test-Finance-2026"; // Synthetic test credential; never used for a real vault.
test("private vault: account, dated balance, operation, lock, wrong password, reload", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Créer mon espace privé" }),
  ).toBeVisible();
  await page.getByLabel("Phrase secrète", { exact: true }).fill(passphrase);
  await page.getByLabel("Confirmer la phrase secrète").fill(passphrase);
  await page.getByRole("button", { name: "Créer mon coffre" }).click();
  await page
    .getByRole("navigation", { name: "Navigation principale", exact: true })
    .getByRole("button", { name: "Mes comptes", exact: true })
    .click();
  await page.getByRole("button", { name: "Ajouter", exact: true }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("Nom du compte").fill("Banque exemple test");
  await dialog.getByLabel("Établissement").fill("Banque Fictive");
  await dialog
    .getByRole("button", { name: "Enregistrer", exact: true })
    .click();
  await expect(
    page.getByText("Banque exemple test", { exact: true }),
  ).toBeVisible();
  // A compact row: a tap opens its detail, where « Actualiser » lives.
  const accountRow = page.locator(".account-row", { hasText: "Banque exemple test" });
  await accountRow.click();
  await page
    .getByRole("button", { name: "Actualiser le solde de Banque exemple test", exact: true })
    .click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Nouveau solde").fill("1234.56");
  await dialog
    .getByRole("button", { name: "Enregistrer", exact: true })
    .click();
  await expect(accountRow.locator(".row-value")).toHaveText(/^1\s?234\.56\s*CHF$/);
  await page
    .getByRole("navigation", { name: "Navigation principale", exact: true })
    .getByRole("button", { name: "Mon mois", exact: true })
    .click();
  await page.getByRole("button", { name: "Ajouter", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Libellé").fill("Dépense synthétique");
  await dialog.getByLabel("Montant", { exact: true }).fill("42.10");
  await dialog
    .getByLabel("Compte", { exact: true })
    .selectOption({ label: "Banque exemple test · CHF" });
  await dialog
    .getByRole("button", { name: "Enregistrer", exact: true })
    .click();
  await expect(
    page.getByText("Dépense synthétique", { exact: true }),
  ).toBeVisible();
  const storage = await page.evaluate(() =>
    Object.values(localStorage).join(""),
  );
  expect(storage).not.toContain("Banque exemple test");
  expect(storage).not.toContain("Dépense synthétique");
  await page
    .getByRole("button", { name: "Verrouiller l’espace", exact: true })
    .click();
  await expect(page.getByText("Banque exemple test")).toHaveCount(0);
  await page
    .getByLabel("Phrase secrète", { exact: true })
    .fill("phrase-incorrecte");
  await page
    .getByRole("button", { name: "Déverrouiller", exact: true })
    .click();
  await expect(page.getByRole("alert")).toBeVisible();
  await page.getByLabel("Phrase secrète", { exact: true }).fill(passphrase);
  await page
    .getByRole("button", { name: "Déverrouiller", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Mon mois", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Ouvrir mon espace" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
test("real rendered demo screenshots at desktop, tablet and mobile; pages, privacy and overflow", async ({
  page,
}) => {
  await mkdir("docs/captures", { recursive: true });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Voir la démonstration" }),
  ).toBeVisible();
  await page.screenshot({
    path: "docs/captures/01-coffre-desktop.png",
    fullPage: true,
  });
  // Écran du coffre : aucun débordement horizontal sur ordinateur ni sur tablette.
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 834, height: 1112 },
  ]) {
    await page.setViewportSize(viewport);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "Voir la démonstration" }).click();
  await expect(
    page.getByText(
      "Démonstration · Tous les montants et établissements sont fictifs.",
    ),
  ).toBeVisible();
  await page.screenshot({
    path: "docs/captures/02-finance-desktop.png",
    fullPage: true,
  });
  for (const name of [
    "Mon mois",
    "Mes comptes",
    "Épargne et projets",
    "Investissements",
    "Documents et réglages",
  ]) {
    await page
      .getByRole("navigation", { name: "Navigation principale", exact: true })
      .getByRole("button", { name, exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name, exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page
    .getByRole("navigation", { name: "Navigation principale", exact: true })
    .getByRole("button", { name: "Vue d’ensemble" })
    .click();
  await page.getByRole("button", { name: "Masquer les montants" }).click();
  await expect(page.locator(".hero-value").first()).toHaveText("••••••");
  // Amounts hidden: no share bar either, it would give the proportions away.
  await expect(page.locator(".type-share")).toHaveCount(0);
  await page.getByRole("button", { name: "Afficher les montants" }).click();
  await page.setViewportSize({ width: 834, height: 1112 });
  await page.screenshot({
    path: "docs/captures/03-finance-ipad.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "docs/captures/04-finance-iphone.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole("navigation", { name: "Navigation mobile" })
    .getByRole("button", { name: "Plus" })
    .click();
  await page
    .locator(".mobile-more")
    .getByRole("button", { name: "Épargne et projets" })
    .click();
  await page.screenshot({
    path: "docs/captures/05-projets-iphone.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Ajouter", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Un projet" })).toBeVisible();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Fermer", exact: true })
    .click();
  // Mon mois à 390 px, sur la démonstration : capture, sans débordement.
  await page
    .getByRole("navigation", { name: "Navigation mobile" })
    .getByRole("button", { name: "Mon mois", exact: true })
    .click();
  await expect(page.getByRole("heading", { name: "Mon mois", exact: true })).toBeVisible();
  await page.screenshot({
    path: "docs/captures/06-mon-mois-iphone.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  // Onglets de filtre à 390 px (Investissements) : chaque onglet reste entier dans sa barre,
  // elle-même dans l'écran.
  await page
    .getByRole("navigation", { name: "Navigation mobile" })
    .getByRole("button", { name: "Plus" })
    .click();
  await page
    .locator(".mobile-more")
    .getByRole("button", { name: "Investissements", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Investissements", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const filterTabBars = await page.locator(".tab-bar").all();
  expect(filterTabBars.length).toBeGreaterThan(0);
  for (const bar of filterTabBars) {
    const barBox = await bar.boundingBox();
    expect(barBox).not.toBeNull();
    expect(barBox!.x).toBeGreaterThanOrEqual(0);
    expect(barBox!.x + barBox!.width).toBeLessThanOrEqual(390);
    const tabs = await bar.locator(".tab-button").all();
    expect(tabs.length).toBeGreaterThan(0);
    for (const tab of tabs) {
      const box = await tab.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(barBox!.x - 0.5);
      expect(box!.x + box!.width).toBeLessThanOrEqual(
        barBox!.x + barBox!.width + 0.5,
      );
      // Libellé entier : rien n'est rogné à l'intérieur du bouton.
      expect(
        await tab.evaluate((el) => el.scrollWidth <= el.clientWidth),
      ).toBe(true);
    }
  }
  // Exercise the actual CSV input, preview and merge with fictitious data.
  await page.setViewportSize({ width: 1440, height: 1000 });
  const navigation = page.getByRole("navigation", {
    name: "Navigation principale",
    exact: true,
  });
  const month = new Date().toISOString().slice(0, 7);
  const csv = Buffer.from(
    `externalId;label;kind;amount;currency;status;date;budgetMonth;accountId\n` +
      `TEST_CSV_UI;Import CSV fictif;expense;19.95;CHF;planned;;${month};demo-bank\n`,
  );
  for (let attempt = 0; attempt < 2; attempt++) {
    await navigation
      .getByRole("button", { name: "Documents et réglages", exact: true })
      .click();
    await page
      .locator('input[type="file"][accept=".json,.csv"]')
      .setInputFiles({
        name: "test-fictif.csv",
        mimeType: "text/csv",
        buffer: csv,
      });
    await expect(
      page.getByText("Vérifier cet import", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Confirmer l’import", exact: true })
      .click();
    await expect(
      page.getByText("Vérifier cet import", { exact: true }),
    ).toHaveCount(0);
    await navigation
      .getByRole("button", { name: "Mon mois", exact: true })
      .click();
    await expect(
      page.getByText("Import CSV fictif", { exact: true }),
    ).toHaveCount(1);
  }
  expect(errors).toEqual([]);
});
test("daily entries: income, currency-synced transfer, recurrence, investment-only position picker, receipt from a row", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByLabel("Phrase secrète", { exact: true }).fill(passphrase);
  await page.getByLabel("Confirmer la phrase secrète").fill(passphrase);
  await page.getByRole("button", { name: "Créer mon coffre" }).click();
  const nav = page.getByRole("navigation", {
    name: "Navigation principale",
    exact: true,
  });
  async function newAccount(name: string, institution: string, ccy: string) {
    await nav.getByRole("button", { name: "Mes comptes", exact: true }).click();
    await page.getByRole("button", { name: "Ajouter", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Nom du compte").fill(name);
    await dialog.getByLabel("Établissement").fill(institution);
    if (ccy !== "CHF")
      await dialog.getByLabel("Devise", { exact: true }).selectOption(ccy);
    await dialog
      .getByRole("button", { name: "Enregistrer", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }
  await newAccount("Compte principal test", "Banque Fictive", "CHF");
  await newAccount("Compte voyage test", "Banque Fictive", "EUR");
  await page.getByRole("button", { name: "Ajouter", exact: true }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("Nom du compte").fill("Portefeuille test");
  await dialog.getByLabel("Établissement").fill("Courtier Fictif");
  await dialog.getByLabel("Type de compte", { exact: true }).selectOption("Trading");
  await dialog
    .getByRole("button", { name: "Enregistrer", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // 1) Income, confirmed as received, then a receipt attached directly from its row
  // (no navigation needed; a settled row is where a receipt is actually in hand).
  await nav.getByRole("button", { name: "Mon mois", exact: true }).click();
  await page.getByRole("button", { name: "Ajouter", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.locator('select[name="kind"]').selectOption("income");
  await dialog.getByLabel("Libellé").fill("Salaire synthétique test");
  await dialog.getByLabel("Montant", { exact: true }).fill("3000");
  await dialog
    .getByLabel("Compte", { exact: true })
    .selectOption({ label: "Compte principal test · CHF" });
  await dialog.getByLabel("État", { exact: true }).selectOption({ label: "Reçu" });
  await dialog
    .getByRole("button", { name: "Enregistrer", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const incomeRow = page.locator(".row", {
    hasText: "Salaire synthétique test",
  });
  await incomeRow
    .getByRole("button", {
      name: "Joindre un document à Salaire synthétique test",
    })
    .setInputFiles({
      name: "recu-test-fictif.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        "base64",
      ),
    });
  await expect(incomeRow).toContainText("Justificatif joint");
  await nav
    .getByRole("button", { name: "Documents et réglages", exact: true })
    .click();
  await expect(
    page
      .locator(".row", { hasText: "recu-test-fictif.png" })
      .getByText("Salaire synthétique test", { exact: false }),
  ).toBeVisible();

  // 2) Recurrence: currency prefilled from the chosen account, no duplicate entry.
  // Created from Mon mois' own « Mes factures » card, which holds every recurring bill and
  // subscription of the month (no separate Factures or Abonnements page any more).
  await nav.getByRole("button", { name: "Mon mois", exact: true }).click();
  await page.getByRole("button", { name: "Ajouter une facture", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Une facture" });
  await dialog.getByLabel("Libellé", { exact: true }).fill("Assurance test");
  await dialog.getByLabel("Montant", { exact: true }).fill("45");
  await dialog
    .getByLabel("Compte", { exact: true })
    .selectOption({ label: "Compte principal test · CHF" });
  await expect(dialog.getByLabel("Devise", { exact: true })).toHaveValue(
    "CHF",
  );
  // No date to choose: « Tous les mois » from the month on screen, so this month is due.
  for (const gone of ["Catégorie", "Jour du mois", "Début", "Fin (facultative)"])
    await expect(dialog.getByLabel(gone, { exact: true })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Tous les mois", exact: true })).toHaveAttribute("aria-pressed", "true");
  await dialog
    .getByRole("button", { name: "Enregistrer", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // One row for the bill and its occurrence of the month, in « Mes factures », never a second one.
  const billsCardDaily = page.locator(".card", {
    has: page.locator(".card-title", { hasText: "Mes factures" }),
  });
  const occurrenceRow = page.locator(".row", { hasText: "Assurance test" });
  await expect(occurrenceRow).toHaveCount(1);
  await expect(billsCardDaily.locator(".row", { hasText: "Assurance test" })).toHaveCount(1);
  // Reopening confirms "bill" was actually saved, not just held in form state: the pencil opens
  // this month's small change, whose full edit reopens as « Une facture », without any date to
  // choose and with its nature kept.
  await occurrenceRow
    .getByRole("button", { name: "Modifier Assurance test", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Modifier Assurance test" })
    .getByRole("button", { name: "Modifier le nom, le compte, la répétition ou l’arrêter", exact: true })
    .click();
  dialog = page.getByRole("dialog", { name: "Une facture" });
  await expect(dialog.getByLabel("Jour du mois", { exact: true })).toHaveCount(0);
  await expect(dialog.getByLabel("Nature", { exact: true })).toHaveValue("bill");
  await expect(
    dialog.getByRole("button", { name: "Tous les mois", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await dialog.getByRole("button", { name: "Fermer" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // 2bis) Statuts explicites : "Marquer payé" écrit directement, sans dialogue (exécution
  // instantanée, date de règlement fixée à aujourd'hui) ; "Remettre à payer" revient en
  // arrière sans effacer la trace du règlement précédent. Exercised on the bill's own row.
  await expect(occurrenceRow).toContainText("Pas encore payé");
  await occurrenceRow
    .getByRole("button", { name: "Payer", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // Instant write still gives visible feedback: a brief glacier-blue flash (row-flash-positive,
  // self-clearing via the row's own onAnimationEnd, not a timer) is the only confirmation a
  // dialog-less "Payer" click actually did something.
  await expect(occurrenceRow).toHaveClass(/row-flash-positive/);
  await expect(occurrenceRow).toContainText("Payé");
  await expect(occurrenceRow).not.toContainText("Pas encore payé");
  await expect(occurrenceRow).not.toHaveClass(/row-flash-positive/);
  // Regression: the "Payer" button that had focus disappears once the row settles (replaced
  // by row-main becoming the "Modifier" target) — the browser used to drop focus to <body>
  // with nothing keyboard-reachable pointing back at the row that just changed. The row is
  // re-targeted by its stable id and focus moves onto its first real control instead.
  await expect(async () => {
    const activeIsBody = await page.evaluate(
      () => document.activeElement === document.body,
    );
    expect(activeIsBody).toBe(false);
  }).toPass({ timeout: 2000 });
  await expect(occurrenceRow.locator(":focus")).toHaveCount(1);
  // The pencil of a paid month says so (« Déjà payé »), without offering a second payment.
  await occurrenceRow
    .getByRole("button", { name: "Modifier Assurance test", exact: true })
    .click();
  dialog = page.getByRole("dialog", { name: "Modifier Assurance test" });
  await expect(dialog).toContainText("Déjà payé");
  await dialog.getByRole("button", { name: "Fermer" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // The settlement date was really set to today, not left blank by the direct write: the
  // operation offered for a receipt carries a short date, never « Non daté ».
  await nav.getByRole("button", { name: "Documents et réglages", exact: true }).click();
  const receiptSelect = page.getByRole("combobox", {
    name: "Lier à une opération (facultatif)",
  });
  // « Sans opération », the salary and the bill's payment.
  await expect(receiptSelect.locator("option")).toHaveCount(3);
  const settledOptions = (await receiptSelect.locator("option").allTextContents()).filter(
    (text) => text.includes("Assurance test"),
  );
  expect(settledOptions).toHaveLength(1);
  expect(settledOptions[0]).not.toContain("Non daté");
  expect(settledOptions[0]).toMatch(/^Assurance test · \d{1,2} \S+/);
  await nav.getByRole("button", { name: "Mon mois", exact: true }).click();
  // Remettre à payer acts at once, no browser confirm; « Annuler » in the message undoes it.
  await occurrenceRow
    .getByRole("button", { name: "Remettre à payer Assurance test", exact: true })
    .click();
  await expect(occurrenceRow).toContainText("Pas encore payé");
  await page.locator(".toast").getByRole("button", { name: "Annuler", exact: true }).click();
  await expect(occurrenceRow).toContainText("Payé");
  await expect(occurrenceRow).not.toContainText("Pas encore payé");
  await occurrenceRow
    .getByRole("button", { name: "Remettre à payer Assurance test", exact: true })
    .click();
  await expect(occurrenceRow).toContainText("Pas encore payé");
  // Regression: the occurrence is now a persisted transaction (status "planned"), not a
  // virtual one anymore. Clicking "Payer" a second time must still work directly.
  await occurrenceRow
    .getByRole("button", { name: "Payer", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(occurrenceRow).toContainText("Payé");
  await expect(occurrenceRow).not.toContainText("Pas encore payé");

  // 2ter) Même comportement pour une opération ponctuelle déjà persistée dès sa création
  // (pas liée à une récurrence) : "Payer" écrit aussi directement, sans dialogue.
  await page.getByRole("button", { name: "Ajouter", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Libellé").fill("Café test");
  await dialog.getByLabel("Montant", { exact: true }).fill("6");
  await dialog
    .getByLabel("Compte", { exact: true })
    .selectOption({ label: "Compte principal test · CHF" });
  await dialog
    .getByRole("button", { name: "Enregistrer", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const oneOffRow = page.locator(".row", { hasText: "Café test" });
  await expect(oneOffRow).toContainText("Pas encore payé");
  await oneOffRow
    .getByRole("button", { name: "Payer", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(oneOffRow).toContainText("Payé");
  await expect(oneOffRow).not.toContainText("Pas encore payé");

  // 2quater) Pencil/quick-edit icon: only offered while a row is not yet settled (a settled
  // row's own click opens the full editor instead, exercised above). It exposes only Libellé,
  // Montant and Mois — not the full field set — and changing Mois must move the transaction to
  // a different month's list without inventing a precise date for it.
  await page.getByRole("button", { name: "Ajouter", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Libellé").fill("Note test crayon");
  await dialog.getByLabel("Montant", { exact: true }).fill("12");
  await dialog
    .getByLabel("Compte", { exact: true })
    .selectOption({ label: "Compte principal test · CHF" });
  await dialog
    .getByRole("button", { name: "Enregistrer", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const pencilRow = page.locator(".row", { hasText: "Note test crayon" });
  await pencilRow
    .getByRole("button", { name: "Modifier Note test crayon", exact: true })
    .click();
  dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Libellé", { exact: true })).toBeVisible();
  await expect(dialog.getByLabel("Montant", { exact: true })).toBeVisible();
  await expect(dialog.getByLabel("Mois", { exact: true })).toBeVisible();
  // The full field set (Compte, Devise, État, Catégorie, Type) is deliberately absent here —
  // this is the narrower quick editor, not the full one reused for everything else.
  await expect(dialog.getByLabel("Compte", { exact: true })).toHaveCount(0);
  await expect(dialog.getByLabel("Devise", { exact: true })).toHaveCount(0);
  await expect(dialog.getByLabel("État", { exact: true })).toHaveCount(0);
  await expect(dialog.getByLabel("Catégorie", { exact: true })).toHaveCount(0);
  await expect(dialog.getByLabel("Type", { exact: true })).toHaveCount(0);
  // 2 months away is always a different month regardless of when the suite runs, and
  // Date's own month rollover handles a year boundary without extra arithmetic here.
  const pencilTargetDate = new Date();
  pencilTargetDate.setMonth(pencilTargetDate.getMonth() + 2);
  const pencilTargetMonth = `${pencilTargetDate.getFullYear()}-${String(
    pencilTargetDate.getMonth() + 1,
  ).padStart(2, "0")}`;
  await dialog.getByLabel("Mois", { exact: true }).fill(pencilTargetMonth);
  await dialog
    .getByRole("button", { name: "Enregistrer", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // Gone from this month's own lists (no date, and budgetMonth no longer matches here).
  await expect(page.getByText("Note test crayon", { exact: true })).toHaveCount(0);
  // Present under "Voir les autres mois", with no invented date — only the month is known.
  await page.getByRole("button", { name: /Voir les autres mois/ }).click();
  const movedRow = page.locator(".month-group", { hasText: "Note test crayon" });
  await expect(movedRow).toBeVisible();
  await expect(movedRow).toContainText("jour à vérifier");

  // 3) Transfer between two accounts of different currencies: source account is required,
  // currency is deduced from it, and the destination amount is required across currencies.
  await page.getByRole("button", { name: "Ajouter", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Libellé").fill("Virement voyage test");
  await dialog.locator('select[name="kind"]').selectOption("transfer");
  await dialog.getByLabel("Montant", { exact: true }).fill("200");
  await dialog
    .getByLabel("Compte", { exact: true })
    .selectOption({ label: "Compte principal test · CHF" });
  await expect(dialog.getByLabel("Devise", { exact: true })).toHaveValue(
    "CHF",
  );
  await dialog
    .getByLabel("Compte destinataire", { exact: true })
    .selectOption({ label: "Compte voyage test · EUR" });
  await dialog
    .getByRole("button", { name: "Enregistrer", exact: true })
    .click();
  // Cross-currency transfer without a received amount stays open with the input kept.
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await expect(page.getByRole("alert")).toContainText(
    "montant reçu requis pour un virement entre devises",
  );
  await expect(dialog.getByLabel("Libellé")).toHaveValue(
    "Virement voyage test",
  );
  await dialog
    .getByLabel("Montant reçu (devise du destinataire)", { exact: true })
    .fill("208");
  await dialog
    .getByRole("button", { name: "Enregistrer", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByText("Virement voyage test", { exact: true }),
  ).toBeVisible();
  // A transfer is neither income nor expense: it sits in « Mis de côté » only.
  const cardTitled = (title: string) =>
    page.locator(".card", { has: page.locator(".card-title", { hasText: title }) });
  await expect(
    cardTitled("Mis de côté").locator(".row", { hasText: "Virement voyage test" }),
  ).toHaveCount(1);
  for (const title of ["Mes revenus", "Mes factures", "Dépenses du mois"])
    await expect(
      cardTitled(title).locator(".row", { hasText: "Virement voyage test" }),
    ).toHaveCount(0);

  // 4) Investment position: only investment-kind accounts are offered.
  await nav
    .getByRole("button", { name: "Investissements", exact: true })
    .click();
  await page.getByRole("button", { name: "Ajouter", exact: true }).click();
  dialog = page.getByRole("dialog");
  const accountOptions = await dialog
    .getByLabel("Compte d’investissement", { exact: true })
    .locator("option")
    .allTextContents();
  expect(accountOptions).toEqual(["Non renseigné", "Portefeuille test · CHF"]);
  await dialog.getByLabel("Nom du titre", { exact: true }).fill("ETF test");
  await dialog
    .getByLabel("Compte d’investissement", { exact: true })
    .selectOption({ label: "Portefeuille test · CHF" });
  await dialog.getByLabel("Valeur totale de la position").fill("1000");
  await dialog
    .getByRole("button", { name: "Enregistrer", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.locator(".row-title", { hasText: "ETF test" }),
  ).toBeVisible();

  expect(errors).toEqual([]);
});
test("restore an older backup: refused with an explicit confirmation, cancel changes nothing, confirming restores it", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const restorePassphrase = "Exemple-test-Finance-restore-2026";
  const nav = page.getByRole("navigation", {
    name: "Navigation principale",
    exact: true,
  });
  async function addAccount(name: string) {
    await nav.getByRole("button", { name: "Mes comptes", exact: true }).click();
    await page.getByRole("button", { name: "Ajouter", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Nom du compte").fill(name);
    await dialog.getByLabel("Établissement").fill("Banque Fictive");
    await dialog
      .getByRole("button", { name: "Enregistrer", exact: true })
      .click();
    await expect(page.getByText(name, { exact: true })).toBeVisible();
  }

  await page.goto("/");
  await page.getByLabel("Phrase secrète", { exact: true }).fill(restorePassphrase);
  await page.getByLabel("Confirmer la phrase secrète").fill(restorePassphrase);
  await page.getByRole("button", { name: "Créer mon coffre" }).click();

  // Baseline account, then an encrypted backup that dates this exact state ("old").
  await addAccount("Compte ancien fictif");
  await nav
    .getByRole("button", { name: "Documents et réglages", exact: true })
    .click();
  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Sauvegarde chiffrée", exact: true })
    .click();
  const download = await downloadPromise;
  const downloadPath = await download.path();
  if (!downloadPath) throw new Error("Téléchargement de sauvegarde introuvable.");
  const oldBackup = await readFile(downloadPath);

  // A later change moves the on-device vault's savedAt strictly after the backup above.
  await addAccount("Compte récent fictif");
  await page
    .getByRole("button", { name: "Verrouiller l’espace", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Ouvrir mon espace" }),
  ).toBeVisible();

  async function selectOldBackupAndSubmit() {
    await page.getByLabel("Restaurer une sauvegarde").setInputFiles({
      name: "ancienne-sauvegarde.finance-vault",
      mimeType: "application/octet-stream",
      buffer: oldBackup,
    });
    await expect(
      page.getByRole("heading", { name: "Restaurer votre sauvegarde" }),
    ).toBeVisible();
    await page
      .getByLabel("Phrase secrète", { exact: true })
      .fill(restorePassphrase);
    await page
      .getByLabel("Remplacer le coffre de cet appareil par cette sauvegarde.")
      .check();
    await page.getByRole("button", { name: "Restaurer", exact: true }).click();
  }

  // 1) Refused: the backup is older than the vault already on this device.
  await selectOldBackupAndSubmit();
  const confirmHeading = page.getByRole("heading", {
    name: "Confirmer la restauration",
  });
  await expect(confirmHeading).toBeVisible();
  await expect(page.locator("#older-backup-message")).toContainText(
    "plus ancienne",
  );
  await expect(page.getByRole("alertdialog")).toBeVisible();
  // The safer action (Annuler) is the one that receives focus by default.
  await expect(
    page.getByRole("button", { name: "Annuler", exact: true }),
  ).toBeFocused();

  // 2) Cancel: no false success, and — proven by unlocking normally right after — the
  // on-device vault was genuinely never touched by the refused attempt.
  await page.getByRole("button", { name: "Annuler", exact: true }).click();
  await expect(confirmHeading).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Restaurer votre sauvegarde" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Annuler la restauration", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Ouvrir mon espace" }),
  ).toBeVisible();
  await page
    .getByLabel("Phrase secrète", { exact: true })
    .fill(restorePassphrase);
  await page.getByRole("button", { name: "Déverrouiller", exact: true }).click();
  await nav.getByRole("button", { name: "Mes comptes", exact: true }).click();
  await expect(page.getByText("Compte récent fictif", { exact: true })).toBeVisible();
  await expect(page.getByText("Compte ancien fictif", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Verrouiller l’espace", exact: true })
    .click();

  // 3) Confirm explicitly this time: the older backup is restored, replacing the newer vault.
  await selectOldBackupAndSubmit();
  await expect(confirmHeading).toBeVisible();
  await page
    .getByRole("button", { name: "Restaurer quand même", exact: true })
    .click();
  await expect(confirmHeading).toHaveCount(0);
  await expect(page.getByText("Compte ancien fictif", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Compte récent fictif", { exact: true }),
  ).toHaveCount(0);

  expect(errors).toEqual([]);
});

test("month picker: French Janvier–Décembre row, year navigation, Ce mois-ci shortcut", async ({
  page,
}) => {
  const monthPassphrase = "Exemple-test-Finance-mois-2026";
  const monthNames = [
    "Janvier",
    "Février",
    "Mars",
    "Avril",
    "Mai",
    "Juin",
    "Juillet",
    "Août",
    "Septembre",
    "Octobre",
    "Novembre",
    "Décembre",
  ];
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonthName = monthNames[now.getMonth()];
  // 6 months away is always a different month regardless of when the suite runs.
  const otherMonthName = monthNames[(now.getMonth() + 6) % 12];

  await page.goto("/");
  await page.getByLabel("Phrase secrète", { exact: true }).fill(monthPassphrase);
  await page.getByLabel("Confirmer la phrase secrète").fill(monthPassphrase);
  await page.getByRole("button", { name: "Créer mon coffre" }).click();

  // Compact trigger ("Septembre 2026"), not a visible 12-chip strip: the accessible name
  // carries the full "changer de mois" intent since the visible label alone doesn't. Held by
  // its stable class, not by that name — the name itself changes once a month is picked, and
  // a getByRole(name:) locator re-resolves against the CURRENT accessible name on every use.
  const trigger = page.locator(".month-picker-trigger");
  await expect(trigger).toHaveAttribute(
    "aria-label",
    `Changer de mois, actuellement ${currentMonthName} ${currentYear}`,
  );
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  // The current month is selected by default: no "back to this month" shortcut needed yet.
  await expect(page.getByRole("button", { name: "Ce mois-ci" })).toHaveCount(0);
  // Closed by default: the grid isn't in the tree until the trigger opens it.
  await expect(
    page.getByRole("group", { name: "Choisir un mois", exact: true }),
  ).toHaveCount(0);

  await trigger.click();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  const monthGroup = page.getByRole("group", { name: "Choisir un mois", exact: true });
  await expect(monthGroup).toBeVisible();
  const currentCell = page.getByRole("button", {
    name: `${currentMonthName} ${currentYear}`,
    exact: true,
  });
  await expect(currentCell).toHaveAttribute("aria-pressed", "true");
  await expect(currentCell).toHaveAttribute("aria-current", "date");

  // Distinct, disambiguated short labels: a naive slice(0, 3) would show "Jui" for both.
  await expect(
    page.getByRole("button", { name: `Juin ${currentYear}`, exact: true }),
  ).toHaveText("Jun");
  await expect(
    page.getByRole("button", { name: `Juillet ${currentYear}`, exact: true }),
  ).toHaveText("Jul");

  // Year navigation only browses (local to the open panel) — it must NOT commit a new month
  // by itself, unlike the old always-visible year stepper.
  await page.getByRole("button", { name: "Année suivante" }).click();
  await expect(page.locator(".month-picker-year-label")).toHaveText(String(currentYear + 1));
  await expect(trigger).toHaveAttribute(
    "aria-label",
    `Changer de mois, actuellement ${currentMonthName} ${currentYear}`,
  );
  await page.getByRole("button", { name: "Année précédente" }).click();
  await expect(page.locator(".month-picker-year-label")).toHaveText(String(currentYear));

  // Selecting another month commits it, closes the panel, updates the trigger label, and
  // reveals the "back to today" shortcut.
  await page
    .getByRole("button", { name: `${otherMonthName} ${currentYear}`, exact: true })
    .click();
  await expect(monthGroup).toHaveCount(0);
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await expect(trigger).toHaveAttribute(
    "aria-label",
    `Changer de mois, actuellement ${otherMonthName} ${currentYear}`,
  );
  const backToToday = page.getByRole("button", { name: "Ce mois-ci" });
  await expect(backToToday).toBeVisible();

  // Escape closes the panel and returns focus to the trigger without committing anything.
  await trigger.click();
  await expect(monthGroup).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(monthGroup).toHaveCount(0);
  await expect(trigger).toBeFocused();

  // The shortcut returns exactly to today's month and then disappears.
  await backToToday.click();
  await expect(trigger).toHaveAttribute(
    "aria-label",
    `Changer de mois, actuellement ${currentMonthName} ${currentYear}`,
  );
  await expect(page.getByRole("button", { name: "Ce mois-ci" })).toHaveCount(0);
});

// abonnements.md, "Vérifications obligatoires": a status changed on the page that holds the
// subscriptions updates Mon mois and the Accueil after reload and unlock, without a duplicate.
// Factures and Abonnements now live in Mon mois: the subscription is added there (« Ajouter une
// dépense », « Tous les mois », nature « Abonnement ») and paid from its own row.
test("subscriptions: an abonnement added and paid on Mon mois updates the Accueil, no duplicate, survives reload", async ({
  page,
}) => {
  const subsPassphrase = "Exemple-test-Finance-abonnements-2026";
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByLabel("Phrase secrète", { exact: true }).fill(subsPassphrase);
  await page.getByLabel("Confirmer la phrase secrète").fill(subsPassphrase);
  await page.getByRole("button", { name: "Créer mon coffre" }).click();
  const nav = page.getByRole("navigation", {
    name: "Navigation principale",
    exact: true,
  });

  await nav.getByRole("button", { name: "Mes comptes", exact: true }).click();
  await page.getByRole("button", { name: "Ajouter", exact: true }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("Nom du compte").fill("Compte abonnements test");
  await dialog.getByLabel("Établissement").fill("Banque Fictive");
  await dialog
    .getByRole("button", { name: "Enregistrer", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // Monthly from today, no day to choose: due this month.
  await nav.getByRole("button", { name: "Mon mois", exact: true }).click();
  await page.getByRole("button", { name: "Ajouter une dépense", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Libellé", { exact: true }).fill("Charge test abo");
  await dialog.getByRole("button", { name: "Tous les mois", exact: true }).click();
  await dialog.getByLabel("Nature", { exact: true }).selectOption("subscription");
  await dialog.getByLabel("Montant", { exact: true }).fill("77.70");
  await dialog
    .getByLabel("Compte", { exact: true })
    .selectOption({ label: "Compte abonnements test · CHF" });
  await dialog
    .getByRole("button", { name: "Enregistrer", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // A single row for the subscription and its month: in « Mes factures », tagged « Abonnement »,
  // never again as a one-off expense.
  const card = (title: string) =>
    page.locator(".card", { has: page.locator(".card-title", { hasText: title }) });
  const subsRow = page.locator(".row", { hasText: "Charge test abo" });
  await expect(subsRow).toHaveCount(1);
  await expect(card("Mes factures").locator(".row", { hasText: "Charge test abo" })).toHaveCount(1);
  await expect(subsRow.locator(".tag")).toHaveText("Abonnement");
  await expect(subsRow).toContainText("Tous les mois");
  await expect(subsRow).toContainText("Pas encore payé");
  await expect(subsRow.locator(".row-value")).toHaveText(/^77\.70\s*CHF$/);
  const statValue = (label: string) =>
    page.locator(".stat-card", { hasText: label }).locator(".metric-value");
  const leftToPay = statValue("Reste à payer");
  await expect(leftToPay).toHaveText(/^77\.70\s*CHF$/);
  // The paid share is a progress bar under « Reste à payer ».
  const paidShare = page.getByRole("progressbar", { name: "Part des dépenses payée" });
  await expect(paidShare).toHaveCount(1);
  await expect(paidShare).toHaveAttribute("aria-valuenow", "0");

  // Mark it paid from its row — writes directly, no dialog.
  await subsRow
    .getByRole("button", { name: "Payer", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // The instant write's flash (row-flash-positive), self-cleared by the row's onAnimationEnd.
  await expect(subsRow).toHaveClass(/row-flash-positive/);
  await expect(subsRow).toContainText("Payé");
  await expect(subsRow).not.toContainText("Pas encore payé");
  await expect(leftToPay).toHaveText(/^0\.00\s*CHF$/);
  await expect(paidShare).toHaveAttribute("aria-valuenow", "100");
  await expect(subsRow).not.toHaveClass(/row-flash-positive/);
  await expect(subsRow).toHaveCount(1);
  // "Le mouvement du mois" and "Projection nette" are gone from every page: a single
  // « Il me reste » replaces them (checked here on Mon mois, then on Accueil below).
  const mouvementDuMoisHeading = page.getByRole("heading", {
    name: "Le mouvement du mois",
    exact: true,
  });
  const projectionNette = page.getByText("Projection nette du mois", { exact: true });
  await expect(mouvementDuMoisHeading).toHaveCount(0);
  await expect(projectionNette).toHaveCount(0);

  // Accueil: the paid occurrence no longer waits in « À régler », the one « Il me reste » is
  // there, and the old duplicate month figures are not.
  await nav.getByRole("button", { name: "Vue d’ensemble", exact: true }).click();
  const toSettle = page.locator(".card", {
    has: page.locator(".card-title", { hasText: "À régler" }),
  });
  await expect(toSettle).toBeVisible();
  await expect(toSettle.locator(".row", { hasText: "Charge test abo" })).toHaveCount(0);
  await expect(page.locator(".left-card")).toContainText("Il me reste en");
  await expect(mouvementDuMoisHeading).toHaveCount(0);
  await expect(projectionNette).toHaveCount(0);

  // Reload and unlock: everything above survives, still no duplicate.
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Ouvrir mon espace" }),
  ).toBeVisible();
  await page.getByLabel("Phrase secrète", { exact: true }).fill(subsPassphrase);
  await page
    .getByRole("button", { name: "Déverrouiller", exact: true })
    .click();
  // Lands on the Accueil by default (its <h1> is the page's own name, "Vue d'ensemble"), since
  // `page` state resets to "overview" on every fresh mount, unlock included.
  await expect(
    page.getByRole("heading", { name: "Vue d’ensemble", exact: true }),
  ).toBeVisible();
  await expect(toSettle).toBeVisible();
  await expect(toSettle.locator(".row", { hasText: "Charge test abo" })).toHaveCount(0);
  await nav.getByRole("button", { name: "Mon mois", exact: true }).click();
  await expect(subsRow).toHaveCount(1);
  await expect(subsRow).toContainText("Payé");
  await expect(subsRow.locator(".tag")).toHaveText("Abonnement");
  await expect(leftToPay).toHaveText(/^0\.00\s*CHF$/);
  await expect(mouvementDuMoisHeading).toHaveCount(0);
  await expect(projectionNette).toHaveCount(0);

  expect(errors).toEqual([]);
});

test("Mon mois: reçu, facture, abonnement, virement — chacun dans sa carte, à régler d'abord puis montant décroissant, bouton toujours aligné, montant coloré par nature", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByLabel("Phrase secrète", { exact: true }).fill(passphrase);
  await page.getByLabel("Confirmer la phrase secrète").fill(passphrase);
  await page.getByRole("button", { name: "Créer mon coffre" }).click();
  const nav = page.getByRole("navigation", {
    name: "Navigation principale",
    exact: true,
  });
  async function newAccount(name: string) {
    await nav.getByRole("button", { name: "Mes comptes", exact: true }).click();
    await page.getByRole("button", { name: "Ajouter", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Nom du compte").fill(name);
    await dialog.getByLabel("Établissement").fill("Banque Fictive");
    await dialog
      .getByRole("button", { name: "Enregistrer", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }
  await newAccount("Compte tri test");
  await newAccount("Compte tri destination");

  // One-off, unpaid, PERSISTED transactions (they exist in data.transactions the moment they're
  // saved, whatever their status) — each therefore shows the "Modifier" pencil next to its
  // quick-settle button.
  await nav.getByRole("button", { name: "Mon mois", exact: true }).click();
  async function newOperation(
    kind: "income" | "expense" | "transfer",
    label: string,
    amount: string,
    options: { monthly?: "bill" | "subscription" } = {},
  ) {
    await page.getByRole("button", { name: "Ajouter", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.locator('select[name="kind"]').selectOption(kind);
    await dialog.getByLabel("Libellé").fill(label);
    if (options.monthly) {
      await dialog.getByRole("button", { name: "Tous les mois", exact: true }).click();
      await dialog.getByLabel("Nature", { exact: true }).selectOption(options.monthly);
    }
    await dialog.getByLabel("Montant", { exact: true }).fill(amount);
    await dialog
      .getByLabel("Compte", { exact: true })
      .selectOption({ label: "Compte tri test · CHF" });
    if (kind === "transfer")
      await dialog
        .getByLabel("Compte destinataire", { exact: true })
        .selectOption({ label: "Compte tri destination · CHF" });
    // Status left at its default ("planned").
    await dialog
      .getByRole("button", { name: "Enregistrer", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }
  await newOperation("income", "Revenu test tri", "200");
  await newOperation("expense", "Facture ponctuelle test", "100");
  await newOperation("expense", "Achat test tri", "250");
  await newOperation("transfer", "Virement test tri", "75");
  // Two recurrences due this month, left unsettled: a bill from « Ajouter une facture », a
  // subscription from the operation form (« Tous les mois », nature « Abonnement »).
  await page.getByRole("button", { name: "Ajouter une facture", exact: true }).click();
  const billDialog = page.getByRole("dialog", { name: "Une facture" });
  await billDialog.getByLabel("Libellé", { exact: true }).fill("Charge récurrente test");
  await billDialog.getByLabel("Montant", { exact: true }).fill("50");
  await billDialog
    .getByLabel("Compte", { exact: true })
    .selectOption({ label: "Compte tri test · CHF" });
  await billDialog.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await newOperation("expense", "Abo test tri", "30", { monthly: "subscription" });

  const card = (title: string) =>
    page.locator(".card", { has: page.locator(".card-title", { hasText: title }) });
  await expect(page.locator("main .card-title")).toHaveText([
    "Mes revenus",
    "Mes factures",
    "Dépenses du mois",
    "Mis de côté",
  ]);
  await expect(card("Mes revenus").locator(".row-title")).toHaveText(["Revenu test tri"]);
  // Recurring bills and subscriptions share « Mes factures », largest first; only the
  // subscription carries the « Abonnement » tag.
  await expect(card("Mes factures").locator(".row-title")).toHaveText([
    "Charge récurrente test",
    /^Abo test tri\s*Abonnement$/,
  ]);
  await expect(card("Mes factures").locator(".row", { hasText: "Charge récurrente test" }).locator(".tag")).toHaveCount(0);
  // One-off expenses, largest first.
  await expect(card("Dépenses du mois").locator(".row-title")).toHaveText([
    "Achat test tri",
    "Facture ponctuelle test",
  ]);
  await expect(card("Mis de côté").locator(".row-title")).toHaveText(["Virement test tri"]);
  // Every operation once on the page, never twice.
  for (const label of [
    "Revenu test tri",
    "Facture ponctuelle test",
    "Achat test tri",
    "Virement test tri",
    "Charge récurrente test",
    "Abo test tri",
  ])
    await expect(page.locator(".row", { hasText: label })).toHaveCount(1);

  // What is still to pay comes first: once paid, a line goes below the unpaid ones.
  await card("Dépenses du mois")
    .locator(".row", { hasText: "Achat test tri" })
    .getByRole("button", { name: "Payer", exact: true })
    .click();
  await expect(card("Dépenses du mois").locator(".row-title")).toHaveText([
    "Facture ponctuelle test",
    "Achat test tri",
  ]);
  await card("Mes factures")
    .locator(".row", { hasText: "Charge récurrente test" })
    .getByRole("button", { name: "Payer", exact: true })
    .click();
  await expect(card("Mes factures").locator(".row-title")).toHaveText([
    /^Abo test tri\s*Abonnement$/,
    "Charge récurrente test",
  ]);

  // The persisted one-off row and the recurring subscription row both show a "Modifier" pencil
  // before « Payer », in two different cards: their buttons still end at the exact same x — the
  // real defect a user screenshot once showed (the button used to trail any icon instead of
  // leading it, so its right edge shifted row to row).
  const oneOffButton = card("Dépenses du mois")
    .locator(".row", { hasText: "Facture ponctuelle test" })
    .getByRole("button", { name: "Payer", exact: true });
  const recurringButton = card("Mes factures")
    .locator(".row", { hasText: "Abo test tri" })
    .getByRole("button", { name: "Payer", exact: true });
  const oneOffBox = await oneOffButton.boundingBox();
  const recurringBox = await recurringButton.boundingBox();
  if (!oneOffBox || !recurringBox) throw new Error("Payer button not found");
  expect(oneOffBox.x + oneOffBox.width).toBeCloseTo(
    recurringBox.x + recurringBox.width,
    0,
  );

  // The amount's class follows kind, not status: income reads soft green with "+", an expense
  // soft red, whether still due or already paid; a transfer neither.
  await expect(
    card("Mes revenus").locator(".row", { hasText: "Revenu test tri" }).locator(".row-value"),
  ).toHaveClass(/positive/);
  await expect(
    card("Mes revenus").locator(".row", { hasText: "Revenu test tri" }).locator(".row-value"),
  ).toHaveText(/^\+200\.00\s*CHF$/);
  await expect(
    card("Dépenses du mois")
      .locator(".row", { hasText: "Facture ponctuelle test" })
      .locator(".row-value"),
  ).toHaveClass(/negative/);
  await expect(
    card("Dépenses du mois").locator(".row", { hasText: "Achat test tri" }).locator(".row-value"),
  ).toHaveClass(/negative/);
  await expect(
    card("Mes factures").locator(".row", { hasText: "Charge récurrente test" }).locator(".row-value"),
  ).toHaveClass(/negative/);
  await expect(
    card("Mis de côté")
      .locator(".row", { hasText: "Virement test tri" })
      .locator(".row-value"),
  ).not.toHaveClass(/positive|negative/);

  // The two indicators are the month's own figures: 100 + 30 still to pay (250 and 50 paid,
  // the transfer apart), 200 still to receive.
  const statValue = (label: string) =>
    page.locator(".stat-card", { hasText: label }).locator(".metric-value");
  await expect(statValue("Reste à payer")).toHaveText(/^130\.00\s*CHF$/);
  await expect(statValue("Reste à recevoir")).toHaveText(/^200\.00\s*CHF$/);

  expect(errors).toEqual([]);
});

// Regression: a single very long word (no spaces) in an account or institution name overflowed
// the page horizontally once the grid's last column had no blank cells left to absorb it —
// .institution and the account-head <h3> had no overflow-wrap, unlike .balance. Six accounts
// fill all three .account-grid columns at desktop width, which is what actually triggers it;
// a lone account does not (the overflow bleeds into empty grid cells instead of the viewport).
test("accounts: an unbroken long institution name wraps instead of overflowing the page", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByLabel("Phrase secrète", { exact: true }).fill("Exemple-test-Finance-debordement-2026");
  await page
    .getByLabel("Confirmer la phrase secrète")
    .fill("Exemple-test-Finance-debordement-2026");
  await page.getByRole("button", { name: "Créer mon coffre" }).click();
  await page
    .getByRole("navigation", { name: "Navigation principale", exact: true })
    .getByRole("button", { name: "Mes comptes", exact: true })
    .click();
  const longWord = "Établissementfinancierfictifinternationalsansespaceaucun";
  for (const label of ["A", "B", "C", "D", "E", "F"]) {
    await page.getByRole("button", { name: "Ajouter", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Nom du compte").fill(`Compte ${label}`);
    await dialog.getByLabel("Établissement").fill(longWord);
    await dialog
      .getByRole("button", { name: "Enregistrer", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});

// Regression: same class of bug as the account/institution one above, in a different element.
// .review-item p (Documents et réglages, carte "Informations à vérifier") had no overflow-wrap,
// unlike .review-item h3 (now covered by the generic h1/h2/h3 rule). A ReviewItem's `reason` is
// free imported text (up to 8000 characters, src/domain/validation.ts) and can contain a single
// unbroken long word. Unlike the account grid (three narrow columns), this card is full width
// on its own line at desktop width, so a single ~80-character word still fits without wrapping —
// it takes a much longer unbroken run (a plausible worst case for pasted/malformed import text)
// to actually push past the container and overflow the page.
test("review items: an unbroken long reason from an import wraps instead of overflowing the page", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page
    .getByLabel("Phrase secrète", { exact: true })
    .fill("Exemple-test-Finance-review-debordement-2026");
  await page
    .getByLabel("Confirmer la phrase secrète")
    .fill("Exemple-test-Finance-review-debordement-2026");
  await page.getByRole("button", { name: "Créer mon coffre" }).click();

  const longWord =
    "Informationimporteesansespacequidoitpasfairedeborderlapagecarcestunmottresslong".repeat(
      4,
    );
  const payload = JSON.stringify({
    version: 2,
    accounts: [],
    transactions: [],
    recurrences: [],
    goals: [],
    positions: [],
    documents: [],
    fxRates: [],
    reviewItems: [
      {
        id: "review-long-reason",
        title: "Élément à vérifier",
        reason: longWord,
        source: { system: "import" },
      },
    ],
    preferences: { baseCurrency: "CHF", locale: "fr-CH" },
  });
  await page
    .getByRole("navigation", { name: "Navigation principale", exact: true })
    .getByRole("button", { name: "Documents et réglages", exact: true })
    .click();
  await page
    .locator('input[type="file"][accept=".json,.csv"]')
    .setInputFiles({
      name: "import-fictif.json",
      mimeType: "application/json",
      buffer: Buffer.from(payload),
    });
  await expect(
    page.getByText("Vérifier cet import", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Confirmer l’import", exact: true })
    .click();
  await expect(
    page.getByText("Vérifier cet import", { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText(longWord, { exact: false })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});

const STATIC_MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};
// A private static file server for the PWA update test below: it mutates files on disk to
// simulate a second deploy, and playwright.config.ts's default (fullyParallel, multiple workers,
// same as CI's `pnpm run test:e2e`) means another test could otherwise run concurrently against
// the *shared* dist/ this suite's baseURL server also reads from — this keeps that mutation
// confined to a private copy nothing else touches, instead of relying on --workers=1.
function serveStaticDir(root: string): Promise<{ server: Server; port: number }> {
  const server = createServer((req, res) => {
    const url = new URL(req.url || "/", "http://localhost");
    const relativePath = url.pathname === "/" ? "/index.html" : url.pathname;
    readFile(join(root, decodeURIComponent(relativePath)))
      .then((body) => {
        res.writeHead(200, {
          "Content-Type":
            STATIC_MIME_TYPES[extname(relativePath)] || "application/octet-stream",
        });
        res.end(body);
      })
      .catch(() => {
        res.writeHead(404);
        res.end();
      });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({ server, port });
    });
  });
}

// The page is still open when a test ends: its keep-alive or in-flight requests (service worker
// update checks) would keep close() waiting until the test times out. Drop them first.
function stopServer(server: Server): Promise<void> {
  server.closeAllConnections();
  return new Promise<void>((resolve) => server.close(() => resolve()));
}

// Regression: sw.js's install/activate handlers used to omit skipWaiting()/clients.claim(), so a
// newly deployed shell stayed "waiting" and an already-open tab (or installed PWA) kept serving
// the OLD cached shell indefinitely — until every tab was fully closed and reopened, not merely
// reloaded. In practice this meant a page or fix shipped in a later release could stay invisible
// to a user who already had the app open, with no obvious way to tell why (this is exactly what
// happened with the Abonnements page). This test copies the repo's own dist/ (built by test:e2e's
// setup, same as every other test here) into a private temp directory served by its own HTTP
// server, and simulates a *second* deploy by editing that copy's sw.js cache version and
// index.html content directly — rebuilding a second time via vite would be slower and isn't
// needed to exercise the service worker logic itself, which is what this test targets. It then
// asks the browser to check for an update and confirms the ALREADY OPEN tab is offered — and can
// apply — the new content on its own, without the test ever closing the browser context.
test("PWA update: a new deploy offers an already-open tab a reload, without closing it", async ({
  page,
}) => {
  const siteDir = join(
    await mkdtemp(join(tmpdir(), "finance-pwa-test-")),
    "site",
  );
  await cp("dist", siteDir, { recursive: true });
  const { server, port } = await serveStaticDir(siteDir);

  try {
    const indexPath = join(siteDir, "index.html");
    const swPath = join(siteDir, "sw.js");
    const originalIndex = await readFile(indexPath, "utf8");
    const originalSw = await readFile(swPath, "utf8");

    await page.goto(`http://127.0.0.1:${port}/`);
    // The "Recharger" notice only renders in the unlocked layout — it exists to warn against
    // losing unsaved edits and re-locking an *open* vault, which requires one to actually be
    // open here too, not the plain lock screen.
    await page
      .getByLabel("Phrase secrète", { exact: true })
      .fill("Exemple-test-Finance-pwa-update-2026");
    await page
      .getByLabel("Confirmer la phrase secrète")
      .fill("Exemple-test-Finance-pwa-update-2026");
    await page.getByRole("button", { name: "Créer mon coffre" }).click();
    await page.waitForFunction(
      () => navigator.serviceWorker.controller !== null,
      null,
      { timeout: 15000 },
    );

    const marker = `test-marker-${Date.now()}`;
    await writeFile(
      indexPath,
      originalIndex.replace(
        "<title>",
        `<meta name="test-marker" content="${marker}" /><title>`,
      ),
    );
    await writeFile(
      swPath,
      originalSw.replace(/finance-shell-[a-z0-9]+/, `finance-shell-${marker}`),
    );

    // Scrolled down on a phone-sized window: the notice must still be on screen.
    await page.setViewportSize({ width: 390, height: 400 });
    await page.evaluate(() =>
      scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }),
    );
    expect(await page.evaluate(() => scrollY)).toBeGreaterThan(0);
    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      await registration?.update();
    });

    // main.tsx dispatches an "update ready" event once the controller changes (the new service
    // worker taking over); App.tsx turns that into a dismissible "Recharger" notice rather than
    // reloading on its own — a silent reload would re-lock the vault and drop any unsaved edit
    // without warning. Wait for that notice, then click it, instead of reloading manually: a
    // manual reload would not prove the update-ready wiring actually works end to end.
    await expect(
      page.getByRole("button", { name: "Recharger", exact: true }),
    ).toBeVisible({ timeout: 15000 });
    await expect(
      page.getByRole("button", { name: "Recharger", exact: true }),
    ).toBeInViewport();
    await page
      .getByRole("button", { name: "Recharger", exact: true })
      .click();

    await page.waitForFunction(
      (expected) =>
        document.querySelector('meta[name="test-marker"]')?.getAttribute(
          "content",
        ) === expected,
      marker,
      { timeout: 15000 },
    );
  } finally {
    await stopServer(server);
    await rm(siteDir, { recursive: true, force: true });
  }
});

// The lock screen holds nothing in memory, so a new deploy is applied at once there instead of
// waiting for a "Recharger" click that the lock screen used to never show.
test("PWA update: on the lock screen with nothing typed, a new deploy reloads by itself", async ({
  page,
}) => {
  const siteDir = join(
    await mkdtemp(join(tmpdir(), "finance-pwa-lock-test-")),
    "site",
  );
  await cp("dist", siteDir, { recursive: true });
  const { server, port } = await serveStaticDir(siteDir);

  try {
    const indexPath = join(siteDir, "index.html");
    const swPath = join(siteDir, "sw.js");
    const originalIndex = await readFile(indexPath, "utf8");
    const originalSw = await readFile(swPath, "utf8");

    await page.goto(`http://127.0.0.1:${port}/`);
    await expect(
      page.getByRole("button", { name: "Voir la démonstration" }),
    ).toBeVisible();
    await page.waitForFunction(
      () => navigator.serviceWorker.controller !== null,
      null,
      { timeout: 15000 },
    );

    const marker = `test-marker-lock-${Date.now()}`;
    await writeFile(
      indexPath,
      originalIndex.replace(
        "<title>",
        `<meta name="test-marker" content="${marker}" /><title>`,
      ),
    );
    await writeFile(
      swPath,
      originalSw.replace(/finance-shell-[a-z0-9]+/, `finance-shell-${marker}`),
    );

    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      await registration?.update();
    });

    await page.waitForFunction(
      (expected) =>
        document.querySelector('meta[name="test-marker"]')?.getAttribute(
          "content",
        ) === expected,
      marker,
      { timeout: 15000 },
    );
    await expect(
      page.getByRole("button", { name: "Recharger", exact: true }),
    ).toHaveCount(0);
  } finally {
    await stopServer(server);
    await rm(siteDir, { recursive: true, force: true });
  }
});

// Locking puts the vault out of memory, so a waiting update is applied right then.
test("PWA update: locking the vault applies a waiting update", async ({ page }) => {
  const siteDir = join(
    await mkdtemp(join(tmpdir(), "finance-pwa-lockapply-test-")),
    "site",
  );
  await cp("dist", siteDir, { recursive: true });
  const { server, port } = await serveStaticDir(siteDir);

  try {
    const indexPath = join(siteDir, "index.html");
    const swPath = join(siteDir, "sw.js");
    const originalIndex = await readFile(indexPath, "utf8");
    const originalSw = await readFile(swPath, "utf8");

    await page.goto(`http://127.0.0.1:${port}/`);
    await page
      .getByLabel("Phrase secrète", { exact: true })
      .fill("Exemple-test-Finance-pwa-lock-2026");
    await page
      .getByLabel("Confirmer la phrase secrète")
      .fill("Exemple-test-Finance-pwa-lock-2026");
    await page.getByRole("button", { name: "Créer mon coffre" }).click();
    await expect(
      page.getByRole("button", { name: "Verrouiller l’espace" }),
    ).toBeVisible({ timeout: 15000 });
    await page.waitForFunction(
      () => navigator.serviceWorker.controller !== null,
      null,
      { timeout: 15000 },
    );

    const marker = `test-marker-lockapply-${Date.now()}`;
    await writeFile(
      indexPath,
      originalIndex.replace(
        "<title>",
        `<meta name="test-marker" content="${marker}" /><title>`,
      ),
    );
    await writeFile(
      swPath,
      originalSw.replace(/finance-shell-[a-z0-9]+/, `finance-shell-${marker}`),
    );
    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      await registration?.update();
    });
    await expect(
      page.getByRole("button", { name: "Recharger", exact: true }),
    ).toBeVisible({ timeout: 15000 });

    await page.getByRole("button", { name: "Verrouiller l’espace" }).click();
    await page.waitForFunction(
      (expected) =>
        document.querySelector('meta[name="test-marker"]')?.getAttribute(
          "content",
        ) === expected,
      marker,
      { timeout: 15000 },
    );
  } finally {
    await stopServer(server);
    await rm(siteDir, { recursive: true, force: true });
  }
});

// Once something was typed on the lock screen (even if the fields were cleared since, as an
// unlock does while it derives its key), a new deploy waits for "Recharger" instead of reloading.
test("PWA update: after typing on the lock screen, a new deploy waits for Recharger", async ({
  page,
}) => {
  const siteDir = join(
    await mkdtemp(join(tmpdir(), "finance-pwa-typed-test-")),
    "site",
  );
  await cp("dist", siteDir, { recursive: true });
  const { server, port } = await serveStaticDir(siteDir);

  try {
    const indexPath = join(siteDir, "index.html");
    const swPath = join(siteDir, "sw.js");
    const originalIndex = await readFile(indexPath, "utf8");
    const originalSw = await readFile(swPath, "utf8");

    await page.goto(`http://127.0.0.1:${port}/`);
    await page.waitForFunction(
      () => navigator.serviceWorker.controller !== null,
      null,
      { timeout: 15000 },
    );
    const passphrase = page.getByLabel("Phrase secrète", { exact: true });
    await passphrase.fill("Exemple-test-Finance-pwa-typed-2026");
    await passphrase.fill("");

    const marker = `test-marker-typed-${Date.now()}`;
    await writeFile(
      indexPath,
      originalIndex.replace(
        "<title>",
        `<meta name="test-marker" content="${marker}" /><title>`,
      ),
    );
    await writeFile(
      swPath,
      originalSw.replace(/finance-shell-[a-z0-9]+/, `finance-shell-${marker}`),
    );
    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      await registration?.update();
    });

    await expect(
      page.getByRole("button", { name: "Recharger", exact: true }),
    ).toBeVisible({ timeout: 15000 });
    expect(
      await page.evaluate(() =>
        document.querySelector('meta[name="test-marker"]'),
      ),
    ).toBeNull();
  } finally {
    await stopServer(server);
    await rm(siteDir, { recursive: true, force: true });
  }
});

// "Tous les mois" saves a new operation as a monthly recurrence: this month settled, next month due.
test("new operation for every month becomes a recurrence, settled now and due next month", async ({
  page,
}) => {
  const monthNames = [
    "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
    "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre",
  ];
  const now = new Date();
  const nextIndex = (now.getMonth() + 1) % 12;
  const nextYear = now.getFullYear() + (nextIndex === 0 ? 1 : 0);

  await page.goto("/");
  await page.getByLabel("Phrase secrète", { exact: true }).fill("Exemple-test-Finance-repeat-2026");
  await page.getByLabel("Confirmer la phrase secrète").fill("Exemple-test-Finance-repeat-2026");
  await page.getByRole("button", { name: "Créer mon coffre" }).click();
  const nav = page.getByRole("navigation").first();
  await nav.getByRole("button", { name: "Mon mois", exact: true }).click();

  await page.getByRole("button", { name: "Ajouter", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.locator('select[name="kind"]').selectOption("income");
  await dialog.getByRole("button", { name: "Tous les mois", exact: true }).click();
  await expect(
    dialog.getByRole("button", { name: "Tous les mois", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await dialog.getByLabel("Libellé").fill("Salaire mensuel test");
  await dialog.getByLabel("Montant", { exact: true }).fill("4200");
  await dialog.getByLabel("État", { exact: true }).selectOption({ label: "Reçu" });
  await dialog.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // One row on the whole page: the recurring income and this month's receipt share it, in
  // « Mes revenus ».
  const incomeCard = page.locator(".card", {
    has: page.locator(".card-title", { hasText: "Mes revenus" }),
  });
  const rows = page.locator(".row", { hasText: "Salaire mensuel test" });
  await expect(rows).toHaveCount(1);
  await expect(incomeCard.locator(".row", { hasText: "Salaire mensuel test" })).toHaveCount(1);
  await expect(rows).toContainText("Tous les mois");
  await expect(rows).toContainText("Reçu");

  await page.locator(".month-picker-trigger").click();
  if (nextIndex === 0) await page.getByRole("button", { name: "Année suivante" }).click();
  await page
    .getByRole("button", { name: `${monthNames[nextIndex]} ${nextYear}`, exact: true })
    .click();
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText("Pas encore reçu");
  await expect(incomeCard.locator(".row", { hasText: "Salaire mensuel test" })).toHaveCount(1);
});

// Fake GitHub contents API held in memory, shared by two browser contexts ("devices").
function fakeGitHub() {
  const file: { raw: string | null; sha: string | null } = { raw: null, sha: null };
  const puts: string[] = [];
  // Origins whose requests fail as if that device had no network.
  const offline = new Set<string>();
  const cors = {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "authorization, accept, content-type, x-github-api-version",
    "access-control-allow-methods": "GET, PUT, OPTIONS",
  };
  const blobSha = (raw: string) =>
    createHash("sha1").update(`blob ${Buffer.byteLength(raw)}\0`).update(raw).digest("hex");
  async function handle(route: Route) {
    const request = route.request();
    if (offline.has(request.headers()["origin"] ?? ""))
      return route.abort("internetdisconnected");
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    const json = (status: number, body: unknown) =>
      route.fulfill({
        status,
        headers: { ...cors, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    const { pathname } = new URL(request.url());
    // Connexion simplifiée : identifiant et dépôts privés retrouvés depuis la seule clé.
    if (pathname === "/user") return json(200, { login: "exemple-test" });
    if (pathname === "/user/repos")
      return json(200, [
        { name: "finance-coffre", private: true, owner: { login: "exemple-test" } },
      ]);
    if (pathname === "/repos/exemple-test/finance-coffre")
      return json(200, { full_name: "exemple-test/finance-coffre", private: true });
    if (pathname === "/repos/exemple-test/finance-coffre/contents/finance-coffre.json") {
      if (request.method() === "GET")
        return file.raw === null
          ? json(404, { message: "Not Found" })
          : json(200, {
              type: "file",
              sha: file.sha,
              encoding: "base64",
              content: Buffer.from(file.raw).toString("base64"),
            });
      if (request.method() === "PUT") {
        const body = JSON.parse(request.postData() ?? "{}");
        if ((body.sha ?? null) !== file.sha) return json(409, { message: "sha mismatch" });
        file.raw = Buffer.from(body.content, "base64").toString("utf8");
        file.sha = blobSha(file.raw);
        puts.push(file.raw);
        return json(200, { content: { sha: file.sha } });
      }
    }
    return json(404, { message: "Not Found" });
  }
  return { file, puts, offline, handle };
}

test("sync: one vault on two devices through a private GitHub repository, encrypted only", async ({
  page,
}) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const github = fakeGitHub();
  const token = `github_pat_${"EXEMPLEFICTIF".repeat(3)}`; // Synthetic, never a real token.
  const syncPassphrase = "Exemple-test-Finance-sync-2026";
  const fillRepo = async (scope: Page | Locator) => {
    await scope.getByLabel("3. Clé d’accès").fill(token);
  };
  const addExpense = async (p: Page, label: string) => {
    await p
      .getByRole("navigation", { name: "Navigation principale", exact: true })
      .getByRole("button", { name: "Mon mois", exact: true })
      .click();
    await p.getByRole("button", { name: "Ajouter", exact: true }).click();
    const dialog = p.getByRole("dialog");
    await dialog.getByLabel("Libellé").fill(label);
    await dialog.getByLabel("Montant", { exact: true }).fill("55");
    await dialog.getByRole("button", { name: "Enregistrer", exact: true }).click();
    await expect(p.getByRole("dialog")).toHaveCount(0);
  };
  const wake = async (p: Page) => {
    await p.bringToFront();
    await p.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  };

  // Device A: new vault, then sync switched on from Documents et réglages.
  await page.context().route("https://api.github.com/**", github.handle);
  await page.goto("/");
  await page.getByLabel("Phrase secrète", { exact: true }).fill(syncPassphrase);
  await page.getByLabel("Confirmer la phrase secrète").fill(syncPassphrase);
  await page.getByRole("button", { name: "Créer mon coffre" }).click();
  await page
    .getByRole("navigation", { name: "Navigation principale", exact: true })
    .getByRole("button", { name: "Documents et réglages", exact: true })
    .click();
  const syncCard = page.locator(".card", {
    has: page.locator(".card-title", { hasText: "Synchronisation entre appareils" }),
  });
  await fillRepo(syncCard);
  await syncCard.getByRole("button", { name: "Activer la synchronisation" }).click();
  await expect(syncCard.getByRole("status")).toContainText("Synchronisé");
  expect(github.puts).toHaveLength(1);

  // A change on A is sent by itself, encrypted.
  await addExpense(page, "Courses synchro test");
  await expect.poll(() => github.puts.length).toBe(2);
  for (const raw of github.puts) {
    expect(JSON.parse(raw).format).toBe("Finance");
    expect(raw).not.toContain("Courses synchro test");
    expect(raw).not.toContain(token);
  }
  expect(await page.evaluate(() => Object.values(localStorage).join(""))).not.toContain(token);

  // Device B: another origin, so its own empty storage; same vault opened from GitHub.
  const originA = new URL(page.url()).origin;
  const originB = originA.replace("127.0.0.1", "localhost");
  const pageB = await page.context().newPage();
  pageB.on("pageerror", (e) => errors.push(e.message));
  await pageB.goto(`${originB}/`);
  await expect(pageB.getByRole("heading", { name: "Créer mon espace privé" })).toBeVisible();
  await pageB.getByText("Autres options", { exact: true }).click();
  await pageB.getByRole("button", { name: "Ouvrir avec la clé GitHub", exact: true }).click();
  await pageB.getByLabel("Phrase secrète", { exact: true }).fill(syncPassphrase);
  await fillRepo(pageB);
  await pageB.getByRole("button", { name: "Ouvrir depuis GitHub", exact: true }).click();
  await pageB
    .getByRole("navigation", { name: "Navigation principale", exact: true })
    .getByRole("button", { name: "Mon mois", exact: true })
    .click();
  await expect(pageB.getByText("Courses synchro test", { exact: true })).toBeVisible();

  // B changes something; A picks it up when it comes back to the foreground.
  const before = github.puts.length;
  await addExpense(pageB, "Pharmacie synchro test");
  await expect.poll(() => github.puts.length).toBe(before + 1);
  await wake(page);
  await expect(page.getByText("Pharmacie synchro test", { exact: true })).toBeVisible();

  // Both change while A is offline: A must ask which version to keep, writing nothing meanwhile.
  github.offline.add(originA);
  await addExpense(page, "Loyer hors ligne A");
  await addExpense(pageB, "Cadeau distant B");
  await expect.poll(() => github.puts.length).toBe(before + 2);
  const remoteBeforeChoice = github.file.raw;
  github.offline.delete(originA);
  await wake(page);
  const conflict = page.getByRole("alertdialog");
  await expect(conflict).toContainText("Deux versions différentes");
  expect(github.file.raw).toBe(remoteBeforeChoice);
  await conflict.getByRole("button", { name: "Garder cet appareil", exact: true }).click();
  await expect(conflict).toHaveCount(0);
  await expect.poll(() => github.puts.length).toBe(before + 3);

  // B follows A's choice.
  await wake(pageB);
  await expect(pageB.getByText("Loyer hors ligne A", { exact: true })).toBeVisible();
  await expect(pageB.getByText("Cadeau distant B", { exact: true })).toHaveCount(0);

  // Settled: further syncs on both devices send nothing (no ping-pong after a pull).
  await wake(page);
  await wake(pageB);
  await page.waitForTimeout(3000);
  expect(github.puts).toHaveLength(before + 3);

  // An editor left open on A while B's change is pulled must not write back its older fields.
  await page.getByRole("button", { name: "Modifier Courses synchro test", exact: true }).click();
  const staleEditor = page.getByRole("dialog");
  await pageB.getByRole("button", { name: "Modifier Courses synchro test", exact: true }).click();
  await pageB.getByRole("dialog").getByLabel("Montant", { exact: true }).fill("60");
  await pageB.getByRole("dialog").getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect.poll(() => github.puts.length).toBe(before + 4);
  await wake(page);
  await expect(page.getByText("Mis à jour avec les modifications")).toBeVisible();
  await staleEditor.getByLabel("Libellé").fill("Courses renommées A");
  await staleEditor.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(staleEditor).toContainText("mis à jour depuis un autre appareil pendant l’édition");
  await staleEditor.getByRole("button", { name: "Annuler", exact: true }).click();
  await expect(page.getByText("Courses renommées A")).toHaveCount(0);
  await expect(
    page.locator(".row", { hasText: "Courses synchro test" }).first(),
  ).toContainText("60.00");
  expect(github.puts).toHaveLength(before + 4);
  await pageB.close();
  expect(errors).toEqual([]);
});

test("sync: a separately created vault in the repository is never merged or overwritten without an explicit choice", async ({
  page,
}) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const github = fakeGitHub();
  const token = `github_pat_${"EXEMPLEFICTIF".repeat(3)}`; // Synthetic, never a real token.
  const enableSync = async (p: Page) => {
    await p
      .getByRole("navigation", { name: "Navigation principale", exact: true })
      .getByRole("button", { name: "Documents et réglages", exact: true })
      .click();
    const card = p.locator(".card", {
      has: p.locator(".card-title", { hasText: "Synchronisation entre appareils" }),
    });
    await card.getByLabel("3. Clé d’accès").fill(token);
    await card.getByRole("button", { name: "Activer la synchronisation" }).click();
    return card;
  };
  const createVault = async (p: Page, secret: string) => {
    await p.getByLabel("Phrase secrète", { exact: true }).fill(secret);
    await p.getByLabel("Confirmer la phrase secrète").fill(secret);
    await p.getByRole("button", { name: "Créer mon coffre" }).click();
  };

  // A: the vault already in use, synchronized.
  await page.context().route("https://api.github.com/**", github.handle);
  await page.goto("/");
  await createVault(page, "Exemple-test-Finance-coffre-A");
  const cardA = await enableSync(page);
  await expect(cardA.getByRole("status")).toContainText("Synchronisé");
  const remoteA = github.file.raw;

  // B: a second vault created separately, then pointed at the same repository.
  const originB = new URL(page.url()).origin.replace("127.0.0.1", "localhost");
  const pageB = await page.context().newPage();
  pageB.on("pageerror", (e) => errors.push(e.message));
  await pageB.goto(`${originB}/`);
  await createVault(pageB, "Exemple-test-Finance-coffre-B");
  await enableSync(pageB);
  const foreign = pageB.getByRole("alertdialog");
  await expect(foreign).toContainText("Ce dépôt contient un autre coffre");
  expect(github.file.raw).toBe(remoteA);

  // Replacing needs a second, explicit confirmation; cancelling writes nothing.
  await foreign.getByRole("button", { name: "Remplacer celui du dépôt par ce coffre" }).click();
  await foreign.getByRole("button", { name: "Annuler", exact: true }).click();
  expect(github.puts).toHaveLength(1);
  await foreign.getByRole("button", { name: "Remplacer celui du dépôt par ce coffre" }).click();
  await foreign.getByRole("button", { name: "Confirmer le remplacement", exact: true }).click();
  await expect(foreign).toHaveCount(0);
  await expect.poll(() => github.puts.length).toBe(2);

  // A is told the repository now holds another vault; nothing on A is replaced.
  await page.bringToFront();
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(page.getByRole("alertdialog")).toContainText("Ce dépôt contient un autre coffre");
  await expect(cardA.getByRole("status")).toContainText("autre coffre");
  expect(github.puts).toHaveLength(2);
  await pageB.close();
  expect(errors).toEqual([]);
});

test("bills: a monthly bill shows once on Mon mois; a small change applies to one month or from a month on", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const monthNames = [
    "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
    "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre",
  ];
  const now = new Date();
  const goToMonth = async (offset: number) => {
    const target = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    await page.locator(".month-picker-trigger").click();
    // The panel opens on the selected year: step to the target year first.
    const panelYear = Number(
      (await page.locator(".month-picker-panel").innerText()).match(/\b(20\d\d)\b/)![1],
    );
    for (let y = panelYear; y < target.getFullYear(); y++)
      await page.getByRole("button", { name: "Année suivante" }).click();
    for (let y = panelYear; y > target.getFullYear(); y--)
      await page.getByRole("button", { name: "Année précédente" }).click();
    await page
      .getByRole("button", {
        name: `${monthNames[target.getMonth()]} ${target.getFullYear()}`,
        exact: true,
      })
      .click();
  };
  const nav = page.getByRole("navigation", { name: "Navigation principale", exact: true });

  await page.goto("/");
  await page.getByLabel("Phrase secrète", { exact: true }).fill("Exemple-test-Finance-factures");
  await page.getByLabel("Confirmer la phrase secrète").fill("Exemple-test-Finance-factures");
  await page.getByRole("button", { name: "Créer mon coffre" }).click();
  await nav.getByRole("button", { name: "Mon mois", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Mon mois", exact: true })).toBeVisible();

  // Added from « Mes factures », on last month: a bill with no date to choose, every month from there.
  await goToMonth(-1);
  await page.getByRole("button", { name: "Ajouter une facture", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "Une facture" });
  for (const hidden of ["Nature", "Jour du mois", "Début", "Fin (facultative)", "Catégorie"])
    await expect(dialog.getByLabel(hidden, { exact: true })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Tous les mois", exact: true })).toHaveAttribute("aria-pressed", "true");
  await dialog.getByLabel("Libellé", { exact: true }).fill("Électricité test");
  await dialog.getByLabel("Montant", { exact: true }).fill("80");
  await dialog.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const billRow = page.locator(".row", { hasText: "Électricité test" });
  await expect(billRow).toHaveCount(1);
  await expect(billRow).toContainText("80.00");
  await expect(billRow).toContainText("Tous les mois");
  await expect(billRow).toContainText("Pas encore payé");
  // No day shown anywhere on the row, and never "Aucune échéance".
  await expect(billRow).not.toContainText(/\ble \d{1,2}\b/);
  await expect(page.getByText("Aucune échéance")).toHaveCount(0);
  await goToMonth(0);
  await expect(billRow).toContainText("80.00");

  // « Seulement ce mois » : only this month, nowhere after; before it, kept aside, folded.
  await page.getByRole("button", { name: "Ajouter une facture", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Une facture" });
  await dialog.getByLabel("Libellé", { exact: true }).fill("Impôts test");
  await dialog.getByLabel("Montant", { exact: true }).fill("400");
  await dialog.getByRole("button", { name: /^Seulement / }).click();
  await dialog.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const billsCard = page.locator(".card", {
    has: page.locator(".card-title", { hasText: "Mes factures" }),
  });
  const taxRow = page.locator(".row", { hasText: "Impôts test" });
  await expect(billsCard.locator(".row", { hasText: "Impôts test" })).toContainText("400.00");
  await expect(taxRow).toContainText("Seulement ce mois");
  const leftToPay = page.locator(".stat-card", { hasText: "Reste à payer" }).locator(".metric-value");
  await expect(leftToPay).toHaveText(/^480\.00\s*CHF$/);
  await goToMonth(1);
  await expect(taxRow).toHaveCount(0);
  await expect(leftToPay).toHaveText(/^80\.00\s*CHF$/);
  await goToMonth(-1);
  await expect(billsCard.locator(".row", { hasText: "Impôts test" })).toHaveCount(0);
  await page.getByText(/^Factures d’autres mois \(1\)$/).click();
  await expect(taxRow).toContainText(/^.*Seulement \S+ \d{4}/);
  await expect(taxRow).not.toContainText("400.00");
  await goToMonth(0);

  // This month only: 85 here, the usual 80 elsewhere.
  await page.getByRole("button", { name: "Modifier Électricité test", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Modifier Électricité test" });
  await expect(dialog.getByRole("button", { name: "Ce mois seulement", exact: true })).toHaveAttribute("aria-pressed", "true");
  await dialog.getByLabel(/^Montant/).fill("85");
  await dialog.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(billRow).toContainText("85.00");
  await expect(billRow).toContainText("montant modifié ce mois");
  await expect(leftToPay).toHaveText(/^485\.00\s*CHF$/);

  // The same single occurrence at 85, in « Mes factures » only: never a second line.
  const monthRow = billsCard.locator(".row", { hasText: "Électricité test" });
  await expect(billRow).toHaveCount(1);
  await expect(monthRow).toHaveCount(1);
  await expect(monthRow).toContainText("85.00");

  // Next month keeps the usual amount; from there on, 90.
  await goToMonth(1);
  await expect(billRow).toContainText("80.00");
  await page.getByRole("button", { name: "Modifier Électricité test", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Modifier Électricité test" });
  await dialog.getByRole("button", { name: "Ce mois et les suivants", exact: true }).click();
  await dialog.getByLabel(/^Montant/).fill("90");
  await dialog.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(billRow).toContainText("90.00");
  await goToMonth(2);
  await expect(billRow).toContainText("90.00");
  // One month changed then set back to the usual amount follows the bill again.
  const changeThisMonth = async (amount: string) => {
    await page.getByRole("button", { name: "Modifier Électricité test", exact: true }).click();
    const d = page.getByRole("dialog", { name: "Modifier Électricité test" });
    await d.getByLabel(/^Montant/).fill(amount);
    await d.getByRole("button", { name: "Enregistrer", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  };
  await changeThisMonth("95");
  await expect(billRow).toContainText("95.00");
  await expect(billRow).toContainText("habituel 90.00");
  await changeThisMonth("90");
  await expect(billRow).toContainText("90.00");
  await expect(billRow).not.toContainText("montant modifié");
  // Back on the usual amount for real: a later "from this month on" change reaches it too.
  await goToMonth(1);
  await page.getByRole("button", { name: "Modifier Électricité test", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Modifier Électricité test" });
  await dialog.getByRole("button", { name: "Ce mois et les suivants", exact: true }).click();
  await dialog.getByLabel(/^Montant/).fill("100");
  await dialog.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await goToMonth(2);
  await expect(billRow).toContainText("100.00");
  await expect(billRow).not.toContainText("montant modifié");
  await goToMonth(0);
  await expect(billRow).toContainText("85.00");
  await goToMonth(-1);
  await expect(billRow).toContainText("80.00");

  // Paying this month's adjusted bill settles that same occurrence, nothing left to pay.
  await goToMonth(0);
  await billRow.getByRole("button", { name: "Payer", exact: true }).click();
  await expect(billRow.getByRole("button", { name: "Payer", exact: true })).toHaveCount(0);
  await expect(billRow).toContainText("Payé");
  // Only the single-month tax is left, then nothing once it is paid too.
  await expect(leftToPay).toHaveText(/^400\.00\s*CHF$/);
  await taxRow.getByRole("button", { name: "Payer", exact: true }).click();
  await expect(taxRow).toContainText("Payé");
  await expect(leftToPay).toHaveText(/^0\.00\s*CHF$/);
  // Still one line each: the payments are the bills' own lines, not new one-off expenses.
  await expect(billRow).toHaveCount(1);
  await expect(taxRow).toHaveCount(1);
  await expect(monthRow).toContainText("85.00");
  await expect(
    page.locator(".card", { has: page.locator(".card-title", { hasText: "Dépenses du mois" }) }).locator(".row"),
  ).toHaveCount(0);

  // Everything survives a reload and unlock.
  await page.reload();
  await page.getByLabel("Phrase secrète", { exact: true }).fill("Exemple-test-Finance-factures");
  await page.getByRole("button", { name: "Déverrouiller", exact: true }).click();
  await nav.getByRole("button", { name: "Mon mois", exact: true }).click();
  await expect(billRow).toContainText("85.00");
  await expect(billRow).toContainText("Payé");
  await goToMonth(1);
  await expect(billRow).toContainText("100.00");
  await expect(taxRow).toHaveCount(0);

  // The single-month tax becomes monthly from its own simple editor: no date there either.
  await goToMonth(0);
  await page.getByRole("button", { name: "Modifier Impôts test", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Modifier Impôts test" })
    .getByRole("button", { name: "Modifier le nom, le compte, la répétition ou l’arrêter", exact: true })
    .click();
  dialog = page.getByRole("dialog", { name: "Une facture" });
  await expect(dialog.getByLabel("Jour du mois", { exact: true })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: /^Seulement / })).toHaveAttribute("aria-pressed", "true");
  await dialog.getByRole("button", { name: "Tous les mois", exact: true }).click();
  await dialog.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(taxRow).toContainText("Payé");
  await goToMonth(1);
  await expect(taxRow).toContainText("Tous les mois");
  await expect(taxRow).toContainText("400.00");
  await expect(taxRow).toContainText("Pas encore payé");

  // Stopping cleanly: « Jusqu'en {mois} » keeps every month before, nothing after.
  await page.getByRole("button", { name: "Modifier Électricité test", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Modifier Électricité test" })
    .getByRole("button", { name: "Modifier le nom, le compte, la répétition ou l’arrêter", exact: true })
    .click();
  dialog = page.getByRole("dialog", { name: "Une facture" });
  await expect(dialog.getByRole("button", { name: /^Seulement / })).toHaveCount(0);
  await dialog.getByRole("button", { name: /^Jusqu’en / }).click();
  await dialog.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(billRow).toContainText("100.00");
  await goToMonth(2);
  await expect(billRow).toHaveCount(0);
  await goToMonth(-1);
  await expect(billRow).toContainText("80.00");
  expect(errors).toEqual([]);
});

test("what is left this month: a bill paid ahead counts in its own month, on Mon mois and the Accueil", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const monthNames = [
    "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
    "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre",
  ];
  const now = new Date();
  const goToMonth = async (offset: number) => {
    const target = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    await page.locator(".month-picker-trigger").click();
    const panelYear = Number(
      (await page.locator(".month-picker-panel").innerText()).match(/\b(20\d\d)\b/)![1],
    );
    for (let y = panelYear; y < target.getFullYear(); y++)
      await page.getByRole("button", { name: "Année suivante" }).click();
    for (let y = panelYear; y > target.getFullYear(); y--)
      await page.getByRole("button", { name: "Année précédente" }).click();
    await page
      .getByRole("button", {
        name: `${monthNames[target.getMonth()]} ${target.getFullYear()}`,
        exact: true,
      })
      .click();
  };
  const nav = page.getByRole("navigation", { name: "Navigation principale", exact: true });
  await page.goto("/");
  await page.getByLabel("Phrase secrète", { exact: true }).fill("Exemple-test-Finance-reste");
  await page.getByLabel("Confirmer la phrase secrète").fill("Exemple-test-Finance-reste");
  await page.getByRole("button", { name: "Créer mon coffre" }).click();
  await nav.getByRole("button", { name: "Mon mois", exact: true }).click();

  const add = async (button: string, title: string, label: string, amount: string, single = false) => {
    await page.getByRole("button", { name: button, exact: true }).click();
    const dialog = page.getByRole("dialog", { name: title });
    await dialog.getByLabel("Libellé", { exact: true }).fill(label);
    await dialog.getByLabel("Montant", { exact: true }).fill(amount);
    if (single) await dialog.getByRole("button", { name: /^Seulement / }).click();
    await dialog.getByRole("button", { name: "Enregistrer", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  };
  await add("Ajouter une facture", "Une facture", "Loyer test", "2000");
  await add("Ajouter une facture", "Une facture", "Impôts test", "500", true);
  // No income yet: never a made-up negative « reste », an invitation instead.
  const left = page.locator(".left-card");
  await expect(left.locator(".metric-value")).toHaveText("—");
  await expect(left).toContainText("Ajoutez votre salaire");
  await add("Ajouter un revenu", "Un revenu", "Salaire test", "5000");

  // Mon mois: the same « Il me reste » as the Accueil, for this month.
  await expect(left).toContainText(`Il me reste en ${monthNames[now.getMonth()].toLowerCase()}`);
  await expect(left.locator(".metric-value")).toHaveText(/^2\s?500\.00\s*CHF$/);
  const breakdown = (label: string) => left.locator(".left-breakdown div", { hasText: label }).locator("dd");
  await expect(breakdown("Revenus")).toHaveText(/^5\s?000\.00\s*CHF$/);
  await expect(breakdown("Dépenses")).toHaveText(/^2\s?500\.00\s*CHF$/);

  // Next month's rent and salary settled ahead of time, today.
  await goToMonth(1);
  await expect(left.locator(".metric-value")).toHaveText(/^3\s?000\.00\s*CHF$/);
  const rent = page.locator(".row", { hasText: "Loyer test" });
  const salary = page.locator(".row", { hasText: "Salaire test" });
  await rent.getByRole("button", { name: "Payer", exact: true }).click();
  await expect(rent).toContainText("Payé");
  await salary.getByRole("button", { name: "Reçu", exact: true }).click();
  await expect(salary).toContainText("Reçu");

  // Next month is not empty — its own rent and salary, paid ahead, once each, with no date
  // shown: 2 000 of expenses, all paid, and nothing left to receive.
  const statValue = (label: string) =>
    page.locator(".stat-grid .stat-card", { hasText: label }).locator(".metric-value");
  await expect(rent).toHaveCount(1);
  await expect(salary).toHaveCount(1);
  await expect(left).toContainText(`Il me reste en ${monthNames[(now.getMonth() + 1) % 12].toLowerCase()}`);
  await expect(rent).not.toContainText(/\d{4}-\d{2}-\d{2}/);
  await expect(rent).not.toContainText(/\d{1,2} [a-zéû]+\./);
  await expect(left.locator(".metric-value")).toHaveText(/^3\s?000\.00\s*CHF$/);
  await expect(breakdown("Dépenses")).toHaveText(/^2\s?000\.00\s*CHF$/);
  await expect(statValue("Reste à payer")).toHaveText(/^0\.00\s*CHF$/);
  await expect(statValue("Reste à recevoir")).toHaveText(/^0\.00\s*CHF$/);

  // This month: only its own rent (still due) and the one-month tax — never next month's:
  // 2 500 of expenses, none paid yet.
  await goToMonth(0);
  await expect(rent).toHaveCount(1);
  await expect(rent).toContainText("Pas encore payé");
  await expect(left.locator(".metric-value")).toHaveText(/^2\s?500\.00\s*CHF$/);
  await expect(breakdown("Dépenses")).toHaveText(/^2\s?500\.00\s*CHF$/);
  await expect(statValue("Reste à payer")).toHaveText(/^2\s?500\.00\s*CHF$/);

  // Accueil: the very same « Il me reste », then the rent still to pay, at the top of the page.
  await nav.getByRole("button", { name: "Vue d’ensemble", exact: true }).click();
  await expect(left).toHaveCount(1);
  await expect(left.locator(".metric-value")).toHaveText(/^2\s?500\.00\s*CHF$/);
  const toSettle = page.locator(".card", {
    has: page.locator(".card-title", { hasText: "À régler" }),
  });
  await expect(toSettle.locator(".row", { hasText: "Loyer test" }).getByRole("button", { name: "Payer", exact: true })).toBeVisible();
  await nav.getByRole("button", { name: "Mon mois", exact: true }).click();

  // « Mes factures » shows a rhythm, never a day.
  const recurring = page.locator(".card", {
    has: page.locator(".card-title", { hasText: "Mes factures" }),
  });
  await expect(recurring.locator(".row", { hasText: "Loyer test" })).toContainText("Tous les mois");
  await expect(recurring).not.toContainText(/Le \d{1,2}\b/);
  expect(errors).toEqual([]);
});

test("account types: accounts grouped by type with totals, on Mes comptes and the Accueil", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const nav = page.getByRole("navigation", { name: "Navigation principale", exact: true });
  await page.goto("/");
  await page.getByLabel("Phrase secrète", { exact: true }).fill("Exemple-test-Finance-types");
  await page.getByLabel("Confirmer la phrase secrète").fill("Exemple-test-Finance-types");
  await page.getByRole("button", { name: "Créer mon coffre" }).click();
  await nav.getByRole("button", { name: "Mes comptes", exact: true }).click();

  const addAccount = async (
    name: string,
    type: string,
    amount: string,
    custom?: string,
    customKind?: string,
  ) => {
    await page.getByRole("button", { name: "Ajouter", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Un compte" });
    await dialog.getByLabel("Nom du compte", { exact: true }).fill(name);
    await dialog.getByLabel("Type de compte", { exact: true }).selectOption(type);
    if (custom) await dialog.getByLabel("Nom du type", { exact: true }).fill(custom);
    if (customKind) await dialog.getByLabel("C’est plutôt", { exact: true }).selectOption(customKind);
    // The balance comes with the account, dated today: one dialog, not two.
    await dialog.getByLabel("Solde actuel", { exact: true }).fill(amount);
    // Only an investment asks how its balance is valued.
    await expect(dialog.getByLabel("Ce que représente le solde", { exact: true })).toHaveCount(
      type === "Trading" || customKind === "investment" ? 1 : 0,
    );
    await dialog.getByRole("button", { name: "Enregistrer", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  };
  // Opens an account's detail (Actualiser, Modifier), unless it already is.
  const openAccount = async (name: string) => {
    const item = page.locator(".account-item", {
      has: page.locator(".account-row", { hasText: name }),
    });
    if (!(await item.evaluate((e) => (e as HTMLDetailsElement).open)))
      await item.locator(".account-row").click();
  };
  await addAccount("Poste 3a test", "3e pilier", "8295");
  await addAccount("Helvetia 3a test", "3e pilier", "5310");
  await addAccount("UBS Léna test", "__autre__", "11150", "Léna");
  await addAccount("Courant test", "Compte courant", "500");
  // Same custom type in lower case: one group, not two.
  await addAccount("Épargne Mia test", "__autre__", "300", "léna");
  await addAccount("Carte test", "Dette", "1000");
  // A custom type named like a preset, with another nature: the nature is the one chosen.
  await addAccount("Trading épargne test", "__autre__", "200", "trading", "savings");

  const group = (name: string) => page.locator(".account-group", { hasText: name });
  await expect(page.locator(".account-group .card-title")).toHaveText([
    "3e pilier",
    "Léna",
    "Compte courant",
    "Trading",
    "Dette",
  ]);
  await expect(group("3e pilier").locator(".account-group-total")).toHaveText(/^13\s?605\.00\s*CHF$/);
  await expect(group("3e pilier").locator(".account-item")).toHaveCount(2);
  await expect(group("Léna").locator(".account-item")).toHaveCount(2);
  await expect(group("Léna").locator(".account-group-total")).toHaveText(/^11\s?450\.00\s*CHF$/);
  await expect(group("Dette").locator(".account-group-total")).toHaveText(/^-1\s?000\.00\s*CHF$/);
  await expect(page.locator(".accounts-total-value")).toHaveText(/^24\s?755\.00\s*CHF$/);

  // Accueil: the same groups, largest first, with their share of the assets (a debt does not
  // inflate it: 13 605 / 25 755, not / 24 755).
  await nav.getByRole("button", { name: "Vue d’ensemble", exact: true }).click();
  const byType = page.locator(".card", { has: page.locator(".card-title", { hasText: "Patrimoine par type" }) });
  await expect(byType.locator(".row-title")).toHaveText([
    "3e pilier",
    "Léna",
    "Compte courant",
    "Trading",
    "Dette",
  ]);
  await expect(byType.locator(".row", { hasText: "3e pilier" })).toContainText("2 comptes");
  await expect(byType.locator(".row", { hasText: "3e pilier" })).toContainText("53 %");
  await expect(byType.locator(".row", { hasText: "Léna" }).locator(".row-value")).toHaveText(/^11\s?450\.00\s*CHF$/);

  // Saved again unchanged, the custom « trading » stays savings: never moved to Investissements.
  await nav.getByRole("button", { name: "Mes comptes", exact: true }).click();
  for (let i = 0; i < 2; i++) {
    await openAccount("Trading épargne test");
    await page.getByRole("button", { name: "Modifier Trading épargne test", exact: true }).click();
    const d = page.getByRole("dialog", { name: "Modifier Trading épargne test" });
    await expect(d.getByLabel("Type de compte", { exact: true })).toHaveValue("__autre__");
    await expect(d.getByLabel("C’est plutôt", { exact: true })).toHaveValue("savings");
    await d.getByRole("button", { name: "Enregistrer", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }
  await nav.getByRole("button", { name: "Investissements", exact: true }).click();
  await expect(page.getByText("Trading épargne test")).toHaveCount(0);

  // Reopening keeps the custom type.
  await nav.getByRole("button", { name: "Mes comptes", exact: true }).click();
  await openAccount("UBS Léna test");
  await page.getByRole("button", { name: "Modifier UBS Léna test", exact: true }).click();
  const reopened = page.getByRole("dialog", { name: "Modifier UBS Léna test" });
  await expect(reopened.getByLabel("Type de compte", { exact: true })).toHaveValue("__autre__");
  await expect(reopened.getByLabel("Nom du type", { exact: true })).toHaveValue("Léna");
  expect(errors).toEqual([]);
});

test("accounts: compact rows, balance with the account, all balances updated at once", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const nav = page.getByRole("navigation", { name: "Navigation principale", exact: true });
  await page.goto("/");
  await page.getByLabel("Phrase secrète", { exact: true }).fill("Exemple-test-Finance-soldes");
  await page.getByLabel("Confirmer la phrase secrète").fill("Exemple-test-Finance-soldes");
  await page.getByRole("button", { name: "Créer mon coffre" }).click();
  // The month changes nothing here: no month picker on Mes comptes, one on the Accueil.
  await expect(page.locator(".month-picker-trigger")).toHaveCount(1);
  await nav.getByRole("button", { name: "Mes comptes", exact: true }).click();
  await expect(page.locator(".month-picker-trigger")).toHaveCount(0);

  for (const [name, amount] of [["Courant soldes test", "1000"], ["Épargne soldes test", "2000"]]) {
    await page.getByRole("button", { name: "Ajouter", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Un compte" });
    await dialog.getByLabel("Nom du compte", { exact: true }).fill(name);
    await dialog.getByLabel("Solde actuel", { exact: true }).fill(amount);
    await dialog.getByRole("button", { name: "Enregistrer", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }
  const row = (name: string) => page.locator(".account-row", { hasText: name });
  await expect(row("Courant soldes test").locator(".row-value")).toHaveText(/^1\s?000\.00\s*CHF$/);
  // A balance of this month needs no date on its row.
  await expect(row("Courant soldes test")).not.toContainText(/\bau \d/);
  await expect(page.locator(".accounts-total-value")).toHaveText(/^3\s?000\.00\s*CHF$/);

  // All balances in one dialog: only the filled one changes; a wrong one names its account.
  await page.getByRole("button", { name: "Mettre à jour les soldes", exact: true }).click();
  let update = page.getByRole("dialog", { name: "Mettre à jour les soldes" });
  await expect(update).toContainText("Actuel 2 000.00 CHF");
  await update.getByLabel("Nouveau solde de Courant soldes test", { exact: true }).fill("douze");
  await update.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(update.getByRole("alert")).toContainText("Courant soldes test");
  await update.getByLabel("Nouveau solde de Courant soldes test", { exact: true }).fill("1500");
  await update.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(row("Courant soldes test").locator(".row-value")).toHaveText(/^1\s?500\.00\s*CHF$/);
  await expect(row("Épargne soldes test").locator(".row-value")).toHaveText(/^2\s?000\.00\s*CHF$/);
  await expect(page.locator(".accounts-total-value")).toHaveText(/^3\s?500\.00\s*CHF$/);

  // One field to update a single account; the history lists the newest balance first.
  await row("Courant soldes test").click();
  const item = page.locator(".account-item", { has: row("Courant soldes test") });
  await item
    .getByRole("button", { name: "Actualiser le solde de Courant soldes test", exact: true })
    .click();
  const balance = page.getByRole("dialog", { name: "Actualiser le solde" });
  await expect(balance.getByLabel("Date du solde", { exact: true })).toBeHidden();
  await balance.getByLabel("Nouveau solde", { exact: true }).fill("1600");
  await balance.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(row("Courant soldes test").locator(".row-value")).toHaveText(/^1\s?600\.00\s*CHF$/);
  await expect(item.locator(".account-history-line").first()).toContainText(/1\s?600\.00/);
  await expect(item.locator(".account-history-line")).toHaveCount(3);

  // A positions account whose position has no value: « — » on its row, like its type's total,
  // never its cash alone; the update dialog names that amount « Liquidités actuelles ».
  await page.getByRole("button", { name: "Ajouter", exact: true }).click();
  const broker = page.getByRole("dialog", { name: "Un compte" });
  await broker.getByLabel("Nom du compte", { exact: true }).fill("Courtier soldes test");
  await broker.getByLabel("Type de compte", { exact: true }).selectOption("Trading");
  await broker.getByLabel("Ce que représente le solde", { exact: true }).selectOption("components");
  await broker.getByLabel("Solde actuel", { exact: true }).fill("300");
  await broker.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await nav.getByRole("button", { name: "Investissements", exact: true }).click();
  await page.getByRole("button", { name: "Ajouter", exact: true }).click();
  const position = page.getByRole("dialog", { name: "Une position" });
  await position.getByLabel("Nom du titre", { exact: true }).fill("Titre sans valeur test");
  await position
    .getByLabel("Compte d’investissement", { exact: true })
    .selectOption({ label: "Courtier soldes test · CHF" });
  await position.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await nav.getByRole("button", { name: "Mes comptes", exact: true }).click();
  await expect(row("Courtier soldes test").locator(".row-value")).toHaveText("—");
  await expect(row("Courtier soldes test")).toContainText("À valoriser : position ou taux manquant");
  await page.getByRole("button", { name: "Mettre à jour les soldes", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Mettre à jour les soldes" })).toContainText(
    "Liquidités actuelles 300.00 CHF",
  );
  await page.keyboard.press("Escape");

  // Amounts hidden: the update dialog does not show current balances either.
  await page.getByRole("button", { name: /Masquer les montants/ }).click();
  await page.getByRole("button", { name: "Mettre à jour les soldes", exact: true }).click();
  update = page.getByRole("dialog", { name: "Mettre à jour les soldes" });
  await expect(update).not.toContainText("Actuel");
  expect(errors).toEqual([]);
});

test("simpler screens: add chooser, no ISO date on daily pages, uncounted accounts named", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const nav = page.getByRole("navigation", { name: "Navigation principale", exact: true });

  // Demo: no « 2026-09-28 » left on the pages used every day.
  await page.goto("/");
  await page.getByRole("button", { name: "Voir la démonstration" }).click();
  for (const name of ["Vue d’ensemble", "Mon mois", "Mes comptes", "Épargne et projets"]) {
    await nav.getByRole("button", { name, exact: true }).click();
    await expect(page.locator("main")).not.toContainText(/\d{4}-\d{2}-\d{2}/);
  }
  await page.getByRole("button", { name: "Ouvrir mon coffre" }).click();

  // An empty vault is not « Partiel »: it asks for a first account.
  await page.getByLabel("Phrase secrète", { exact: true }).fill("Exemple-test-Finance-simple");
  await page.getByLabel("Confirmer la phrase secrète").fill("Exemple-test-Finance-simple");
  await page.getByRole("button", { name: "Créer mon coffre" }).click();
  await nav.getByRole("button", { name: "Vue d’ensemble", exact: true }).click();
  const hero = page.locator(".hero-card");
  await expect(hero).toContainText("Ajoutez un compte pour voir votre patrimoine.");
  await expect(hero.locator(".tag")).toHaveCount(0);

  // Accueil « Ajouter »: choose what, then the matching short form. Closing it gives the
  // focus back to the button, as the editor does.
  const addButton = page.getByRole("button", { name: "Ajouter", exact: true });
  await addButton.click();
  await expect(page.getByRole("dialog", { name: "Ajouter" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(addButton).toBeFocused();
  await addButton.click();
  const chooser = page.getByRole("dialog", { name: "Ajouter" });
  await expect(chooser.locator(".add-choice")).toHaveText([
    /Une facture/,
    /Un abonnement/,
    /Un revenu/,
    /Une dépense/,
    /Un compte/,
  ]);
  await chooser.getByRole("button", { name: /Un compte/ }).click();
  const form = page.getByRole("dialog", { name: "Un compte" });
  await form.getByLabel("Nom du compte", { exact: true }).fill("Courtier USD test");
  await form.getByLabel("Solde actuel", { exact: true }).fill("100");
  await form.getByLabel("Devise", { exact: true }).selectOption("USD");
  await form.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // Not counted for lack of a rate: named, with its reason and the way to fix it.
  await expect(hero.locator(".tag")).toHaveText("Partiel");
  await expect(hero).toContainText("Non compté : Courtier USD test (taux USD → CHF manquant).");
  const attention = page.locator(".card", { has: page.locator(".card-title", { hasText: "À votre attention" }) });
  await expect(attention).toContainText("1 compte en devise sans taux de change");
  await hero.getByRole("button", { name: "Ajouter un taux de change", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Un taux de change" })).toBeVisible();
  await page.keyboard.press("Escape");

  // Réglages: nothing to add there.
  await nav.getByRole("button", { name: "Documents et réglages", exact: true }).click();
  await expect(page.getByRole("button", { name: "Ajouter", exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("Mon mois lists recurring income: received, left to receive, changed for one month", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const nav = page.getByRole("navigation", { name: "Navigation principale", exact: true });
  await page.goto("/");
  await page.getByLabel("Phrase secrète", { exact: true }).fill("Exemple-test-Finance-revenus");
  await page.getByLabel("Confirmer la phrase secrète").fill("Exemple-test-Finance-revenus");
  await page.getByRole("button", { name: "Créer mon coffre" }).click();
  await nav.getByRole("button", { name: "Mon mois", exact: true }).click();

  const incomeCard = page.locator(".card", {
    has: page.locator(".card-title", { hasText: "Mes revenus" }),
  });
  await incomeCard.getByRole("button", { name: "Ajouter un revenu", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Un revenu" });
  await expect(dialog.getByLabel("Jour du mois", { exact: true })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Tous les mois", exact: true })).toHaveAttribute("aria-pressed", "true");
  await dialog.getByLabel("Libellé", { exact: true }).fill("Prime test");
  await dialog.getByLabel("Montant", { exact: true }).fill("300");
  await dialog.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  const incomeRow = incomeCard.locator(".row", { hasText: "Prime test" });
  await expect(incomeRow).toContainText("300.00");
  await expect(incomeRow).toContainText("Tous les mois");
  await expect(incomeRow).toContainText("Pas encore reçu");
  await expect(
    page.locator(".stat-card", { hasText: "Reste à recevoir" }).locator(".metric-value"),
  ).toHaveText(/^300\.00\s*CHF$/);
  // The bills card never shows an income.
  const billsCard = page.locator(".card", {
    has: page.locator(".card-title", { hasText: "Mes factures" }),
  });
  await expect(billsCard.locator(".row", { hasText: "Prime test" })).toHaveCount(0);

  // This month only: 350, then received.
  await incomeRow.getByRole("button", { name: "Modifier Prime test", exact: true }).click();
  const edit = page.getByRole("dialog", { name: "Modifier Prime test" });
  await edit.getByLabel(/^Montant/).fill("350");
  await edit.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(incomeRow).toContainText("350.00");
  await incomeRow.getByRole("button", { name: "Reçu", exact: true }).click();
  // The action is gone (the row itself now reads "Reçu"), and nothing is left to receive.
  await expect(incomeRow.getByRole("button", { name: "Reçu", exact: true })).toHaveCount(0);
  await expect(incomeRow).toContainText("Reçu");
  await expect(
    page.locator(".stat-card", { hasText: "Reste à recevoir" }).locator(".metric-value"),
  ).toHaveText(/^0\.00\s*CHF$/);
  // Same single income, received at 350, once on the page; still there after reload and unlock.
  const monthRow = page.locator(".row", { hasText: "Prime test" });
  await expect(monthRow).toHaveCount(1);
  await expect(monthRow).toContainText("350.00");
  await page.reload();
  await page.getByLabel("Phrase secrète", { exact: true }).fill("Exemple-test-Finance-revenus");
  await page.getByRole("button", { name: "Déverrouiller", exact: true }).click();
  await nav.getByRole("button", { name: "Mon mois", exact: true }).click();
  await expect(monthRow).toHaveCount(1);
  await expect(incomeRow).toContainText("350.00");
  await expect(incomeRow.getByRole("button", { name: "Reçu", exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("one Mon mois page: four cards, bills and subscriptions together, one-off expenses apart, each operation once, four mobile tabs", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const monthNames = [
    "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
    "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre",
  ];
  const now = new Date();
  const goToMonth = async (offset: number) => {
    const target = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    await page.locator(".month-picker-trigger").click();
    const panelYear = Number(
      (await page.locator(".month-picker-panel").innerText()).match(/\b(20\d\d)\b/)![1],
    );
    for (let y = panelYear; y < target.getFullYear(); y++)
      await page.getByRole("button", { name: "Année suivante" }).click();
    for (let y = panelYear; y > target.getFullYear(); y--)
      await page.getByRole("button", { name: "Année précédente" }).click();
    await page
      .getByRole("button", {
        name: `${monthNames[target.getMonth()]} ${target.getFullYear()}`,
        exact: true,
      })
      .click();
  };
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthLabel = `${monthNames[lastMonth.getMonth()].toLowerCase()} ${lastMonth.getFullYear()}`;
  const nav = page.getByRole("navigation", { name: "Navigation principale", exact: true });
  await page.goto("/");
  await page.getByLabel("Phrase secrète", { exact: true }).fill("Exemple-test-Finance-mon-mois");
  await page.getByLabel("Confirmer la phrase secrète").fill("Exemple-test-Finance-mon-mois");
  await page.getByRole("button", { name: "Créer mon coffre" }).click();
  for (const name of ["Courant mois test", "Réserve mois test"]) {
    await nav.getByRole("button", { name: "Mes comptes", exact: true }).click();
    await page.getByRole("button", { name: "Ajouter", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Un compte" });
    await dialog.getByLabel("Nom du compte", { exact: true }).fill(name);
    await dialog.getByRole("button", { name: "Enregistrer", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }
  await nav.getByRole("button", { name: "Vue d’ensemble", exact: true }).click();

  // Six pages, no Factures or Abonnements page left.
  await expect(nav.getByRole("button")).toHaveText([
    "Vue d’ensemble",
    "Mon mois",
    "Mes comptes",
    "Épargne et projets",
    "Investissements",
    "Documents et réglages",
  ]);
  // « Voir tout » under « À régler » leads to Mon mois.
  await page
    .locator(".card", { has: page.locator(".card-title", { hasText: "À régler" }) })
    .getByRole("button", { name: "Voir tout" })
    .click();
  await expect(page.getByRole("heading", { name: "Mon mois", exact: true })).toBeVisible();

  const card = (title: string) =>
    page.locator(".card", { has: page.locator(".card-title", { hasText: title }) });
  const fill = async (
    button: string,
    label: string,
    amount: string,
    extra?: (d: Locator) => Promise<void>,
  ) => {
    await page.getByRole("button", { name: button, exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Libellé", { exact: true }).fill(label);
    await dialog.getByLabel("Montant", { exact: true }).fill(amount);
    if (extra) await extra(dialog);
    await dialog.getByRole("button", { name: "Enregistrer", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  };
  // Last month: the rent starts there, and last month's rent is only paid today (late).
  await goToMonth(-1);
  await fill("Ajouter une facture", "Loyer mois test", "1200");
  await card("Mes factures")
    .locator(".row", { hasText: "Loyer mois test" })
    .getByRole("button", { name: "Payer", exact: true })
    .click();
  await expect(card("Mes factures").locator(".row", { hasText: "Loyer mois test" })).toContainText("Payé");
  await goToMonth(0);
  await fill("Ajouter un revenu", "Salaire mois test", "3000");
  await fill("Ajouter une dépense", "Streaming mois test", "20", async (d) => {
    await d.getByRole("button", { name: "Tous les mois", exact: true }).click();
    await d.getByLabel("Nature", { exact: true }).selectOption("subscription");
  });
  await fill("Ajouter une dépense", "Restaurant mois test", "80");
  await fill("Ajouter", "Épargne mois test", "300", async (d) => {
    await d.locator('select[name="kind"]').selectOption("transfer");
    await d.getByLabel("Compte", { exact: true }).selectOption({ label: "Courant mois test · CHF" });
    await d
      .getByLabel("Compte destinataire", { exact: true })
      .selectOption({ label: "Réserve mois test · CHF" });
  });

  // The structure: « Il me reste », two indicators, then the four cards in this order.
  await expect(page.locator(".left-card")).toBeVisible();
  await expect(page.locator(".stat-grid .metric-label")).toHaveText([
    "Reste à payer",
    "Reste à recevoir",
  ]);
  await expect(page.locator("main .card-title")).toHaveText([
    "Mes revenus",
    "Mes factures",
    "Dépenses du mois",
    "Mis de côté",
  ]);
  // A bill and a subscription side by side in « Mes factures », the subscription tagged.
  const bills = card("Mes factures");
  const rentRow = bills.locator(".row", { hasText: "Loyer mois test" }).filter({ hasText: "Tous les mois" });
  const streamRow = bills.locator(".row", { hasText: "Streaming mois test" });
  await expect(rentRow).toHaveCount(1);
  await expect(rentRow.locator(".tag")).toHaveCount(0);
  await expect(rentRow).toContainText("Pas encore payé");
  await expect(streamRow).toHaveCount(1);
  await expect(streamRow.locator(".tag")).toHaveText("Abonnement");
  // Last month's rent, paid today, counts in this month's flow: shown once, as a payment for
  // last month (its month, never a day), next to this month's own rent.
  const lateRow = bills.locator(".row", { hasText: `pour ${lastMonthLabel}` });
  await expect(lateRow).toHaveCount(1);
  await expect(lateRow).toContainText("Loyer mois test");
  await expect(lateRow).toContainText("Payé");
  await expect(page.locator(".row", { hasText: "Loyer mois test" })).toHaveCount(2);
  // The one-off expense is apart, in « Dépenses du mois », and nothing recurring is there.
  await expect(card("Dépenses du mois").locator(".row-title")).toHaveText(["Restaurant mois test"]);
  await expect(card("Mes revenus").locator(".row-title")).toHaveText(["Salaire mois test"]);
  await expect(card("Mis de côté").locator(".row-title")).toHaveText(["Épargne mois test"]);
  // Each operation once on the page.
  for (const label of ["Salaire mois test", "Streaming mois test", "Restaurant mois test", "Épargne mois test"])
    await expect(page.locator(".row", { hasText: label })).toHaveCount(1);
  // The indicators match the rows: 1 200 + 20 + 80 to pay, 3 000 to receive; the late rent
  // is paid (in « Dépenses payées et prévues »), the transfer apart.
  const statValue = (label: string) =>
    page.locator(".stat-grid .stat-card", { hasText: label }).locator(".metric-value");
  await expect(statValue("Reste à payer")).toHaveText(/^1\s?300\.00\s*CHF$/);
  await expect(statValue("Reste à recevoir")).toHaveText(/^3\s?000\.00\s*CHF$/);
  await expect(
    page.locator(".left-card .left-breakdown div", { hasText: "Dépenses" }).locator("dd"),
  ).toHaveText(/^2\s?500\.00\s*CHF$/);
  // Paying this month's rent settles its own line: still two rent lines, never three.
  await rentRow.getByRole("button", { name: "Payer", exact: true }).click();
  await expect(rentRow).toContainText("Payé");
  await expect(page.locator(".row", { hasText: "Loyer mois test" })).toHaveCount(2);
  await expect(statValue("Reste à payer")).toHaveText(/^100\.00\s*CHF$/);
  // Last month still shows its rent once, paid.
  await goToMonth(-1);
  await expect(page.locator(".row", { hasText: "Loyer mois test" })).toHaveCount(1);
  await expect(page.locator(".row", { hasText: "Loyer mois test" })).toContainText("Payé");
  await goToMonth(0);

  // Phone: four tabs (Accueil, Mon mois, Comptes, Plus); the rest under « Plus ».
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileNav = page.getByRole("navigation", { name: "Navigation mobile" });
  await expect(mobileNav.getByRole("button")).toHaveText(["Accueil", "Mon mois", "Comptes", "Plus"]);
  for (const tab of await mobileNav.getByRole("button").all()) {
    const box = await tab.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  // A row without « Payer » keeps to two lines: at most 80 px.
  await card("Mes revenus")
    .locator(".row", { hasText: "Salaire mois test" })
    .getByRole("button", { name: "Reçu", exact: true })
    .click();
  await expect(
    card("Mes revenus")
      .locator(".row", { hasText: "Salaire mois test" })
      .getByRole("button", { name: "Reçu", exact: true }),
  ).toHaveCount(0);
  await expect(card("Mes revenus").locator(".row", { hasText: "Salaire mois test" })).toContainText(/Tous les mois\s·\sReçu/);
  const receivedBox = await card("Mes revenus")
    .locator(".row", { hasText: "Salaire mois test" })
    .boundingBox();
  expect(receivedBox).not.toBeNull();
  expect(receivedBox!.height).toBeLessThanOrEqual(81);
  await mobileNav.getByRole("button", { name: "Plus" }).click();
  await expect(page.locator(".mobile-more").getByRole("button")).toHaveText([
    "Épargne et projets",
    "Investissements",
    "Documents et réglages",
  ]);
  expect(errors).toEqual([]);
});

test("add a device with a code: the new device only needs the code and the passphrase", async ({
  page,
}) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const github = fakeGitHub();
  const token = `github_pat_${"EXEMPLEFICTIF".repeat(3)}`; // Synthetic, never a real token.
  const secret = "Exemple-test-Finance-lien-2026";
  const nav = (p: Page) =>
    p.getByRole("navigation", { name: "Navigation principale", exact: true });

  // Device A: vault, one operation, sync on, then « Ajouter un appareil ».
  await page.context().route("https://api.github.com/**", github.handle);
  await page.goto("/");
  await page.getByLabel("Phrase secrète", { exact: true }).fill(secret);
  await page.getByLabel("Confirmer la phrase secrète").fill(secret);
  await page.getByRole("button", { name: "Créer mon coffre" }).click();
  await nav(page).getByRole("button", { name: "Mon mois", exact: true }).click();
  await page.getByRole("button", { name: "Ajouter", exact: true }).click();
  const add = page.getByRole("dialog");
  await add.getByLabel("Libellé").fill("Achat lien test");
  await add.getByLabel("Montant", { exact: true }).fill("42");
  await add.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await nav(page).getByRole("button", { name: "Documents et réglages", exact: true }).click();
  const syncCard = page.locator(".card", {
    has: page.locator(".card-title", { hasText: "Synchronisation entre appareils" }),
  });
  await syncCard.getByLabel("3. Clé d’accès").fill(token);
  await syncCard.getByRole("button", { name: "Activer la synchronisation" }).click();
  await expect(syncCard.getByRole("status").first()).toContainText("Synchronisé");
  await syncCard.getByRole("button", { name: "Ajouter un appareil", exact: true }).click();
  const link = await syncCard.getByLabel("Code d’ajout d’appareil").inputValue();
  // The code alone, never an address: an opened URL would stay in the browser history.
  expect(link).toMatch(/^FIN1\.[A-Za-z0-9._-]+$/);
  expect(link).not.toContain(token);
  expect(link).not.toContain("exemple-test");
  expect(link).not.toContain("finance-coffre");

  // Device B (own storage): paste the code, type the passphrase — nothing else.
  const originA = new URL(page.url()).origin;
  const originB = originA.replace("127.0.0.1", "localhost");
  const pageB = await page.context().newPage();
  pageB.on("pageerror", (e) => errors.push(e.message));
  await pageB.goto(`${originB}/`);
  await pageB
    .getByRole("button", { name: "J’ai déjà un compte sur un autre appareil", exact: true })
    .click();
  await pageB.getByLabel("Code d’ajout", { exact: true }).fill(link);
  await pageB.getByLabel("Phrase secrète", { exact: true }).fill("phrase-incorrecte-test");
  await pageB.getByRole("button", { name: "Ajouter cet appareil", exact: true }).click();
  await expect(pageB.getByRole("alert")).toContainText("Phrase secrète incorrecte");
  await pageB.getByLabel("Phrase secrète", { exact: true }).fill(secret);
  await pageB.getByRole("button", { name: "Ajouter cet appareil", exact: true }).click();
  await nav(pageB).getByRole("button", { name: "Mon mois", exact: true }).click();
  await expect(pageB.getByText("Achat lien test", { exact: true })).toBeVisible();
  await pageB.close();

  expect(errors).toEqual([]);
});

test("quick unlock: Face ID or fingerprint opens the vault without typing the passphrase", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const secret = "Exemple-test-Finance-faceid";
  // WebAuthn needs a domain, not an IP: same server, reached as localhost.
  const origin = test.info().project.use.baseURL!.replace("127.0.0.1", "localhost");
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      ctap2Version: "ctap2_1",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      hasPrf: true,
      automaticPresenceSimulation: true,
    },
  });
  await page.goto(`${origin}/`);
  await page.getByLabel("Phrase secrète", { exact: true }).fill(secret);
  await page.getByLabel("Confirmer la phrase secrète").fill(secret);
  await page.getByRole("button", { name: "Créer mon coffre" }).click();
  await page
    .getByRole("navigation", { name: "Navigation principale", exact: true })
    .getByRole("button", { name: "Documents et réglages", exact: true })
    .click();
  const card = page.locator(".card", {
    has: page.locator(".card-title", { hasText: "Connexion rapide" }),
  });
  await card.getByLabel("Phrase secrète").fill(secret);
  await card.getByRole("button", { name: "Activer Face ID ou l’empreinte" }).click();
  await expect(card.getByRole("status")).toContainText("Activé sur cet appareil");
  expect(await page.evaluate(() => Object.values(localStorage).join(""))).not.toContain(secret);

  await page.getByRole("button", { name: "Verrouiller l’espace", exact: true }).click();
  await page
    .getByRole("button", { name: "Déverrouiller avec Face ID ou l’empreinte", exact: true })
    .click();
  // Back where it was locked, without typing anything.
  await expect(page.getByRole("heading", { name: "Documents et réglages", exact: true })).toBeVisible();

  // After a reload too, one touch is enough.
  await page.reload();
  await page
    .getByRole("button", { name: "Déverrouiller avec Face ID ou l’empreinte", exact: true })
    .click();
  await expect(page.getByRole("heading", { name: "Vue d’ensemble", exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
