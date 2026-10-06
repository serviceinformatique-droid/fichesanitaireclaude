#!/bin/bash
# ============================================================================
# patch-pdf-sante.sh  -  build pdf-sante-20261006
# Portail Fiche Sanitaire de Liaison - Voyages scolaires (NDM)
#
# PDF ARCHIVE SUR LE SERVEUR (fiches-pdf/<Classe>/<NOM_Prenom>.pdf) : le regime alimentaire et
# la sante passent EN GRAND, comme sur la fiche imprimee par les parents, en gardant la mise en
# page soignee du PDF archive :
#  - RUBRIQUE 4 : grand bandeau orange "REGIME OU ALLERGIE ACTIVE", deux grandes cartes :
#      regime (grande pastille "SANS PORC", "VEGETARIEN"... + precisions) et allergie
#      alimentaire (grand bloc rouge, texte blanc) ;
#  - RUBRIQUE 3 : traitement medical (pastille OUI/NON + details), PAI (bloc rouge,
#      "OUI - PROTOCOLE ACTIF", pathologie, conduite d'urgence, pieces jointes), allergies en
#      4 grosses cases (OUI en rouge), cause et conduite a tenir, antecedents, difficultes de sante ;
#  - tous les textes passent a la ligne (avant : texte coupe ou deborde hors de la page) ;
#  - saut de page automatique si la fiche est tres complete, numerotation "page 1/2" ;
#  - un regime "aucun" n'est plus considere comme un regime particulier ;
#  - symboles non pris en charge par le PDF (⚠, ★) retires.
# Les PDF DEJA archives sont refaits par le bouton "Regenerer les PDF de toutes les fiches
# completes" (Administration > Etablissement scolaire).
#
# A DEPOSER avec FileZilla dans : /root/
# A EXECUTER :  chmod +x /root/patch-pdf-sante.sh && /root/patch-pdf-sante.sh
# ============================================================================
set -e

APP_DIR="${APP_DIR:-/opt/fichesanitaire-voyages}"
BUILD="pdf-sante-20261006"
BACKUP_DIR="$APP_DIR/backup-avant-$BUILD"
FILES="src/utils/pdfGenerator.ts"
TMP="$(mktemp -d)"

PATCHING=0
cleanup() {
  local rc=$?
  if [ "$rc" -ne 0 ] && [ "$PATCHING" = "1" ]; then
    echo ""
    echo "!!! ERREUR pendant le patch : restauration automatique des fichiers d'origine ..."
    for f in $FILES; do cp -p "$BACKUP_DIR/$f" "$APP_DIR/$f"; done
    echo "!!! Fichiers d'origine restaures : aucune modification n'a ete conservee."
    echo "!!! Envoyez le message d'erreur ci-dessus pour obtenir un script corrige."
  fi
  rm -rf "$TMP"
}
trap cleanup EXIT

echo ">>> Patch $BUILD sur $APP_DIR"

for f in $FILES; do
  [ -f "$APP_DIR/$f" ] || { echo "ERREUR : $APP_DIR/$f introuvable."; exit 1; }
done
command -v perl >/dev/null || { echo "ERREUR : perl est requis (apt install -y perl)."; exit 1; }

PDF="$APP_DIR/src/utils/pdfGenerator.ts"

if grep -q "pdf-sante-20261006" "$PDF"; then
  echo ">>> Patch deja applique. Rien a faire."
  exit 0
fi

# --- Fonctions utilitaires -------------------------------------------------
count_occ() { OLD="$2" perl -0777 -ne 'my $c = () = /\Q$ENV{OLD}\E/g; print $c' "$1"; }

replace_once() { # fichier  ancien_texte  nouveau_texte
  local file="$1" old="$2" new="$3" n
  n="$(count_occ "$file" "$old")"
  [ "$n" = "1" ] || { echo "ERREUR : repere trouve $n fois dans $file (attendu : 1) :"; echo "$old" | head -3; exit 1; }
  OLD="$old" NEW="$new" perl -0777 -i -pe 's/\Q$ENV{OLD}\E/$ENV{NEW}/' "$file"
}

# --- 1. Sauvegarde ----------------------------------------------------------
echo ">>> Sauvegarde dans $BACKUP_DIR ..."
for f in $FILES; do
  mkdir -p "$BACKUP_DIR/$(dirname "$f")"
  cp -p "$APP_DIR/$f" "$BACKUP_DIR/$f"
