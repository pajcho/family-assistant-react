# Porodični asistent

[![CI](https://github.com/pajcho/family-assistant-react/actions/workflows/ci.yml/badge.svg)](https://github.com/pajcho/family-assistant-react/actions/workflows/ci.yml)
[![Deploy](https://github.com/pajcho/family-assistant-react/actions/workflows/deploy.yml/badge.svg)](https://github.com/pajcho/family-assistant-react/actions/workflows/deploy.yml)

**Porodični asistent** je mobile-first PWA za vođenje porodičnog dana na jednom mestu:
aktivnosti dece, školski raspored, događaji, računi, budžet i zajedničke liste.
Sve na srpskom, sa push podsetnicima i realtime sinhronizacijom među članovima porodice.

**▶ Aplikacija: [pajcho.github.io/family-assistant-react](https://pajcho.github.io/family-assistant-react/)**
(privatna instanca - potreban je nalog u okviru porodice)

|                      Danas                       |                        Nedelja                         |                        Mesec                        |
| :----------------------------------------------: | :----------------------------------------------------: | :-------------------------------------------------: |
|       ![Danas](docs/screenshots/danas.png)       |   ![Nedelja](docs/screenshots/kalendar-nedelja.png)    |    ![Mesec](docs/screenshots/kalendar-mesec.png)    |
|                    **Budžet**                    |                      **Plaćanja**                      |                      **Liste**                      |
|      ![Budžet](docs/screenshots/budzet.png)      |       ![Plaćanja](docs/screenshots/placanja.png)       |        ![Liste](docs/screenshots/liste.png)         |
|                    **Škola**                     |                        **Meni**                        |                **Globalna pretraga**                |
|       ![Škola](docs/screenshots/skola.png)       |           ![Meni](docs/screenshots/meni.png)           | ![Globalna pretraga](docs/screenshots/pretraga.png) |
|                 **Dečiji režim**                 |                  **Dečiji raspored**                   |                   **Tamna tema**                    |
| ![Dečiji režim](docs/screenshots/dete-danas.png) | ![Dečiji raspored](docs/screenshots/dete-raspored.png) |   ![Tamna tema](docs/screenshots/tamna-tema.png)    |

## Mogućnosti

- 📅 **Jedinstvena agenda (Danas / Kalendar)** - aktivnosti, događaji, plaćanja, rođendani i
  Google eventi u jednom toku. Kalendar se gleda kao agenda, nedelja ili mesec, sa filterima
  po tipu i po članu, a sve što je propušteno stoji na vrhu u sekciji „Prekoračeno".
- 🎒 **Aktivnosti i školski raspored** - ponavljajući termini (nedeljno, A/B nedelje, na N nedelja),
  učesnici po članu, plus školske smene sa automatskim preokretanjem, raspored časova (varijanta A/B)
  i zvona koja same računaju vreme svakog časa.
- 💳 **Plaćanja** - jednokratna i ponavljajuća (mesečno, nedeljno, ograničen broj rata),
  varijabilan iznos, pauziranje, podsetnici N dana ranije, kao i povezivanje sa aktivnošću,
  događajem ili rođendanom („koliko nas zapravo košta Engleski").
- 💱 **Više valuta** - iznos u EUR ili USD se pri unosu prevodi po zvaničnom
  srednjem kursu NBS-a i **zamrzava** zajedno sa kursom, pa se istorija nikad ne prevodi ponovo.
- 📊 **Budžet** - kategorije sa mesečnim limitima, prihodi, projekcija do kraja meseca,
  top prodavnice i trend potrošnje. Trošak se dodaje ručno ili **skeniranjem fiskalnog QR koda**
  (zxing-wasm u browseru, pa dovlačenje stavki računa).
- 📝 **Liste** - porodične i lične, u realnom vremenu. Swipe akcije, drag-and-drop redosled,
  markdown opisi i „smart sort" koji šoping listu sam grupiše po odeljenjima prodavnice.
- 🎂 **Rođendani** - godine, koliko dana je ostalo i vezivanje poklona kao plaćanja.
- 🔔 **Web Push** - jutarnji i večernji digest po podešenom vremenu i vremenskoj zoni,
  podsetnici pred događaj i instant obaveštenje kad neko od ukućana nešto doda.
  Idempotentno preko `notification_log`, mrtve pretplate se same brišu.
- 📆 **Google kalendar** - jednosmerno preslikavanje (read-only) sa privatnošću po kalendaru:
  ne deli se, deli se samo termin bez detalja, ili se deli ceo događaj.
- 🧒 **Dečiji režim** - dete dobija svoju, potpuno read-only aplikaciju: šta ima danas, šta
  dolazi uskoro i školski raspored, u temi koju samo izabere. Telefon se povezuje QR kodom ili
  osmoznakovnim pozivom pa se prijavljuje PIN-om; nema email-a ni lozinke, a roditelj u svakom
  trenutku vidi povezane uređaje i može da ih opozove.
- 🔍 **Globalna pretraga** (⌘K) kroz aktivnosti, događaje, plaćanja, liste i rođendane.
- 📱 **PWA** - instalira se na telefon, radi u standalone režimu, ima tamnu temu i
  toast kad stigne nova verzija.
