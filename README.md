# PP Map — Premium Positioning Coverage

Refonte UX/UI de https://ppheatmap.netlify.app/ en rendu type **Uber** :
**deck.gl** (la librairie de dataviz d'Uber) + **MapLibre GL** (basemap vectorielle dark)
+ **GSAP** (animations UI). Tokens design alignés sur le **Base design system** d'Uber
(bleu #276EF1, radius 8, boutons noir/blanc, couleurs sémantiques Base).

## Les deux builds

| Fichier | Usage | Particularités |
|---|---|---|
| `demo.html` | Section de site (Webflow) | **Globe 3D** (projection MapLibre v5 + deck.gl 9.1 interleaved), points "city lights", tour caméra auto qui plonge sur les zones denses puis recule et fait tourner le globe, captions narratif plateforme, compteurs animés, CTA "Check your coverage →", `cooperativeGestures` (le scroll de page n'est jamais capturé), respect de `prefers-reduced-motion` |
| `app.html` | Coverage checker complet | **Carte à plat** (mercator — meilleure ergonomie de tâche : pas d'hémisphère masqué, lecture des distances), recherche d'adresse + "My location" + clic-partout → verdict de couverture, vues Coverage/Heatmap, toggles réseaux, panneau pays, thème dark/light, URL partageable, tooltips, fullscreen |

**Pourquoi globe sur la démo et plat sur l'app :** le globe sert le storytelling
("one platform, every region" — on voit la planète tourner) ; la carte plate sert la
tâche (vérifier SA couverture). Chaque build charge sa version de lib : la démo est sur
maplibre 5.24 / deck 9.1.15 (requis pour le globe, mode `interleaved` obligatoire),
l'app reste sur maplibre 4.7 / deck 9.0. Même moteur, mêmes données, mêmes tokens.
Contrainte connue : la HeatmapLayer (agrégation screen-space) ne rend pas en projection
globe — la démo utilise la vue `coverage` avec des points fins
(`coverageMinPixels/MaxPixels/Opacity` dans la config).

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
- ⚠️ **Les deux CSV partagent des stations** (mêmes coordonnées dans les deux fichiers) :
  la somme 13 951 sur-compte les stations physiques. À trancher côté contenu vs le claim
  marketing "7 500 base stations". L'app affiche les comptes **par réseau**, jamais la somme.
- Date des données : opts `dataDate` dans `app.html` (affichée dans la légende).

## Intégration Webflow

1. Déployer le dossier `pp-map/` sur Netlify (drag & drop)
2. Embed dans la section :

```html
<div style="position:relative;width:100%;height:600px;border-radius:16px;overflow:hidden;">
  <iframe src="https://VOTRE-SITE.netlify.app/demo.html"
          style="position:absolute;inset:0;width:100%;height:100%;border:0;"
          loading="lazy" title="Coverage map"></iframe>
</div>
```

Dans `demo.html`, pointer `CTA_URL` vers la page coverage checker du site
(le lien s'ouvre en `_top`, donc hors iframe).

## Partage (procurement, équipes)

L'URL de l'app encode la vue et la caméra (`#v=coverage&c=lat,lon,zoom`) :
un zoom sur une région se partage par copier-coller d'URL.

## Stack (CDN, aucun build)

- maplibre-gl 4.7 — basemap vectorielle (Carto dark-matter / positron, gratuits)
- deck.gl 9.0 — ScatterplotLayer, HeatmapLayer, LineLayer (probe), HexagonLayer (dispo)
- gsap 3.12 — compteurs, transitions (désactivé si `prefers-reduced-motion`)
- Photon (komoot.io) — géocodage gratuit sans clé ; remplaçable par Mapbox/Google dans
  `ui/components.js` (`GEOCODER`)
