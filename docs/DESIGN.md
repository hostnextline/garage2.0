# Design — Mécanique Mobile H.I.S (V2)

## Le sujet
Une app d'atelier qui roule : le propriétaire et le bureau réservent au téléphone, les mécanos
font la job chez le client (soleil, froid, gants, une main), le trésorier fait les comptes.
Le travail principal de l'app : **faire rouler la journée** — réserver vite dans un bloc,
guider le mécano avec une seule prochaine action, se faire payer sur place, garder l'argent clair.

## Direction : la vitrine H.I.S
Hassan a demandé un « mode vitrine » : du verre, un air luxe, des couleurs de luxe au choix.
Une vitrine, c'est la salle d'exposition d'un concessionnaire : du verre, du chrome, une auto
sous les projecteurs. On part du logo (chrome brossé, rouge signal, fond noir) et on en fait
l'éclairage de l'app : des panneaux de verre posés sur un fond profond éclairé de rouge et de chrome.

**L'élément mémorable (un seul)** : le gros bouton de l'étape suivante, rouge signal avec un
anneau chrome, comme le bouton de démarrage d'une auto. Tout le reste reste calme.
Un deuxième clin d'œil, réservé à la fin d'une job : le tampon « PAYÉ » qui se pose sur la facture.

## Couleurs (thème H.I.S)
| Nom | Foncé | Clair | Rôle |
|---|---|---|---|
| Noir logo | #000000 | — | fond (OLED : économise la batterie des mécanos) |
| Acier | #16191C | #E7EAEE | fond clair / panneaux |
| Chrome | #C4C8CD | #8D939A | filets, anneau du bouton, logo |
| Encre | #F2F3F5 | #101418 | texte |
| Rouge signal | #FF2E36 | #D3000E | action principale, alertes |

Mesuré sur le logo : rouge #E6080F, chrome #BEC0C4, fond #010101.
Statuts : réservé (bleu), en route (ambre), sur place (violet), terminé (vert), payé (vert tampon),
annulé (gris), client absent (rouge sombre). Jamais la couleur seule : toujours un mot.

Thèmes de luxe (pour toute l'équipe, chaque personne peut garder le sien) : H.I.S (défaut, suit
le téléphone), Platine (clair argent), Noir et or, Émeraude, Saphir, Bordeaux.

## Typographie
Une seule famille : **Archivo** (variable, axes largeur 62–125 % et graisse 100–900), intégrée à
l'app (marche hors ligne). Le logo est écrit en lettres larges ; l'app reprend cette largeur :
- Titres : largeur 125 %, graisse 340, élégants et calmes (le « titre élégant » de la vitrine).
- Montants et heures : largeur 108 %, graisse 640, chiffres tabulaires.
- Texte : largeur 100 %, graisse 430. Petites données : largeur 88 %, graisse 560.
Échelle : 13 / 15 / 17 / 20 / 26 / 34 / 44 px (téléphone : texte de base 16 px, jamais moins de 13 px).

## Mise en page
- Téléphone : barre du haut (logo, état de la synchro), contenu, barre du bas en verre :
  Aujourd'hui · Agenda · **+** · Clients · Plus. Cibles tactiles de 48 px minimum.
- Ordinateur (≥ 960 px) : menu de verre à gauche, contenu large ; la réservation s'ouvre en
  deux colonnes (client et services à gauche, blocs et carte à droite).
- Alignement à gauche partout ; les montants alignés à droite dans les listes.
- Les listes sont des lignes avec séparateurs dans un panneau, pas des piles de cartes.
  Les jobs sont des billets (bon de travail) avec un talon : le bloc et le numéro d'arrêt.

## Principes
1. Une seule action évidente par écran ; le reste se tait.
2. Les chiffres sont les héros (bloc, total, prix).
3. Prêt pour le terrain : contraste fort, 48 px, foncé automatique le soir, lisible au soleil.
4. Des mots simples, les mêmes partout : Réserver, Je pars, Je suis arrivé, Faire signer,
   Encaisser, Payé. Les erreurs disent quoi faire.
5. Le verre est réservé aux grands panneaux (barres, feuilles, sections), jamais à chaque ligne ;
   « Réduire la transparence » le remplace par du plein (et suit le réglage du téléphone).
6. Mouvement : seulement en réponse à un geste (feuille qui monte, tampon qui se pose).
   « Réduire les animations » est respecté.

## Revue contre les clichés
- Fond crème + sérif + terracotta : non (acier froid ou noir logo).
- Noir + une seule couleur acide : le noir et le rouge sont imposés par le logo ; on les traite
  en chrome et verre, avec des statuts variés, pas en néon.
- Cartes identiques arrondies partout : non — panneaux, lignes, billets, chacun son rôle.
- Étiquettes en MAJUSCULES espacées, « · » entre les infos, flèches « → » sur les boutons :
  évités ; seul le tampon PAYÉ est en majuscules, parce que c'est un tampon.
