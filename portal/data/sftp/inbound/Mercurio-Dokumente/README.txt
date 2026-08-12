WOG Portal – Mercurio-Dokumente (SFTP)
======================================

Ablage für CH e-dec PDFs aus Mercurio.

Dateiname (Mercurio):
  edece-bs-{mandant}-{auftrag}.{sendung}+{ort}-0-1.pdf   = Bezugsschein
  edece-el-{mandant}-{auftrag}.{sendung}+{ort}-0-1.pdf   = Einfuhrliste

Beispiel:
  edece-bs-104-443153.1+CON-0-1.pdf
  edece-el-104-443153.1+CON-0-1.pdf

Verarbeitung (Worker):
  - Match über Auftrag.Sendung aus Dateiname (Fallback: Ref-Nr. im PDF)
  - CH-Zollanmeldungsnummer → Zoll-Referenz an der Sendung (MRN)
  - PDF wird an die Portal-Sendung als Zollpapier angehängt
  - Verarbeitet → processed/bezugsschein|einfuhrliste/
  - Ohne Match → failed/unmatched/

Nach Login landet man direkt in diesem Ordner.
