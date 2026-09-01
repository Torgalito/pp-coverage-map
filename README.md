# PP Map — Premium Positioning Coverage

Refonte UX/UI de https://ppheatmap.netlify.app/ en rendu type **Uber** :
**deck.gl** (la librairie de dataviz d'Uber) + **MapLibre GL** (basemap vectorielle dark)
+ **GSAP** (animations UI). Tokens design alignés sur le **Base design system** d'Uber
(bleu #276EF1, radius 8, boutons noir/blanc, couleurs sémantiques Base).

## Les deux builds

| Fichier | Usage | Particularités |
|---|---|---|
| `demo-globe.html` | Hero marketing (par défaut) | **Vrai globe 3D** (globe.gl / Three.js), **dark theme** (globe navy lisible sur fond #0A1226), **heatmap deux-tons** style deck.gl **haute définition** (texture 4096×2048) : champ de densité par réseau mappé à travers une **rampe de couleur multi-paliers** (translucide → glow → cœur saturé, avec contours/ridges fins) — reproduit le rendu exact de l'app 2D. Texture auto-lumineuse (emissive) pour le glow. Basemap + densités **mises en cache** → les toggles ne font que recomposer (~120 ms). Police **Manrope**. **Network panel** "XYZ · LIVE NETWORK" stylé sur la page (Inter, barres de signal affinées) : liste scrollable de toutes les zones couvertes (Western Europe, Nordics, North America, Japan, Australia, Southern Africa, Brazil) — clic = rotation vers la zone ; **toggles Network 1 / Network 2** qui recomposent la heatmap en direct (texture régénérée, garde-fou : au moins un réseau actif). Heatmap peinte en texture car la HeatmapLayer deck.gl ne rend pas en projection globe ; rampes `RAMP_A/B` + rayon/intensité `cfg` réglables. Zoom molette off, `prefers-reduced-motion` respecté |
| `demo-globe-vector.html` | **Hero marketing — piste en cours** | Globe vectoriel dark : pays peints dans une texture équirectangulaire 8192×4096 (fond `#192138`, terres `#334064`, couverture en deux verts H 112°), **ombrage topographique réel** par-dessus (voir *Données*), lignes orbitales. **UI en deux rangées seulement** (~61 px de haut en desktop) : régions en *contrôle segmenté* (une piste continue, pastille claire sur la sélection) + CTA « See coverage map » → `https://coverage.premium-positioning.com/` (ouvert en `_top`, donc hors iframe) ; le CTA partage le token `--pp-sel` avec la pastille active, en le superposant à `--pp-track` pour obtenir le même composite hors de la piste. Légende à pastilles rondes en dessous. Bascule sur deux rangées sous 900 px (largeur mesurée nécessaire : 892 px), la piste défile sous ~715 px avec un dégradé de bord posé par JS uniquement quand du contenu reste caché à droite. Panneau de réglages (rim, ambiante, lumière clé, halo, relief terres/océans, bump) **en localhost uniquement**. Les pays sont peints en texture et non en `ConicPolygonGeometry` : cette dernière produisait un hachurage triangulaire sur les zones colorées |
| `demo-globe-choropleth.html` | Variante hero (premium glossy) | Globe clair glossy, **pays en choroplèthe** (couverts en accent, satellite flottant). Plus "marketing premium" que data |
| `demo.html` | Section de site (Webflow) | **Carte sur globe** (projection MapLibre v5 + deck.gl 9.1 interleaved) : points "city lights" sur tuiles réelles, tour caméra auto. Plus "réaliste/géographique" que conceptuel |
| `app.html` | Coverage checker complet | **Carte à plat** (mercator — meilleure ergonomie de tâche : pas d'hémisphère masqué, lecture des distances), recherche d'adresse + "My location" + clic-partout → verdict de couverture, vues Coverage/Heatmap, toggles réseaux, panneau pays, thème dark/light, URL partageable, tooltips, fullscreen |

### Trois moteurs de rendu, une seule donnée

La philosophie deux couches tient même avec trois renderers différents : **les données
(CSV) et les couleurs (tokens CSS) sont partagées**, seul le moteur de rendu change.

| Build | Renderer | Quand le choisir |
|---|---|---|
| `demo-globe.html` | **globe.gl / Three.js** | Hero marketing épuré — vraie 3D, heatmap deux-tons peinte en texture, sans UI (variante choroplèthe : `demo-globe-choropleth.html`) |
| `demo.html` | **deck.gl + MapLibre** | Quand on veut voir la géographie réelle (continents, pays) sur le globe |
| `app.html` | **deck.gl + MapLibre (plat)** | Outil de tâche — vérifier SA couverture |

`core/globe-data.js` est la couche données du globe : elle charge les mêmes CSV et en dérive
soit la **couverture par pays** (point-in-polygon → quels pays sont couverts, pour la
choroplèthe), soit un champ de points + hubs + arcs (helpers conservés). Elle ne connaît ni
Three.js ni les couleurs (lues dans les tokens CSS côté HTML).

**Pourquoi globe sur la démo et plat sur l'app :** le globe sert le storytelling
("one platform, every region" — on voit la planète tourner) ; la carte plate sert la
tâche (vérifier SA couverture). Chaque build charge sa version de lib : la démo est sur
maplibre 5.24 / deck 9.1.15 (requis pour le globe, mode `interleaved` obligatoire),
l'app reste sur maplibre 4.7 / deck 9.0. Même moteur, mêmes données, mêmes tokens.
Contrainte connue : la HeatmapLayer (agrégation screen-space) ne rend pas en projection
globe — la démo utilise la vue `coverage` avec des points fins
(`coverageMinPixels/MaxPixels/Opacity` dans la config).

## Le vert de couverture est choisi par le hero, pas par le globe

La couleur d'action du site est **orange**. Mesuré sur les fonds réels :

| Élément | Contraste |
|---|---|
| Titre blanc / page `#091126` | 18,75 |
| **CTA orange `#FA6A11` / page** | **6,37** |
| Ancien vert `#65CC56` / océan | 7,85 ❌ |
| **Emerald `#3FA07C` / océan** | **4,96** ✅ |

L'ancien vert était *plus fort que le bouton de conversion*, sur une surface bien
plus grande : la donnée cannibalisait l'action. Emerald (H 158) corrige sur deux
axes — le contraste passe sous celui du CTA, et la teinte devient **froide**.
Chaud avance, froid recule : la hiérarchie tient donc sur n'importe quel écran,
pas seulement à un réglage de luminosité. H 158 reste assez loin de l'orange
(H 25) pour qu'une zone de couverture ne soit jamais lue comme une action, et
assez vert pour rester « couvert ».

Alternatives conservées dans `GREENS` : **`?green=sage|teal|previous`** permet de
rebasculer sans toucher au code. `?dev=0` masque le panneau de réglages
(capture propre, ou comparaison en iframes côte à côte).

## Le verdict de couverture (cœur de l'outil)

Recherche (géocodeur Photon, gratuit, sans clé), géolocalisation, ou clic sur la carte →
carte-verdict :

- **Dual-network coverage** (vert) — les 2 réseaux à portée = argument redondance
- **Covered — single network** (ambre)
- **Outside current coverage** (rouge) — CTA contact uniquement

Pour chaque réseau : distance à la station la plus proche, statut `optimal` (≤ 30 km,
précision centimétrique), `covered` (≤ 60 km) ou `out`. Sur la carte : pin + anneau 60 km
+ lien visuel vers la station la plus proche. Note d'honnêteté anti-overclaim incluse.

**CTA par parcours ICP** (config dans `app.html`) :
- Primaire — `Talk to an engineer` (Reseller / OEM / Enterprise, parcours sales)
- Secondaire — `Start 14-day free trial` (Solo, self-serve ; masqué hors couverture)

→ Remplacer les `href` placeholder (`#contact-engineer`, `#start-trial`) par les vraies
pages du site.

## Architecture en 2 couches

```
pp-map/
├── core/engine.js       ← COUCHE FONCTIONNELLE (data, WebGL, verdict, pays, interactions)
├── ui/
│   ├── theme-uber.css   ← COUCHE DESIGN (tokens Base Uber + styles composants)
│   └── components.js    ← COUCHE DESIGN (recherche, verdict, panneaux — API du core only)
├── data/                 ← service_a.csv, service_b.csv (lat,lon) + countries.geo.json
├── app.html              ← build full app
└── demo.html             ← build embed
```

**Règle :** `core/engine.js` ne contient aucune couleur ni markup. Il lit ses couleurs
WebGL dans les CSS custom properties (`--pp-a-color`, `--pp-b-color`, `--pp-accent-color`).
Changer de DA = dupliquer `theme-uber.css`, changer les tokens, swapper le `<link>`.

### API publique du moteur

```js
engine.setView('coverage'|'heatmap'|'density');
engine.toggleService('a');
engine.setBasemap('dark'|'light');
engine.setProbe([lon, lat]);        // verdict + pin (null pour fermer)
engine.queryPoint([lon, lat]);      // verdict sans UI (distances, statuts, dual)
engine.loadCountries(url);          // stats par pays → événement 'countries'
engine.flyToCountry('France');
engine.getHotspots(4);              // top zones denses (tours guidés)
engine.flyTo({center, zoom}); engine.fitToData(); engine.getStats();
engine.refreshTheme();              // re-lit les tokens CSS
engine.on('ready'|'statechange'|'probe'|'countries'|'hover'|'movestart', cb);
// window.ppEngine exposé dans app.html (debug / intégrations)
```

## Données

- CSV dans `data/` : header avec colonnes `lat,lon` (le reste est ignoré).
- **Trois textures de relief** (732 kB au total) pour `demo-globe-vector.html`, toutes
  dérivées de sources en **domaine public** — aucune attribution requise, usage
  commercial libre. Chacune est décorative : si elle manque, le globe s'affiche
  quand même, sans erreur.

  | Fichier | Source | Rôle |
  |---|---|---|
  | `relief.webp` (4096×2048, 284 kB) | Natural Earth **SR_50M** | Ombrage des terres |
  | `relief-ocean.webp` (3072×1536, 388 kB) | Natural Earth **OB_50M** | Fonds marins |
  | `bump.webp` (2048×1024, 59 kB) | three-globe `earth-topology` | Élévation → normales |

  ⚠️ **Ordre des opérations pour l'océan** : réduire *puis* étirer le contraste, jamais
  l'inverse. La bathymétrie demande un étirement ×5 (sa variation réelle ne couvre que
  ±15 niveaux) ; appliqué à pleine résolution, il amplifie le bruit de quantification
  de la source et **double le poids du fichier** (805 kB → 388 kB à qualité égale).
  Le sous-échantillonnage en float (`mode 'F'`) préserve la précision sous-niveau,
  ce qui évite le banding qu'un passage par 8 bits provoquerait.

  **Le principe qui rend le composite exact.** Les deux premiers rasters sont des
  miroirs : SR_50M met tout l'océan à une valeur constante, OB_50M met toute la terre
  à une valeur constante. En recentrant chacun sur **128** — la valeur neutre du blend
  `overlay` — chaque calque devient un no-op mathématique exactement là où l'autre
  agit. Ils se composent donc **sans masque et sans interférence**, et les côtes
  restent aussi nettes que les rasters d'origine.

  Deux nuances importantes :
  - `relief.webp` est centré sur le sol plat (gain 0,825 = le plus fort sans écrêter
    aucune ombre). `relief-ocean.webp` est centré sur la **médiane de la mer**, pas sur
    la terre : centrer sur la terre décalait tout l'océan hors de `--pp-ocean` et
    écrasait la variation bathymétrique réelle (qui tient entre les percentiles 5 et 95,
    soit ±15 niveaux seulement).
  - La mer n'utilise **pas** `overlay`. Ce blend est multiplicatif, et sur un fond aussi
    sombre que `#192138` il déplaçait la dorsale médio-atlantique de 0 niveau (mesuré).
    `signedLayer()` la convertit en alpha signé — clair au-dessus de 128, sombre en
    dessous — pour une amplitude absolue et dosable.

  **Dosage** : constantes `RELIEF` / `OCEAN_REL` / `BUMP_SCALE`, sliders en localhost,
  ou paramètres d'URL `?relief=` `?ocean=` `?bump=` `?yaw=` `?pitch=`.
- ⚠️ **Les deux CSV partagent des stations** (mêmes coordonnées dans les deux fichiers) :
  la somme 13 951 sur-compte les stations physiques. À trancher côté contenu vs le claim
  marketing "7 500 base stations". L'app affiche les comptes **par réseau**, jamais la somme.
- Date des données : opts `dataDate` dans `app.html` (affichée dans la légende).

## Intégration Webflow

1. Déployer le dossier `pp-map/` sur Netlify (drag & drop)
2. Embed dans la section :

```html
<div style="position:relative;width:100%;height:600px;border-radius:16px;overflow:hidden;">
  <iframe src="https://VOTRE-SITE.netlify.app/demo-globe.html"
          style="position:absolute;inset:0;width:100%;height:100%;border:0;"
          loading="lazy" title="Coverage globe"></iframe>
</div>
```

Remplacer `demo-globe.html` par `demo.html` pour la variante carte réaliste.
Dans chaque démo, pointer `CTA_URL` vers la page coverage checker du site
(le lien s'ouvre en `_top`, donc hors iframe).

## Partage (procurement, équipes)

L'URL de l'app encode la vue et la caméra (`#v=coverage&c=lat,lon,zoom`) :
un zoom sur une région se partage par copier-coller d'URL.

## Stack (CDN, aucun build)

- globe.gl 2.46 (bundle Three.js) — `demo-globe.html` : globe 3D, couches points/arcs/rings
- maplibre-gl 4.7 / 5.24 — basemap vectorielle (Carto dark-matter / positron, gratuits)
- deck.gl 9.0 / 9.1 — ScatterplotLayer, HeatmapLayer, LineLayer (probe), HexagonLayer (dispo)
- gsap 3.12 — compteurs, transitions (désactivé si `prefers-reduced-motion`)
- Photon (komoot.io) — géocodage gratuit sans clé ; remplaçable par Mapbox/Google dans
  `ui/components.js` (`GEOCODER`)

### Autres pistes conceptuelles évaluées (non retenues pour l'instant)

- **COBE** (~5 kb) — globe pointillé ultra-léger, superbe en hero minimal type Stripe/Vercel,
  mais pas d'arcs ni d'interaction riche.
- **Three.js brut** — contrôle total (shaders maison, halo custom) au prix de 3-4× plus de code.
- **D3 orthographic** — exactement le rendu "filaire éditorial" de la réf, mais 2D projeté
  (pas de vraie profondeur/éclairage). Bon plan B si on veut un rendu très épuré et léger.