done
PATCHING=1

# --- 2. Modifications ---------------------------------------------------------
echo ">>> Modification de src/utils/pdfGenerator.ts ..."
cat > "$TMP/e1_old.txt" << 'PSEOF_X'
    // Section title helper
    const drawSectionTitle = (title: string, subtitle?: string) => {
      doc.setFillColor(30, 58, 138);
PSEOF_X
cat > "$TMP/e1_new.txt" << 'PSEOF_X'
    // --- build pdf-sante-20261006 : aides de mise en page (saut de page, texte à la ligne, pastilles) ---
    const PAGE_H = 297;
    const BOTTOM_MARGIN = 14;
    const newPage = () => {
      doc.addPage();
      y = 8;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7);
      doc.setTextColor(90, 100, 115);
      doc.text(
        `FICHE SANITAIRE DE LIAISON — ${cerfa.identity?.lastName || ''} ${cerfa.identity?.firstName || ''} (suite)`,
        margin,
        y
      );
      y += 5;
    };
    const ensureSpace = (h: number) => {
      if (y + h > PAGE_H - BOTTOM_MARGIN) newPage();
    };
    const lineMm = (pt: number) => pt * 0.3528 * 1.28;
    const wrapLines = (text: string, width: number, pt: number, style: 'normal' | 'bold' | 'italic' = 'normal'): string[] => {
      doc.setFont('helvetica', style);
      doc.setFontSize(pt);
      return doc.splitTextToSize(String(text || ''), width) as string[];
    };
    const drawPill = (
      label: string,
      xRight: number,
      yTop: number,
      h: number,
      fill: [number, number, number],
      fg: [number, number, number],
      pt: number
    ) => {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(pt);
      const w = doc.getTextWidth(label) + 8;
      doc.setFillColor(fill[0], fill[1], fill[2]);
      doc.roundedRect(xRight - w, yTop, w, h, h / 2, h / 2, 'F');
      doc.setTextColor(fg[0], fg[1], fg[2]);
      doc.text(label, xRight - w / 2, yTop + h / 2 + pt * 0.3528 * 0.34, { align: 'center' });
    };
    const drawBox = (h: number, fill: [number, number, number], border: [number, number, number], x = margin, w = contentWidth) => {
      doc.setFillColor(fill[0], fill[1], fill[2]);
      doc.setDrawColor(border[0], border[1], border[2]);
      doc.setLineWidth(0.35);
      doc.roundedRect(x, y, w, h, 1.5, 1.5, 'FD');
    };

    // Section title helper
    const drawSectionTitle = (title: string, subtitle?: string) => {
      ensureSpace(34);
      doc.setFillColor(30, 58, 138);
PSEOF_X
replace_once "$PDF" "$(cat "$TMP/e1_old.txt")" "$(cat "$TMP/e1_new.txt")"

cat > "$TMP/e2_old.txt" << 'PSEOF_X'
    // --- RUBRIQUE 3 : RENSEIGNEMENTS MÉDICAUX & P.A.I. ---
    drawSectionTitle('RUBRIQUE 3 — RENSEIGNEMENTS MÉDICAUX & P.A.I.');

    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(203, 213, 225);
    doc.rect(margin, y, contentWidth, 21, 'FD');

    // Row 1: PAI
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    if (cerfa.medicalInfo?.hasPai) {
      doc.setTextColor(185, 28, 28);
      doc.text(`PROJET D ACCUEIL INDIVIDUALISÉ (PAI) : OUI — PROTOCOLE ACTIF`, margin + 3, y + 4.2);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(60, 60, 60);
      const paiDocNames = cerfa.documents?.filter((d) => d.type === 'pai').map((d) => d.fileName).join(', ');
      doc.text(
        `Détails : ${cerfa.medicalInfo.paiDetails || 'Protocole d urgence établi'}${paiDocNames ? ` (Doc joint : ${paiDocNames})` : ''}`,
        margin + 85,
        y + 4.2
      );
    } else {
      doc.setTextColor(30, 41, 59);
      doc.text(`PROJET D ACCUEIL INDIVIDUALISÉ (PAI) : NON`, margin + 3, y + 4.2);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(100, 100, 100);
      doc.text(`(Aucun protocole médical d urgence requis pour cet élève)`, margin + 70, y + 4.2);
    }

    // Row 2: Traitement médical
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(30, 41, 59);
    doc.text('Traitement médical régulier :', margin + 3, y + 8.5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(60, 60, 60);
    doc.text(
      cerfa.medicalInfo?.hasMedicalTreatment
        ? `OUI : ${cerfa.medicalInfo.treatmentDetails || 'Selon posologie'} (Ordonnance fournie : ${cerfa.medicalInfo.hasPrescriptionAttached ? 'Oui' : 'Non'})`
        : 'NON — Aucun traitement régulier',
      margin + 45,
      y + 8.5
    );

    // Row 3: Allergies médicales (Mis en valeur avec fond ou couleur d'alerte si présente)
    const hasMedAllergies = Boolean(
      cerfa.medicalInfo?.allergies?.asthme ||
      cerfa.medicalInfo?.allergies?.medicamenteuses ||
      cerfa.medicalInfo?.allergies?.autres
    );
    if (hasMedAllergies) {
      // Highlight banner for medical allergies
      doc.setFillColor(254, 242, 242);
      doc.rect(margin + 1, y + 10.5, contentWidth - 2, 4.8, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(185, 28, 28);
      doc.text('⚠ ALLERGIES MÉDICALES :', margin + 3, y + 13.8);
    } else {
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(30, 41, 59);
      doc.text('Allergies médicales :', margin + 3, y + 13.8);
    }

    doc.setFont('helvetica', 'normal');
    const allgList = [
      cerfa.medicalInfo?.allergies?.asthme ? 'Asthme' : null,
      cerfa.medicalInfo?.allergies?.medicamenteuses ? 'Médicamenteuses' : null,
      cerfa.medicalInfo?.allergies?.autres ? cerfa.medicalInfo.allergies.autres : null,
    ].filter(Boolean);
    const allgStr = allgList.length > 0 ? allgList.join(', ') : 'Aucune allergie médicale signalée';
    const actionStr = cerfa.medicalInfo?.allergyCauseAndAction ? ` | Conduite : ${cerfa.medicalInfo.allergyCauseAndAction}` : '';
    if (hasMedAllergies) {
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(153, 27, 27);
    } else {
      doc.setTextColor(60, 60, 60);
    }
    doc.text(`${allgStr}${actionStr}`, margin + 42, y + 13.8);

    // Row 4: Maladies infantiles & difficultés
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(30, 41, 59);
    doc.text('Antécédents & difficultés :', margin + 3, y + 18);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(60, 60, 60);
    const checkedAntecedents = cerfa.medicalInfo?.antecedents
      ? Object.entries(cerfa.medicalInfo.antecedents)
          .filter(([_, val]) => Boolean(val))
          .map(([key]) => key.charAt(0).toUpperCase() + key.slice(1))
      : [];
    const anteText = checkedAntecedents.length > 0 ? checkedAntecedents.join(', ') : 'R.A.S.';
    const diffText = cerfa.medicalInfo?.healthDifficulties ? ` | Difficultés : ${cerfa.medicalInfo.healthDifficulties}` : '';
    doc.text(`${anteText}${diffText}`, margin + 42, y + 18);

    y += 23;

    // --- RUBRIQUE 4 : ALLERGIES ALIMENTAIRES & RÉGIME ALIMENTAIRE (FORTEMENT MIS EN VALEUR) ---
    drawSectionTitle('RUBRIQUE 4 — RÉGIME ALIMENTAIRE & ALLERGIES ALIMENTAIRES');

    const hasFoodAllergy = Boolean(cerfa.medicalInfo?.allergies?.alimentaires);
    const isRestrictedDiet = cerfa.structuredDiet?.category && cerfa.structuredDiet.category !== 'standard';

    // Highlighted background box: amber/orange if restriction/allergy, soft slate if standard
    if (hasFoodAllergy || isRestrictedDiet) {
      doc.setFillColor(254, 243, 199); // Amber highlight
      doc.setDrawColor(245, 158, 11);
    } else {
      doc.setFillColor(248, 250, 252);
      doc.setDrawColor(203, 213, 225);
    }
    doc.rect(margin, y, contentWidth, 16, 'FD');

    // Row 1: Structured Diet (Prominent)
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    if (isRestrictedDiet) {
      doc.setTextColor(180, 83, 9); // Amber-800
      doc.text('★ RÉGIME ALIMENTAIRE :', margin + 3, y + 5);
    } else {
      doc.setTextColor(30, 41, 59);
      doc.text('Régime alimentaire sélectionné :', margin + 3, y + 5);
    }

    doc.setFont('helvetica', isRestrictedDiet ? 'bold' : 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(isRestrictedDiet ? 146 : 60, isRestrictedDiet ? 64 : 60, isRestrictedDiet ? 14 : 60);
    const dietLabels: Record<string, string> = {
      standard: 'Standard / Sans restriction',
      sans_porc: 'SANS PORC',
      vegetarien: 'VÉGÉTARIEN',
    };
    const dietCat = cerfa.structuredDiet?.category || 'standard';
    const dietText = `${dietLabels[dietCat] || dietCat.toUpperCase()}${cerfa.structuredDiet?.details ? ` (Précisions : ${cerfa.structuredDiet.details})` : ''}`;
    doc.text(dietText, margin + 52, y + 5);

    // Row 2: Food allergy
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    if (hasFoodAllergy) {
      doc.setTextColor(185, 28, 28);
      doc.text('⚠ ALLERGIE ALIMENTAIRE & ÉVICTIONS :', margin + 3, y + 11);
    } else {
      doc.setTextColor(30, 41, 59);
      doc.text('Allergie alimentaire & Évictions :', margin + 3, y + 11);
    }

    doc.setFont('helvetica', hasFoodAllergy ? 'bold' : 'normal');
    doc.setTextColor(hasFoodAllergy ? 185 : 60, hasFoodAllergy ? 28 : 60, hasFoodAllergy ? 28 : 60);
    const foodDesc = hasFoodAllergy
      ? `OUI — ${cerfa.parentRecommendations || 'Allergie alimentaire déclarée (consulter PAI / protocole)'}`
      : 'NON — Aucune allergie alimentaire déclarée';
    doc.text(foodDesc, margin + 52, y + 11);

    y += 18;


PSEOF_X
cat > "$TMP/e2_new.txt" << 'PSEOF_X'
    // --- RUBRIQUE 3 : RENSEIGNEMENTS MÉDICAUX & P.A.I. (grands blocs lisibles, build pdf-sante-20261006) ---
    drawSectionTitle('RUBRIQUE 3 — RENSEIGNEMENTS MÉDICAUX & P.A.I.');
    const mi: any = cerfa.medicalInfo || {};
    const innerW = contentWidth - 8;
    const antecedentLabels: Record<string, string> = {
      rubeole: 'Rubéole',
      varicelle: 'Varicelle',
      angines: 'Angines',
      rhumatismes: 'Rhumatismes',
      scarlatine: 'Scarlatine',
      coqueluche: 'Coqueluche',
      otites: 'Otites',
      asthme: 'Asthme',
      rougeole: 'Rougeole',
      oreillons: 'Oreillons',
    };
    const capitalize = (v: string) => antecedentLabels[v] || v.charAt(0).toUpperCase() + v.slice(1);

    // 3a. Traitement médical
    {
      const hasTreat = Boolean(mi.hasMedicalTreatment);
      const treatLines = hasTreat ? wrapLines(mi.treatmentDetails || 'Selon posologie (voir ordonnance)', innerW, 10, 'bold') : [];
      const h = 10 + (hasTreat ? 4.5 + treatLines.length * lineMm(10) + 5 : 0);
      ensureSpace(h + 2);
      drawBox(h, hasTreat ? [255, 251, 235] : [248, 250, 252], hasTreat ? [245, 158, 11] : [203, 213, 225]);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(30, 41, 59);
      doc.text("L'ENFANT SUIT-IL UN TRAITEMENT MÉDICAL ?", margin + 4, y + 6.2);
      drawPill(hasTreat ? 'OUI' : 'NON', margin + contentWidth - 4, y + 2.2, 6.2, hasTreat ? [217, 119, 6] : [100, 116, 139], [255, 255, 255], 10);
      if (hasTreat) {
        doc.setFont('helvetica', 'italic');
        doc.setFontSize(7);
        doc.setTextColor(120, 113, 108);
        doc.text('Détails du traitement prescrit :', margin + 4, y + 11.5);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        doc.setTextColor(120, 53, 15);
        doc.text(treatLines, margin + 4, y + 16);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.5);
        doc.setTextColor(87, 83, 78);
        doc.text(
          `Ordonnance médicale jointe au dossier : ${mi.hasPrescriptionAttached ? 'OUI' : 'NON'}`,
          margin + 4,
          y + h - 2.2
        );
      }
      y += h + 2.5;
    }

    // 3b. Projet d'Accueil Individualisé (P.A.I.)
    {
      const pai = Boolean(mi.hasPai);
      if (pai) {
        const paiDocs = (cerfa.documents || [])
          .filter((d) => d.type === 'pai')
          .map((d) => d.fileName || d.name)
          .filter(Boolean)
          .join(', ');
        const paiLines = wrapLines(mi.paiDetails || "Protocole d'urgence établi (voir la pièce jointe)", innerW, 10.5, 'bold');
        const docLines = paiDocs ? wrapLines(`Pièce(s) jointe(s) PAI : ${paiDocs}`, innerW, 7.5) : [];
        const h = 15.5 + paiLines.length * lineMm(10.5) + (docLines.length ? docLines.length * lineMm(7.5) + 2 : 0);
        ensureSpace(h + 2);
        drawBox(h, [254, 242, 242], [220, 38, 38]);
        doc.setFillColor(220, 38, 38);
        doc.rect(margin, y + 1.5, 1.6, h - 3, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9);
        doc.setTextColor(127, 29, 29);
        doc.text("PROJET D'ACCUEIL INDIVIDUALISÉ (P.A.I.)", margin + 4, y + 6.2);
        drawPill('OUI — PROTOCOLE ACTIF', margin + contentWidth - 4, y + 2, 6.6, [220, 38, 38], [255, 255, 255], 10);
        doc.setFont('helvetica', 'italic');
        doc.setFontSize(7);
        doc.setTextColor(120, 113, 108);
        doc.text("Pathologie et conduite d'urgence PAI :", margin + 4, y + 11.8);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10.5);
        doc.setTextColor(153, 27, 27);
        doc.text(paiLines, margin + 4, y + 16.6);
        if (docLines.length) {
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(7.5);
          doc.setTextColor(87, 83, 78);
          doc.text(docLines, margin + 4, y + 16.6 + paiLines.length * lineMm(10.5) + 1.2);
        }
        y += h + 2.5;
      } else {
        ensureSpace(10);
        drawBox(7.5, [248, 250, 252], [203, 213, 225]);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        doc.setTextColor(51, 65, 85);
        doc.text("PROJET D'ACCUEIL INDIVIDUALISÉ (P.A.I.) : NON", margin + 4, y + 4.9);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(100, 116, 139);
        doc.text("Aucun protocole médical d'urgence requis pour cet élève", margin + 82, y + 4.9);
        y += 10;
      }
    }

    // 3c. Allergies (4 cases bien visibles) + cause et conduite à tenir
    {
      const al: any = mi.allergies || {};
      const cells: [string, any, boolean][] = [
        ['ASTHME', al.asthme, false],
        ['MÉDICAMENTEUSES', al.medicamenteuses, false],
        ['ALIMENTAIRES', al.alimentaires, false],
        ['AUTRES', al.autres, true],
      ];
      const gap = 2;
      const cw = (contentWidth - gap * 3) / 4;
      const autresLines = al.autres ? wrapLines(String(al.autres), cw - 6, 8.5, 'bold') : [];
      const ch = Math.max(15.5, 9 + autresLines.length * lineMm(8.5));
      ensureSpace(ch + 3);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7);
      doc.setTextColor(51, 65, 85);
      doc.text('ALLERGIES', margin, y + 2.6);
      y += 4;
      cells.forEach(([label, val, isText], i) => {
        const x = margin + i * (cw + gap);
        const on = Boolean(val);
        doc.setFillColor(on ? 254 : 248, on ? 226 : 250, on ? 226 : 252);
        doc.setDrawColor(on ? 220 : 203, on ? 38 : 213, on ? 38 : 225);
        doc.setLineWidth(on ? 0.6 : 0.3);
        doc.roundedRect(x, y, cw, ch, 1.5, 1.5, 'FD');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(6.8);
        doc.setTextColor(100, 116, 139);
        doc.text(label, x + 3, y + 4.4);
        if (isText && on) {
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(8.5);
          doc.setTextColor(185, 28, 28);
          doc.text(autresLines, x + 3, y + 9.4);
        } else {
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(15);
          if (on) doc.setTextColor(185, 28, 28);
          else doc.setTextColor(148, 163, 184);
          doc.text(on ? 'OUI' : 'NON', x + 3, y + 12.4);
        }
      });
      y += ch + 2.5;

      const anyAllergy = Boolean(al.asthme || al.medicamenteuses || al.alimentaires || al.autres);
      const cause = String(mi.allergyCauseAndAction || '').trim();
      if (anyAllergy || cause) {
        const cl = wrapLines(cause || "À préciser : cause de l'allergie et conduite à tenir non renseignées", innerW, 10, 'bold');
        const h = 10.5 + cl.length * lineMm(10);
        ensureSpace(h + 2);
        drawBox(h, [254, 242, 242], [252, 165, 165]);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7.5);
        doc.setTextColor(153, 27, 27);
        doc.text("CAUSE DE L'ALLERGIE ET CONDUITE À TENIR :", margin + 4, y + 5);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);
        doc.setTextColor(87, 83, 78);
        doc.text(
          `Automédication signalée : ${mi.isSelfMedicationReported ? 'OUI' : 'NON'}`,
          margin + contentWidth - 4,
          y + 5,
          { align: 'right' }
        );
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        doc.setTextColor(127, 29, 29);
        doc.text(cl, margin + 4, y + 10.2);
        y += h + 2.5;
      }
    }

    // 3d. Antécédents médicaux et difficultés de santé
    {
      const ants = mi.antecedents
        ? Object.entries(mi.antecedents)
            .filter(([, v]) => Boolean(v))
            .map(([k]) => capitalize(String(k)))
        : [];
      const anteLines = wrapLines(ants.length ? ants.join(', ') : 'Aucun antécédent signalé', innerW, 9, ants.length ? 'bold' : 'normal');
      const diffLines = wrapLines(
        String(mi.healthDifficulties || '').trim() || 'Aucune difficulté de santé signalée',
        innerW,
        9,
        mi.healthDifficulties ? 'bold' : 'normal'
      );
      const h = 20.5 + (anteLines.length + diffLines.length) * lineMm(9);
      ensureSpace(h + 2);
      drawBox(h, [248, 250, 252], [203, 213, 225]);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.2);
      doc.setTextColor(71, 85, 105);
      doc.text('ANTÉCÉDENTS MÉDICAUX (maladies déjà eues) :', margin + 4, y + 4.6);
      doc.setFont('helvetica', ants.length ? 'bold' : 'normal');
      doc.setFontSize(9);
      doc.setTextColor(ants.length ? 30 : 100, ants.length ? 41 : 116, ants.length ? 59 : 139);
      doc.text(anteLines, margin + 4, y + 9);
      const y2 = y + 9 + anteLines.length * lineMm(9) + 1.8;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.2);
      doc.setTextColor(71, 85, 105);
      doc.text('DIFFICULTÉS DE SANTÉ (maladie, accident, hospitalisation, précautions) :', margin + 4, y2 + 2.4);
      doc.setFont('helvetica', mi.healthDifficulties ? 'bold' : 'normal');
      doc.setFontSize(9);
      doc.setTextColor(mi.healthDifficulties ? 30 : 100, mi.healthDifficulties ? 41 : 116, mi.healthDifficulties ? 59 : 139);
      doc.text(diffLines, margin + 4, y2 + 7);
      y += h + 3;
    }

    // --- RUBRIQUE 4 : RÉGIME ALIMENTAIRE & ALLERGIES ALIMENTAIRES (EN GRAND, comme la fiche imprimée par les parents) ---
    {
      const foodAllergy = Boolean(mi.allergies?.alimentaires);
      const dietCat = String(cerfa.structuredDiet?.category || 'aucun');
      const isRestrictedDiet = !['aucun', 'standard', ''].includes(dietCat);
      const active = foodAllergy || isRestrictedDiet;
      const dietLabels: Record<string, string> = {
        aucun: 'AUCUN RÉGIME PARTICULIER',
        standard: 'STANDARD / SANS RESTRICTION',
        sans_porc: 'SANS PORC',
        sans_viande: 'SANS VIANDE',
        vegetarien: 'VÉGÉTARIEN',
        allergie_alimentaire: 'ALLERGIE ALIMENTAIRE',
      };
      const dietLabel = dietLabels[dietCat] || dietCat.replace(/_/g, ' ').toUpperCase();
      const cardW = (contentWidth - 3) / 2;
      const details = String(cerfa.structuredDiet?.details || '').trim();
      const reco = String(cerfa.parentRecommendations || '').trim();

      const detLines = details ? wrapLines(details, cardW - 11, 8.5) : [];
      const leftH = 8 + 12 + 5 + (details ? 8 + detLines.length * lineMm(8.5) : 0);
      const allergyText = reco || 'Allergie alimentaire déclarée (consulter le PAI / protocole)';
      const allLines = foodAllergy ? wrapLines(allergyText, cardW - 14, 11.5, 'bold') : [];
      const recoLines = !foodAllergy && reco ? wrapLines(reco, cardW - 8, 8.5) : [];
      const rightH = foodAllergy
        ? 8 + 6 + allLines.length * lineMm(11.5)
        : 8 + 11 + (recoLines.length ? 7 + recoLines.length * lineMm(8.5) : 0);
      const cardH = Math.max(32, leftH, rightH);

      ensureSpace(cardH + 14);
      if (active) {
        doc.setFillColor(180, 83, 9);
        doc.rect(margin, y, contentWidth, 7, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9);
        doc.setTextColor(255, 255, 255);
        doc.text('4 — RÉGIME ALIMENTAIRE & ALLERGIES ALIMENTAIRES', margin + 4, y + 4.9);
        drawPill('RÉGIME OU ALLERGIE ACTIVE', margin + contentWidth - 3, y + 1.1, 4.8, [253, 224, 71], [113, 63, 18], 7.5);
        y += 9;
      } else {
        drawSectionTitle('RUBRIQUE 4 — RÉGIME ALIMENTAIRE & ALLERGIES ALIMENTAIRES');
      }

      // carte de gauche : régime alimentaire
      drawBox(cardH, isRestrictedDiet ? [254, 243, 199] : [248, 250, 252], isRestrictedDiet ? [245, 158, 11] : [203, 213, 225], margin, cardW);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.5);
      doc.setTextColor(isRestrictedDiet ? 146 : 51, isRestrictedDiet ? 64 : 65, isRestrictedDiet ? 14 : 85);
      doc.text('Régime alimentaire sélectionné :', margin + 4, y + 6);
      const dietPt = dietLabel.length > 18 ? 12.5 : 16;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(dietPt);
      const dietW = Math.max(40, doc.getTextWidth(dietLabel) + 12);
      doc.setFillColor(isRestrictedDiet ? 180 : 100, isRestrictedDiet ? 83 : 116, isRestrictedDiet ? 9 : 139);
      doc.roundedRect(margin + 4, y + 9, Math.min(dietW, cardW - 8), 12, 2, 2, 'F');
      doc.setTextColor(255, 255, 255);
      doc.text(dietLabel, margin + 4 + Math.min(dietW, cardW - 8) / 2, y + 9 + 6 + dietPt * 0.3528 * 0.34, { align: 'center' });
      if (details) {
        doc.setFillColor(255, 255, 255);
        doc.setDrawColor(253, 230, 138);
        doc.roundedRect(margin + 4, y + 24, cardW - 8, 4.5 + detLines.length * lineMm(8.5), 1, 1, 'FD');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7.5);
        doc.setTextColor(120, 53, 15);
        doc.text('Précisions :', margin + 6, y + 27.4);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8.5);
        doc.setTextColor(63, 63, 70);
        doc.text(detLines, margin + 6, y + 31.4);
      }

      // carte de droite : allergie alimentaire & évictions
      const rx = margin + cardW + 3;
      drawBox(cardH, foodAllergy ? [254, 242, 242] : [248, 250, 252], foodAllergy ? [252, 165, 165] : [203, 213, 225], rx, cardW);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.5);
      doc.setTextColor(foodAllergy ? 153 : 51, foodAllergy ? 27 : 65, foodAllergy ? 27 : 85);
      doc.text('Allergie alimentaire & Évictions :', rx + 4, y + 6);
      if (foodAllergy) {
        const bh = allLines.length * lineMm(11.5) + 6;
        doc.setFillColor(185, 28, 28);
        doc.roundedRect(rx + 4, y + 9, cardW - 8, bh, 2, 2, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11.5);
        doc.setTextColor(255, 255, 255);
        doc.text(allLines, rx + 7, y + 9 + 5.6);
      } else {
        doc.setFillColor(226, 232, 240);
        doc.roundedRect(rx + 4, y + 9, cardW - 8, 9, 2, 2, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9);
        doc.setTextColor(71, 85, 105);
        doc.text('NON — Aucune allergie alimentaire déclarée', rx + 7, y + 14.8);
        if (recoLines.length) {
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(7.5);
          doc.setTextColor(71, 85, 105);
          doc.text('Recommandations des parents :', rx + 4, y + 23);
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(8.5);
          doc.setTextColor(63, 63, 70);
          doc.text(recoLines, rx + 4, y + 27.2);
        }
      }
      y += cardH + 4;
    }


