# Note Router

Plugin do Obsidianu: poznámku v koreni vaultu presunie do priečinka podľa začiatku nadpisu
(„KAM porada 9.11“ → `KAM/`). Bez AI, bez internetu, číta len mená súborov. Funguje na počítači aj v iPhone a iPade.

*Obsidian plugin that moves notes from the vault root into folders by how their title starts. Rules and log are
plain notes in `_Triedenie/`. Offline, reads file names only, desktop and mobile.*

## Inštalácia cez BRAT

1. Community plugins → Browse → nainštaluj a zapni **BRAT**.
2. BRAT → Add beta plugin → `https://github.com/Don-Bruncvik/note-router` → Add plugin.
3. Community plugins → zapni **Note Router**.

## Ako funguje

- Pravidlá sú v poznámke `_Triedenie/Pravidlá.md` (vytvorí sa sama). Pod nadpisom `## Pravidlá` riadky
  `- slová na začiatku nadpisu = priečinok`, napr. `- Kompas, Osobné = Osobné`. Diakritika a veľké písmená nevadia, vyhrá najdlhšia zhoda.
- Čo presunul a čo nevedel zaradiť, je v `_Triedenie/Denník.md`.
- Otvorenú poznámku a poznámku upravenú za posledných 5 minút nechá na pokoji. Nič nemaže, pri zhodnom mene pridá „(2)“.
- Presúva cez API Obsidianu (odkazy sa opravia, synchronizácia vidí presun).
- Ikona v ľavom paneli: náhľad, čo sa kam presunie, a tlačidlo **Roztrieď teraz**.

## Vývoj

- `npm test`: testy logiky (`src/logic.test.ts`)
- `npm run build`: `main.js` + kópia do `test-vault/`
- Vydanie: zmeň verziu v `manifest.json` a `package.json`, pushni tag s tou istou verziou (napr. `0.1.1`).

MIT
