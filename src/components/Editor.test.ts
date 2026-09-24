import { describe, expect, it } from "vitest";
import { transactionDateFields } from "./Editor";

// Le formulaire de récurrence enregistre désormais par `applySimpleEdit` (finance.ts), dont les
// tests couvrent la conservation de l'historique des montants.

// Ciblé sur le chemin exact emprunté par Editor.tsx en soumettant le formulaire d'opération
// (spec.type === "transaction") : transactionDateFields() est la fonction qui résout date/
// budgetMonth à partir du seul champ Mois de l'éditeur rapide et des valeurs portées par les
// champs (visibles ou cachés) avant la sauvegarde. L'éditeur complet ne passe jamais
// quick=true, donc les deux premiers cas couvrent le comportement inchangé, byte-for-byte,
// des soldes date/budgetMonth qu'il gère déjà lui-même via ses propres champs visibles.
describe("transactionDateFields (chemin de sauvegarde de l'éditeur d'opération)", () => {
  it("éditeur complet : renvoie toujours date/budgetMonth inchangés, quel que soit le champ mois", () => {
    expect(
      transactionDateFields(false, "2026-09", "2026-04-15", ""),
    ).toEqual({ date: "2026-04-15", budgetMonth: undefined });
    expect(
      transactionDateFields(false, "2026-09", "", "2026-04"),
    ).toEqual({ date: null, budgetMonth: "2026-04" });
    expect(transactionDateFields(false, "2026-09", "", "")).toEqual({
      date: null,
      budgetMonth: undefined,
    });
  });

  it("éditeur rapide, mois non modifié : préserve date/budgetMonth d'origine à l'identique", () => {
    // Origine datée précisément (jour réel connu) : le jour ne doit pas être perdu tant que
    // le mois affiché reste le même.
    expect(
      transactionDateFields(true, "2026-04", "2026-04-15", ""),
    ).toEqual({ date: "2026-04-15", budgetMonth: undefined });
    // Origine avec seulement un mois de budget (pas de jour connu) : reste tel quel.
    expect(
      transactionDateFields(true, "2026-04", "", "2026-04"),
    ).toEqual({ date: null, budgetMonth: "2026-04" });
  });

  it("éditeur rapide, mois modifié : efface la date précise plutôt que d'en inventer une, et budgetMonth porte le nouveau mois", () => {
    expect(
      transactionDateFields(true, "2026-05", "2026-04-15", ""),
    ).toEqual({ date: null, budgetMonth: "2026-05" });
    expect(
      transactionDateFields(true, "2026-06", "", "2026-04"),
    ).toEqual({ date: null, budgetMonth: "2026-06" });
  });

  it("éditeur rapide, aucune origine (nouvel enregistrement rare) : le mois choisi devient budgetMonth", () => {
    expect(transactionDateFields(true, "2026-07", "", "")).toEqual({
      date: null,
      budgetMonth: "2026-07",
    });
  });
});