PSEOF_X
replace_once "$PDF" "$(cat "$TMP/e2_old.txt")" "$(cat "$TMP/e2_new.txt")"

cat > "$TMP/e3_old.txt" << 'PSEOF_X'
    // --- BOTTOM FOOTER (Single Page) ---
    doc.setFontSize(6);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(140, 140, 140);
    doc.text(
      `Fiche Sanitaire de Liaison officielle — ${resolvedEstablishment} — Document confidentiel`,
      margin,
      291
    );
    doc.text(`Émis le ${new Date().toLocaleDateString('fr-FR')}`, pageWidth - margin, 291, { align: 'right' });


PSEOF_X
cat > "$TMP/e3_new.txt" << 'PSEOF_X'
    // --- PIED DE PAGE sur chaque page (build pdf-sante-20261006) ---
    const pageCount = doc.getNumberOfPages();
    for (let p = 1; p <= pageCount; p++) {
      doc.setPage(p);
      doc.setFontSize(6);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(140, 140, 140);
      doc.text(
        `Fiche Sanitaire de Liaison officielle — ${resolvedEstablishment} — Document confidentiel`,
        margin,
        291
      );
      doc.text(
        `Émis le ${new Date().toLocaleDateString('fr-FR')}${pageCount > 1 ? ` — page ${p}/${pageCount}` : ''}`,
        pageWidth - margin,
        291,
        { align: 'right' }
      );
    }


