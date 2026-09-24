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
  await page.getByRole("button", { name: "Actualiser", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Solde observé").fill("1234.56");
  await dialog
    .getByRole("button", { name: "Enregistrer", exact: true })
    .click();
  await expect(page.locator(".balance")).toContainText("1");
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
    "Factures",
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
  await expect(
    page.locator('svg[aria-label="Répartition des actifs positifs"]'),
  ).toHaveCount(0);
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
  // Abonnements à 390 px : chaque onglet reste entier dans sa barre, elle-même dans l'écran.
  await page
    .getByRole("navigation", { name: "Navigation mobile" })
    .getByRole("button", { name: "Plus" })
    .click();
  await page
    .locator(".mobile-more")
    .getByRole("button", { name: "Abonnements", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Abonnements", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const subscriptionTabBars = await page.locator(".tab-bar").all();
  expect(subscriptionTabBars.length).toBeGreaterThan(0);
  for (const bar of subscriptionTabBars) {
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
  await dialog.getByLabel("Type", { exact: true }).selectOption("investment");
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
  // Created and edited from the dedicated Abonnements page, which owns recurrence
  // management; Mon mois only previews active recurrences and links out to it.
  await nav.getByRole("button", { name: "Abonnements", exact: true }).click();
  await page.getByRole("button", { name: "Ajouter", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Libellé", { exact: true }).fill("Assurance test");
  // Nature must survive a Type round trip: choosing "Charge" and then switching
  // Type to Revenu and back to Dépense must not silently fall back to "Abonnement".
  await dialog
    .getByLabel("Nature", { exact: true })
    .selectOption("bill");
  await dialog.getByLabel("Type", { exact: true }).selectOption("income");
  await dialog.getByLabel("Type", { exact: true }).selectOption("expense");
  await expect(dialog.getByLabel("Nature", { exact: true })).toHaveValue(
    "bill",
  );
  await dialog.getByLabel("Montant", { exact: true }).fill("45");
  await dialog
    .getByLabel("Compte", { exact: true })
    .selectOption({ label: "Compte principal test · CHF" });
  await expect(dialog.getByLabel("Devise", { exact: true })).toHaveValue(
    "CHF",
  );
  await dialog.getByLabel("Catégorie", { exact: true }).fill("Assurances");
  await dialog.getByLabel("Jour du mois", { exact: true }).fill("15");
  // A start date safely before this month's day 15 guarantees this month's occurrence
  // exists regardless of which day "today" actually is when the suite runs (defaulting
  // to today would often push the start past the 15th and skip this month entirely).
  await dialog.getByLabel("Début", { exact: true }).fill("2026-01-01");
  await dialog
    .getByRole("button", { name: "Enregistrer", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByText("Assurance test", { exact: false }).first(),
  ).toBeVisible();
  // Reopening confirms "bill" was actually saved, not just held in form state.
  await page
    .getByRole("button", { name: "Modifier Assurance test", exact: true })
    .click();
  dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Nature", { exact: true })).toHaveValue(
    "bill",
  );
  await dialog.getByRole("button", { name: "Fermer" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // 2bis) Statuts explicites : "Marquer payé" écrit directement, sans dialogue (exécution
  // instantanée, date de règlement fixée à aujourd'hui) ; "Remettre à payer" revient en
  // arrière sans effacer la trace du règlement précédent. Exercised from Mon mois' own
  // transactions list (the "flux réalisé" side), independent of the Abonnements page.
  await nav.getByRole("button", { name: "Mon mois", exact: true }).click();
  const occurrenceRow = page
    .locator(".row", { hasText: "Assurance test" })
    .filter({ hasNotText: "tous les" });
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
  // Settled row itself opens the full editor (row-main is clickable once settled) — confirms
  // the settlement date was really set to today, not left blank by the direct write.
  await occurrenceRow.click();
  dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("État", { exact: true })).toHaveValue("settled");
  await expect(
    dialog.getByLabel("Date de l’opération ou échéance", { exact: true }),
  ).not.toHaveValue("");
  await dialog.getByRole("button", { name: "Fermer" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  page.once("dialog", (d) => d.accept());
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
  // A transfer is neither income nor expense.
  await page.getByRole("button", { name: "Revenus", exact: true }).click();
  await expect(
    page.getByText("Virement voyage test", { exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Virements", exact: true }).click();
  await expect(
    page.getByText("Virement voyage test", { exact: true }),
  ).toBeVisible();

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

// abonnements.md, "Vérifications obligatoires": "Le parcours navigateur doit vérifier qu'un
// statut changé sur Abonnements met à jour Mon mois et l'Accueil après rechargement et
// déverrouillage, sans doublon." — exercised here specifically from the Abonnements page's own
// "Marquer payé" action, distinct from the equivalent action already covered on Mon mois by the
// "daily entries" test above.
test("subscriptions: a status change made on Abonnements updates Mon mois and Accueil, no duplicate, survives reload", async ({
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

  // Day 1, monthly, started well in the past: due every month regardless of run date.
  await nav.getByRole("button", { name: "Abonnements", exact: true }).click();
  await page.getByRole("button", { name: "Ajouter", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Libellé", { exact: true }).fill("Charge test abo");
  await dialog.getByLabel("Nature", { exact: true }).selectOption("bill");
  await dialog.getByLabel("Montant", { exact: true }).fill("77.70");
  await dialog
    .getByLabel("Compte", { exact: true })
    .selectOption({ label: "Compte abonnements test · CHF" });
  await dialog.getByLabel("Catégorie", { exact: true }).fill("Test");
  await dialog.getByLabel("Jour du mois", { exact: true }).fill("1");
  await dialog.getByLabel("Début", { exact: true }).fill("2020-01-01");
  await dialog
    .getByRole("button", { name: "Enregistrer", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // A single row per recurrence on Abonnements: cadence and status share it, unlike Mon mois'
  // separate "opérations" and "aperçu" rows, so no "tous les" filter is needed here.
  const subsRow = page.locator(".row", { hasText: "Charge test abo" });
  await expect(subsRow).toContainText("Pas encore payé");
  const statValue = (label: string) =>
    page.locator(".stat-card", { hasText: label }).locator(".metric-value");
  const resteDu = statValue("Reste dû");
  await expect(resteDu).toContainText("77.70");
  // Item 3: Abonnements' stat labels were simplified from denser cohort jargon — assert the
  // actual simplified French wording each figure sits under, not just the figures themselves.
  // "Charge test abo" is the only (active, expense) recurrence, due but not yet settled.
  await expect(statValue("Dû ce mois")).toContainText("77.70");
  await expect(statValue("Abonnements actifs")).toContainText("1");
  // The settled share is a progress bar under the "Réglé ce mois" figure (same subsSettledPct).
  const settledShare = page.getByRole("progressbar", { name: "Part réglée" });
  await expect(settledShare).toHaveCount(1);
  await expect(settledShare).toHaveAttribute("aria-valuenow", "0");

  // Mark it paid from Abonnements itself, not from Mon mois — writes directly, no dialog.
  await subsRow
    .getByRole("button", { name: "Payer", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // Same instant-write flash as Mon mois' rows (row-flash-positive), exercised here on
  // an Abonnements row specifically, per its own self-clearing onAnimationEnd.
  await expect(subsRow).toHaveClass(/row-flash-positive/);
  await expect(subsRow).toContainText("Payé");
  await expect(subsRow).not.toContainText("Pas encore payé");
  await expect(resteDu).toContainText("0.00");
  // Settling the recurrence-linked transaction feeds both the cohort's "Réglé ce mois" and
  // the realized-flow "Payé ce mois" / "Reçu ce mois" trio (recurringFlowSummary) — a distinct
  // calculation from cohortSummary above, also independently checked here.
  await expect(statValue("Réglé ce mois")).toContainText("77.70");
  await expect(settledShare).toHaveAttribute("aria-valuenow", "100");
  await expect(statValue("Payé ce mois")).toContainText("77.70");
  await expect(statValue("Reçu ce mois")).toContainText("0.00");
  await expect(subsRow).not.toHaveClass(/row-flash-positive/);

  // Mon mois: exactly one row for the occurrence itself (excluding the separate recurrence
  // preview row, which also mentions "tous les") — no duplicate transaction was created.
  await nav.getByRole("button", { name: "Mon mois", exact: true }).click();
  const monthOccurrenceRow = page
    .locator(".row", { hasText: "Charge test abo" })
    .filter({ hasNotText: "tous les" });
  await expect(monthOccurrenceRow).toHaveCount(1);
  await expect(monthOccurrenceRow).toContainText("Payé");
  // Item 4: "Le mouvement du mois" and "Projection nette" were removed from Mon mois (they
  // still exist on Accueil, checked just below) — confirm Mon mois genuinely lost them, not
  // merely that no earlier test happened to look for them here.
  const mouvementDuMoisHeading = page.getByRole("heading", {
    name: "Le mouvement du mois",
    exact: true,
  });
  const projectionNette = page.getByText("Projection nette du mois", { exact: true });
  await expect(mouvementDuMoisHeading).toHaveCount(0);
  await expect(projectionNette).toHaveCount(0);

  // Accueil: the settlement is reflected in the month's confirmed figures, and this is where
  // the two cards above actually still live.
  await nav.getByRole("button", { name: "Vue d’ensemble", exact: true }).click();
  const expensesConfirmed = page
    .locator(".metric", { hasText: "Dépenses confirmées" })
    .locator(".metric-value");
  await expect(expensesConfirmed).toContainText("77.70");
  await expect(mouvementDuMoisHeading).toBeVisible();
  await expect(projectionNette).toBeVisible();

  // Reload and unlock: everything above survives, still no duplicate.
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Ouvrir mon espace" }),
  ).toBeVisible();
  await page.getByLabel("Phrase secrète", { exact: true }).fill(subsPassphrase);
  await page
    .getByRole("button", { name: "Déverrouiller", exact: true })
    .click();
  // Overview's own <h1> reads "Une vue sur l'essentiel.", not "Vue d'ensemble" (see App.tsx's
  // page-title ternary) — lands there by default since `page` state resets to "overview" on
  // every fresh mount, unlock included.
  await expect(
    page.getByRole("heading", { name: "Une vue sur l’essentiel.", exact: true }),
  ).toBeVisible();
  await expect(expensesConfirmed).toContainText("77.70");
  await expect(mouvementDuMoisHeading).toBeVisible();
  await expect(projectionNette).toBeVisible();
  await nav.getByRole("button", { name: "Mon mois", exact: true }).click();
  await expect(monthOccurrenceRow).toHaveCount(1);
  await expect(monthOccurrenceRow).toContainText("Payé");
  await expect(mouvementDuMoisHeading).toHaveCount(0);
  await expect(projectionNette).toHaveCount(0);
  await nav.getByRole("button", { name: "Abonnements", exact: true }).click();
  await expect(subsRow).toContainText("Payé");
  await expect(resteDu).toContainText("0.00");

  expect(errors).toEqual([]);
});

test("Mon mois: reçu, facture, abonnement, virement — montant décroissant dans chaque groupe, bouton toujours aligné, montant coloré par nature", async ({
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

  // Two one-off, unpaid, PERSISTED transactions (they exist in data.transactions the moment
  // they're saved, whatever their status) — each therefore shows the "Modifier" pencil next to
  // its quick-settle button, unlike the two recurrence occurrences below (not yet materialized,
  // so no row to edit exists for them until settled).
  await nav.getByRole("button", { name: "Mon mois", exact: true }).click();
  async function newOperation(
    kind: "income" | "expense" | "transfer",
    label: string,
    amount: string,
  ) {
    await page.getByRole("button", { name: "Ajouter", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.locator('select[name="kind"]').selectOption(kind);
    await dialog.getByLabel("Libellé").fill(label);
    await dialog.getByLabel("Montant", { exact: true }).fill(amount);
    await dialog
      .getByLabel("Compte", { exact: true })
      .selectOption({ label: "Compte tri test · CHF" });
    if (kind === "transfer")
      await dialog
        .getByLabel("Compte destinataire", { exact: true })
        .selectOption({ label: "Compte tri destination · CHF" });
    // Status left at its default ("planned") — every row in this test stays unpaid, so the
    // status-group sort (existing, unchanged) never reorders them ahead of one another.
    await dialog
      .getByRole("button", { name: "Enregistrer", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }
  await newOperation("income", "Revenu test tri", "200");
  await newOperation("expense", "Facture ponctuelle test", "100");
  await newOperation("transfer", "Virement test tri", "75");

  // Two recurrences due this month, left unsettled — occurrenceDueDate generates a virtual,
  // unmaterialized transaction for each, shown on Mon mois alongside the persisted ones above.
  async function newRecurrence(nature: "bill" | "subscription", label: string, amount: string) {
    await nav.getByRole("button", { name: "Abonnements", exact: true }).click();
    await page.getByRole("button", { name: "Ajouter", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Libellé", { exact: true }).fill(label);
    await dialog.getByLabel("Nature", { exact: true }).selectOption(nature);
    await dialog.getByLabel("Montant", { exact: true }).fill(amount);
    await dialog
      .getByLabel("Compte", { exact: true })
      .selectOption({ label: "Compte tri test · CHF" });
    await dialog.getByLabel("Catégorie", { exact: true }).fill("Test tri");
    await dialog.getByLabel("Jour du mois", { exact: true }).fill("1");
    await dialog.getByLabel("Début", { exact: true }).fill("2020-01-01");
    await dialog
      .getByRole("button", { name: "Enregistrer", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }
  await newRecurrence("bill", "Charge récurrente test", "50");
  await newRecurrence("subscription", "Abo test tri", "30");

  await nav.getByRole("button", { name: "Mon mois", exact: true }).click();
  const operationsCard = page.locator(".card", {
    has: page.locator(".card-title", { hasText: "Les opérations" }),
  });
  await expect(operationsCard.locator(".row-title")).toHaveText([
    "Revenu test tri", // reçu (revenu) — seul de son groupe
    "Facture ponctuelle test", // facture, 100 > 50
    "Charge récurrente test", // facture, 50
    "Abo test tri", // abonnement — seul de son groupe
    "Virement test tri", // virement — toujours en dernier
  ]);

  // The persisted "Facture ponctuelle test" row has a leading "Modifier" pencil before its
  // "Payer" button; the virtual "Charge récurrente test" row has none. Both buttons must still
  // end at the exact same x — the real defect a user screenshot showed: the button used to
  // trail any icon instead of leading it, so its right edge shifted row to row.
  const pencilRowButton = operationsCard
    .locator(".row", { hasText: "Facture ponctuelle test" })
    .getByRole("button", { name: "Payer", exact: true });
  const noPencilRowButton = operationsCard
    .locator(".row", { hasText: "Charge récurrente test" })
    .getByRole("button", { name: "Payer", exact: true });
  const pencilBox = await pencilRowButton.boundingBox();
  const noPencilBox = await noPencilRowButton.boundingBox();
  if (!pencilBox || !noPencilBox) throw new Error("Payer button not found");
  expect(pencilBox.x + pencilBox.width).toBeCloseTo(
    noPencilBox.x + noPencilBox.width,
    0,
  );

  // The amount's class follows kind, not status: income reads soft green with "+", an expense
  // soft red, whether still due or already paid.
  await expect(
    operationsCard.locator(".row", { hasText: "Revenu test tri" }).locator(".row-value"),
  ).toHaveClass(/positive/);
  await expect(
    operationsCard
      .locator(".row", { hasText: "Facture ponctuelle test" })
      .locator(".row-value"),
  ).toHaveClass(/negative/);
  await expect(
    operationsCard
      .locator(".row", { hasText: "Virement test tri" })
      .locator(".row-value"),
  ).not.toHaveClass(/positive|negative/);

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
    await new Promise<void>((resolve) => server.close(() => resolve()));
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
    await new Promise<void>((resolve) => server.close(() => resolve()));
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
    await new Promise<void>((resolve) => server.close(() => resolve()));
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
    await new Promise<void>((resolve) => server.close(() => resolve()));
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

  // Operations only: Mon mois also lists the recurrence itself in its recurring-charges card.
  const operationsCard = page.locator(".card", {
    has: page.locator(".card-title", { hasText: "Les opérations" }),
  });
  const rows = operationsCard.locator(".row", { hasText: "Salaire mensuel test" });
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText("Reçu");

  await page.locator(".month-picker-trigger").click();
  if (nextIndex === 0) await page.getByRole("button", { name: "Année suivante" }).click();
  await page
    .getByRole("button", { name: `${monthNames[nextIndex]} ${nextYear}`, exact: true })
    .click();
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText("Pas encore reçu");

  await nav.getByRole("button", { name: "Abonnements", exact: true }).click();
  await expect(page.locator(".row", { hasText: "Salaire mensuel test" }).first()).toBeVisible();
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
    if (pathname === "/repos/exemple-test/finance-coffre-test")
      return json(200, { full_name: "exemple-test/finance-coffre-test", private: true });
    if (pathname === "/repos/exemple-test/finance-coffre-test/contents/finance-coffre.json") {
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
    await scope.getByLabel("Propriétaire GitHub").fill("exemple-test");
    await scope.getByLabel("Dépôt privé").fill("finance-coffre-test");
    await scope.getByLabel("Jeton d’accès").fill(token);
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
  await pageB.getByRole("button", { name: "Ouvrir depuis GitHub", exact: true }).click();
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
    await card.getByLabel("Propriétaire GitHub").fill("exemple-test");
    await card.getByLabel("Dépôt privé").fill("finance-coffre-test");
    await card.getByLabel("Jeton d’accès").fill(token);
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

test("bills: a monthly bill shows on Factures and Mon mois; a small change applies to one month or from a month on", async ({
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
  await nav.getByRole("button", { name: "Factures", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Factures", exact: true })).toBeVisible();

  // Added from Factures: the editor is already set to a bill.
  await page.getByRole("button", { name: "Ajouter", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "Une facture" });
  await expect(dialog.getByLabel("Nature", { exact: true })).toHaveValue("bill");
  await dialog.getByLabel("Libellé", { exact: true }).fill("Électricité test");
  await dialog.getByLabel("Montant", { exact: true }).fill("80");
  await dialog.getByLabel("Jour du mois", { exact: true }).fill("5");
  await dialog.getByLabel("Début", { exact: true }).fill(`${now.getFullYear() - 1}-01-01`);
  await dialog.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const billRow = page.locator(".row", { hasText: "Électricité test" });
  await expect(billRow).toHaveCount(1);
  await expect(billRow).toContainText("80.00");
  await expect(billRow).toContainText("Pas encore payé");

  // This month only: 85 here, the usual 80 elsewhere.
  await page.getByRole("button", { name: "Modifier Électricité test", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Modifier Électricité test" });
  await expect(dialog.getByRole("button", { name: "Ce mois seulement", exact: true })).toHaveAttribute("aria-pressed", "true");
  await dialog.getByLabel(/^Montant/).fill("85");
  await dialog.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(billRow).toContainText("85.00");
  await expect(billRow).toContainText("montant modifié ce mois");
  await expect(page.locator(".stat-card", { hasText: "Factures de" })).toContainText("85.00");

  // Mon mois shows the same single occurrence at 85.
  await nav.getByRole("button", { name: "Mon mois", exact: true }).click();
  const operations = page.locator(".card", {
    has: page.locator(".card-title", { hasText: "Les opérations" }),
  });
  const monthRow = operations.locator(".row", { hasText: "Électricité test" });
  await expect(monthRow).toHaveCount(1);
  await expect(monthRow).toContainText("85.00");

  // Next month keeps the usual amount; from there on, 90.
  await nav.getByRole("button", { name: "Factures", exact: true }).click();
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
  await expect(billRow).toContainText("Payé");
  await expect(page.locator(".stat-card", { hasText: "Reste à payer" })).toContainText("0.00");
  await nav.getByRole("button", { name: "Mon mois", exact: true }).click();
  await expect(monthRow).toHaveCount(1);
  await expect(monthRow).toContainText("85.00");

  // Everything survives a reload and unlock.
  await page.reload();
  await page.getByLabel("Phrase secrète", { exact: true }).fill("Exemple-test-Finance-factures");
  await page.getByRole("button", { name: "Déverrouiller", exact: true }).click();
  await nav.getByRole("button", { name: "Factures", exact: true }).click();
  await expect(billRow).toContainText("85.00");
  await expect(billRow).toContainText("Payé");
  await goToMonth(1);
  await expect(billRow).toContainText("100.00");
  expect(errors).toEqual([]);
});

test("bills page also lists recurring income: received, left to receive, changed for one month", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const nav = page.getByRole("navigation", { name: "Navigation principale", exact: true });
  const now = new Date();
  await page.goto("/");
  await page.getByLabel("Phrase secrète", { exact: true }).fill("Exemple-test-Finance-revenus");
  await page.getByLabel("Confirmer la phrase secrète").fill("Exemple-test-Finance-revenus");
  await page.getByRole("button", { name: "Créer mon coffre" }).click();
  await nav.getByRole("button", { name: "Factures", exact: true }).click();

  const incomeCard = page.locator(".card", {
    has: page.locator(".card-title", { hasText: "Mes revenus" }),
  });
  await incomeCard.getByRole("button", { name: "Ajouter un revenu", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Un revenu" });
  await expect(dialog.getByLabel("Type", { exact: true })).toHaveValue("income");
  await dialog.getByLabel("Libellé", { exact: true }).fill("Prime test");
  await dialog.getByLabel("Montant", { exact: true }).fill("300");
  await dialog.getByLabel("Jour du mois", { exact: true }).fill("1");
  await dialog.getByLabel("Début", { exact: true }).fill(`${now.getFullYear() - 1}-01-01`);
  await dialog.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  const incomeRow = incomeCard.locator(".row", { hasText: "Prime test" });
  await expect(incomeRow).toContainText("300.00");
  await expect(incomeRow).toContainText("Pas encore reçu");
  await expect(page.locator(".stat-card", { hasText: "Revenus de" })).toContainText("300.00");
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
  await expect(incomeRow).toContainText("Reçu");
  await expect(page.locator(".stat-card", { hasText: "Reste à recevoir" })).toContainText("0.00");
  expect(errors).toEqual([]);
});