PSEOF_X
replace_once "$PDF" "$(cat "$TMP/e3_old.txt")" "$(cat "$TMP/e3_new.txt")"

cat > "$TMP/e4_old.txt" << 'PSEOF_X'
` | ⚠ Contre-indication : ${
PSEOF_X
cat > "$TMP/e4_new.txt" << 'PSEOF_X'
` | ATTENTION - Contre-indication : ${
PSEOF_X
replace_once "$PDF" "$(cat "$TMP/e4_old.txt")" "$(cat "$TMP/e4_new.txt")"

# --- 3. Reconstruction ------------------------------------------------------
PATCHING=0
if [ "${SKIP_BUILD:-0}" = "1" ]; then
  echo ">>> SKIP_BUILD=1 : pas de reconstruction Docker."
  exit 0
fi

echo ">>> Reconstruction de l'application (1 a 3 minutes) ..."
cd "$APP_DIR"
if ! docker compose up -d --build; then
  echo ""
  echo "!!! ECHEC de la reconstruction Docker. L'ancien conteneur reste en service s'il tournait."
  echo "!!! Pour revenir en arriere : cp -a $BACKUP_DIR/src $APP_DIR/"
  exit 1
fi

echo ">>> Attente du demarrage ..."
APP_PORT_VAL="$(grep -E '^APP_PORT=' .env 2>/dev/null | cut -d= -f2 || true)"
APP_PORT_VAL="${APP_PORT_VAL:-8099}"
for i in $(seq 1 30); do
  if curl -fsS "http://localhost:$APP_PORT_VAL/health" >/dev/null 2>&1; then
    echo ">>> /health OK"
    break
  fi
  sleep 2
done

cat << MSG

============================================================
 TERMINE - build $BUILD
 - PDF archive : regime alimentaire et sante EN GRAND (rubriques 3 et 4).
 - Pour refaire les PDF DEJA archives : Administration > "Etablissement scolaire" >
   "Regenerer les PDF de toutes les fiches completes".
 Retour arriere possible : copie dans $BACKUP_DIR
 IMPORTANT : videz le cache du navigateur (Ctrl+F5).
============================================================
MSG
