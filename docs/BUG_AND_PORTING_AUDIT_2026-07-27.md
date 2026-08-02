# X-Sense Homey: Bug- und Portierungscheckliste

Stand: 2026-08-02

Quellen:

- Homey-App-Issues: https://github.com/Meyblaubaer/com.xsense.svenm/issues
- Homey-Support-Thread: https://community.homey.app/t/148713
- Weiterer deutscher Homey-Thread: https://community.homey.app/t/148872
- Historischer X-Sense/Tuya-Thread: https://community.homey.app/t/119925
- Home-Assistant-Integration: https://github.com/Jarnsen/ha-xsense-component_test
- Homey Python SDK: https://apps.developer.homey.app/the-basics/app
- Drei Homey-Diagnoseberichte der App-Version 1.1.11, anonymisiert ausgewertet

## Pruefumfang

Vollstaendig gelesen und nicht nur ueber Titel oder Suchtreffer ausgewertet:

- 93 von 93 Beitraegen im aktuellen Homey-Support-Thread.
- 14 von 14 Beitraegen im zweiten relevanten Homey-Thread.
- Alle 17 echten Issues und PR #19 der Homey-App inklusive Kommentare.
- Alle 123 echten Issues der Home-Assistant-Integration inklusive der
  nachgeladenen langen Kommentarverlaeufe.
- Der historische Thread #119925 wurde zur Abgrenzung geprueft; er betrifft
  ueberwiegend das Tuya-Modell XS01-WT und ist keine Fehlerquelle der
  X-Sense-Cloud-App.

Wichtig: `closed` bedeutet in diesen Quellen nicht automatisch `fixed`.
Mehrere Issues wurden wegen Inaktivitaet geschlossen, obwohl der letzte
technische Stand weiterhin "funktioniert nicht" war. Die vollstaendige
Quellenabdeckung steht in `docs/ISSUE_COVERAGE_MATRIX_2026-07-27.md`.

## Ziel

Die Python-Version soll nicht nur den Funktionsumfang der Home-Assistant-
Integration uebernehmen, sondern zuerst die sicherheitsrelevanten Fehler der
aktuellen JavaScript-App beseitigen.

Die Home-Assistant-Integration ist eine Protokoll- und Parser-Referenz, aber
keine direkt in Homey verwendbare App. Home-Assistant-spezifische Coordinator-,
Entity- und Event-Bus-Teile muessen durch Homey-Klassen und Flow-Karten ersetzt
werden.

## Projektbasis vor dem Port

### [ ] Reproduzierbaren Ausgangsstand festlegen

- Aktuelle Homey-Store-Version, GitHub-Stand und lokal vorhandenen Quellstand
  vergleichen; nicht versehentlich eine aeltere JavaScript-Version portieren.
- Verwendeten Commit/Tag der HA-Integration und ihrer `python-xsense`-
  Abhaengigkeit festhalten.
- Portable HACS-Bausteine gemaess
  `docs/HACS_ADAPTATION_PLAN_2026-07-27.md` einzeln uebernehmen.
- JavaScript-App als Verhaltensreferenz einfrieren, aber Protokoll-, Parser- und
  Sessioncode nicht ungeprueft uebernehmen.
- Homey-Python-3.14-Kompatibilitaet aller Abhaengigkeiten vor der Auswahl
  pruefen; native Kameraabhaengigkeiten aus dem Kernpaket fernhalten.
- Backup-, Analyse- und Rohdaten-Dateien aus dem Homey-Paket ausschliessen.
- Store-nahe Basis festlegen: Der GitHub-Session-Branch
  `session/agent_47e200ea-ddfe-4de9-9b7a-74932151dfa5` ist sechs Commits weiter
  als `main` und enthaelt die im Build-28-Stacktrace sichtbare
  `lib/PairingHelper.js`. Die Diagnose meldet 1.1.11, waehrend `app.json` dort
  auf 1.1.8 und `package.json` auf 1.1.0 stehen. Versionen vor dem Port
  synchronisieren. Details:
  `docs/DIAGNOSTICS_FINDINGS_2026-08-02.md`.

## P0: Sicherheitsrelevant

### [ ] RF-Alarme hinter SBS50 korrekt auswerten

Problem:

- Rauchalarme von RF-Kindgeraeten hinter einer SBS50 loesen den Homey-Flow
  teilweise nicht aus.
- Ereignisse koennen in `devs`, `notices` oder verschachtelten Shadow-Daten
  stehen und besitzen nicht immer ein `deviceSN` auf oberster Ebene.
- SBS50-Nachrichten koennen die eigentlichen Geraetedaten nur unter numerischen
  Schluesseln wie `00000007` enthalten, waehrend der Root-Payload kein
  verwertbares Alarmereignis meldet.
- `2nd_safenotice/update` wird in der JavaScript-App nicht abonniert.

Betroffene Modelle/Meldungen:

- XS01-M
- SC07-MR
- XS0F-PMA
- Issue #11
- Forumsposts #58, #59, #61, #63 und #93

Umsetzung:

- `safealarm`, `2nd_safenotice`, `2nd_mainpage`, `devs` und `notices`
  durch einen gemeinsamen Event-Parser normalisieren.
- Numerische und unbekannte Container-Schluessel rekursiv durchsuchen, statt
  nur ein festes Root-Schema anzunehmen.
- Station und Kindgeraet anhand aller bekannten Seriennummern aufloesen.
- Alarm- und Alarm-Ende-Ereignisse idempotent verarbeiten.
- Nachrichten ohne Seriennummer nicht still verwerfen, sondern redigiert
  diagnostizieren.

Abnahmetests:

- Physischer Rauchalarm eines XS01-M hinter SBS50 setzt `alarm_smoke=true`.
- Alarm-Ende setzt `alarm_smoke=false`.
- Dasselbe funktioniert fuer SC07-MR und XS0F-PMA.
- Ein Alarm erzeugt genau einen Homey-Flow-Trigger.
- Ein Fixture mit `station_data_keys=["00000007"]` wird dem richtigen
  SBS50-Kindgeraet zugeordnet.

### [ ] Rauch-, CO-, Test- und Mute-Ereignisse trennen

Problem:

- Ein Rauchtest wurde als Mute-Ereignis angezeigt.
- `coPpm > 0` wird derzeit als CO-Alarm interpretiert, obwohl ein Messwert nicht
  automatisch einen aktiven Alarm bedeutet.
- Ein allgemeines `alarmStatus=1` reicht nicht ohne Modell- und Ereigniskontext
  zur Unterscheidung von Rauch, CO und Wasser.
- Ein Diagnosebericht zeigt einen aktiven SWS0A-Leckalarm mit
  `alarmStatus=1`, waehrend Homey keinen Leckalarm ausloeste und das Konto im
  Rauchmelder-Treiber verarbeitet wurde.

Umsetzung:

- Explizite normalisierte Ereignistypen einfuehren:
  `smoke_alarm`, `co_alarm`, `water_alarm`, `self_test`, `mute`,
  `alarm_clear`.
- CO-Messwert und CO-Alarm als getrennte Felder behandeln.
- Keine unbekannten Werte als `0` interpretieren.

Abnahmetests:

- Ein CO-Messwert groesser null aktiviert nicht automatisch `alarm_co`.
- Rauchalarm aktiviert nicht `device_muted`.
- SWS0A-Alarm aktiviert nur `alarm_water`, niemals `alarm_smoke`.
- Mute veraendert den Alarmzustand nur gemaess bestaetigtem Geraetebericht.

### [ ] Selbsttests nur nach echter Bestaetigung melden

Problem:

- Die JavaScript-App setzt nach dem Absenden eines Testbefehls optimistisch den
  Status `TEST` und loest den Flow aus.
- SC06-WX, XS01-WX und XS0B-iR melden physische Selbsttests, unterstuetzen aber
  keinen fernsteuerbaren Selbsttest.
- Dadurch kann Homey einen erfolgreichen Test melden, obwohl das Geraet keinen
  Ton ausgegeben hat.

Umsetzung:

- Modellabhaengige Aktionsmatrix verwenden.
- Nicht unterstuetzte Aktionen gar nicht als Flow-Karte anbieten.
- Test-Flow nur nach einem bestaetigten MQTT-/Shadow-Testbericht ausloesen.
- Befehlsversand, Annahme und Geraetebestaetigung als getrennte Zustaende
  behandeln.

Abnahmetests:

- XS01-WX besitzt keine Remote-Test-Aktion.
- Ein physischer XS01-WX-Test loest den Test-Flow aus.
- Ein unterstuetztes SBS50-RF-Geraet loest den Flow erst nach Rueckmeldung aus.

## P1: Zuverlaessigkeit

### [ ] Ungueltige optionale Capability vom Alarmweg isolieren

Problem:

- Die Store-App 1.1.11 versucht `alarm_mqtt_connected` hinzuzufuegen und zu
  setzen; Homey antwortet auf mehreren Geraeten mit `Invalid Capability` und
  Status 404.
- Im relevanten GitHub-Session-Branch steht die Definition nur im generierten
  `app.json`; die kanonische Compose-Datei
  `.homeycompose/capabilities/alarm_mqtt_connected.json` fehlt.
- Der Fehler tritt auf Homey Pro 2023 und 2026 auf und kann die restliche
  Geraeteaktualisierung unterbrechen.

Umsetzung:

- MQTT-Gesundheit bevorzugt nur in redigierten App-Diagnosen fuehren.
- Optionale Capability nur nach kanonischer Compose-Manifestdefinition,
  Migration und
  `hasCapability` setzen.
- Sicherheitswerte zuerst aktualisieren und optionale Fehler einzeln isolieren.

Abnahmetest:

- Fehlende Diagnose-Capability verhindert kein Rauch-, CO- oder Wasserupdate.

### [ ] MQTT-Subscription-Manager neu aufbauen

Problem:

- Beim App-Neustart wurden doppelte Subscriptions erzeugt und das AWS-IoT-Limit
  ueberschritten.
- Topics werden bereits vor erfolgreicher Broker-Bestaetigung als aktiv
  gespeichert.
- Bei Erreichen des Limits werden spaetere Topics abgeschnitten.
- Re-Subscription kann bereits waehrend `reconnect` statt nach `connect`
  erfolgen.

Umsetzung:

- Soll- und Ist-Subscriptions getrennt verwalten.
- Erst nach erfolgreichem SUBACK als aktiv markieren.
- Sicherheitsrelevante Topics vor optionalen Diagnose-Topics priorisieren.
- Nach jedem Connect alle Soll-Subscriptions abgleichen.
- Retry mit exponentiellem Backoff und Jitter.
- Topic-Gesundheit und Zeitpunkt der letzten Nachricht verfolgen.

Abnahmetests:

- Mehrere App-Neustarts erzeugen keine Duplikate.
- Alle Alarm-Topics bleiben auch bei vielen Geraeten abonniert.
- Fehlgeschlagene Subscriptions werden erneut versucht.
- Ein Connect ohne funktionierende Alarm-Subscription gilt nicht als gesund.

### [ ] Kontroll-Polling trotz MQTT-Verbindung

Problem:

- Die App setzt das Polling aus, sobald MQTT verbunden ist.
- Eine verbundene MQTT-Sitzung garantiert weder erfolgreiche Subscriptions noch
  eingehende Geraeteereignisse.

Umsetzung:

- Langsames Kontroll-Polling immer beibehalten.
- Schneller pollen, wenn MQTT oder einzelne notwendige Topics ungesund sind.
- Stationen/Geraete mit veralteten Daten separat synchronisieren.

Abnahmetests:

- Ein verlorenes Topic wird innerhalb eines definierten Zeitfensters erkannt.
- Zustand und Offline-Status korrigieren sich auch nach einem verpassten Event.

### [ ] Online- und Last-Seen-Status korrigieren

Problem:

- `online=0` wird nur protokolliert; Homey zeigt das Geraet weiter als
  verfuegbar.
- `last_seen` wird bei beliebigen lokalen Updates und beim Start auf die
  aktuelle Zeit gesetzt.
- Temperatursensoren wurden in Homey als Stunden alt/offline gemeldet, obwohl
  die X-Sense-App aktuelle Daten zeigte.

Umsetzung:

- Cloud-/MQTT-Zeitstempel des Geraetes verwenden.
- UTC, lokale Zeitzone und Sommerzeit explizit normalisieren; im Homey-Issue
  wurde `last_seen` um zwei Stunden zu frueh angezeigt.
- Lokale Aktualisierungszeit und echte Geraeteaktivitaet trennen.
- Modellabhaengige Offline-Fristen beruecksichtigen.
- Station offline und Kindgeraet offline getrennt darstellen.

Abnahmetests:

- Batterieentnahme bzw. stromlose SBS50 wird in Homey sichtbar.
- App-Neustart veraendert `last_seen` nicht ohne neue Geraetenachricht.
- Schlafende WLAN-Batteriegeraete werden nicht vorschnell als defekt markiert.

### [ ] Stabiles und idempotentes Pairing

Problem:

- Die Geraeteliste bleibt teilweise leer, verschwindet nach etwa einer Sekunde
  oder erscheint erst nach zwei bis drei Versuchen/App-Neustarts.
- Eine temporaer leere API-Antwort wird wie "keine Geraete vorhanden"
  behandelt.
- Beim Pairing wird `deviceSn` nicht fuer alle Treiber gespeichert.
- Leere Geraete-IDs verursachen defekte Flow-Karten.

Genannte Modelle:

- XS01-WX
- SC07-WX
- SC06-WX
- SWS0B
- XP0A-MR
- XC01-M
- SBS50-Kindgeraete

Umsetzung:

- Retry/Backoff fuer Login, Haus-, Stations- und Geraeteabfragen.
- Leere Antwort nach vorherigem Erfolg als temporaeren Fehler behandeln.
- Deterministische Homey-ID und echte `deviceSn` immer in `data` und Store
  sichern.
- Bereits gekoppelte Geraete korrekt markieren.
- Teilantworten zusammenfuehren statt vorhandene Caches zu leeren.
- Nach jeder Discovery pruefen, ob alle vom Cloud-Konto gelieferten Geraete
  enthalten sind; eine Teilmenge darf nicht als vollstaendiger Erfolg gelten.
- Pairing-Abbruch und API-Timeout fuer Nutzer unterscheidbar anzeigen.

Abnahmetests:

- Wiederholtes Pairing erzeugt keine Duplikate.
- Ein temporaerer API-Fehler leert nicht die vorhandene Geraeteliste.
- Jedes gekoppelte Geraet besitzt `deviceSn`, `stationSn`, `stationId` und
  `houseId`.
- Sechs Cloud-Geraete ergeben nach Pagination und Retry auch sechs
  Pairing-Eintraege.

### [ ] Cloud-Geraetelebenszyklus und Homey-Migrationen

Problem:

- Geloeschte oder ersetzte Cloud-Geraete blieben in Home Assistant erhalten.
- Nach Capability- und Release-Aenderungen blieben dort veraltete Entitaeten
  oder Bedienfelder zurueck; zeitweise verschwanden sogar alle Entitaeten.
- Entsprechende Homey-Risiken sind verwaiste Geraete, doppelte Pairing-Eintraege
  und kaputte bestehende Flow-Karten.

Umsetzung:

- Discovery als Abgleich mit `added`, `changed`, `missing` und `removed`
  modellieren.
- Geloeschte Geraete nicht automatisch destruktiv entfernen, sondern
  nachvollziehbar als nicht mehr im Konto markieren.
- Stabile Homey-Geraete-IDs und versionierte Capability-Migrationen verwenden.
- Veraltete modellabhaengige Flow-/Panel-Ressourcen kontrolliert bereinigen.

Abnahmetests:

- Austausch eines Melders erzeugt weder ein Duplikat noch Datenrouting an die
  alte Seriennummer.
- App-Upgrade erhaelt bestehende Flows und fuegt nur passende Capabilities
  hinzu oder entfernt sie kontrolliert.

### [ ] Login- und Session-Verhalten absichern

Problem:

- X-Sense erlaubt nur eine aktive Sitzung pro Konto.
- Smartphone, Home Assistant und Homey koennen sich gegenseitig abmelden und
  Datenluecken erzeugen.
- Im Forum wurde eine minuetliche Anmelde-Schleife beobachtet.
- X-Sense-/Cognito-Fehler, ein langsamer Verbindungsaufbau und echte falsche
  Zugangsdaten werden derzeit leicht als derselbe Loginfehler dargestellt.
- In mehreren HA-Issues funktionierten Passwoerter mit mehr als 20 Zeichen in
  der X-Sense-App, aber nicht ueber die Integrationsschnittstelle.
- Zugangsdaten konnten nur durch komplettes Entfernen der Integration
  geaendert werden.

Umsetzung:

- Refresh-Token bevorzugen und erneute Vollanmeldung begrenzen.
- Niemals minuetlich ohne Backoff neu anmelden.
- Spezifischen Session-Konflikt anzeigen.
- Authentifizierungsfehler, Cognito-Validierungsfehler, Timeout, DNS und
  temporaeren X-Sense-Backendfehler getrennt klassifizieren.
- Passwortgrenze bereits im Pairing erklaeren und validieren, sofern sie mit
  der aktuellen API verifiziert ist.
- Sichere Reconfigure-/Passwort-aendern-Strecke ohne erneutes Pairing anbieten.
- Empfehlung fuer separates Family-Share-Konto im Pairing erklaeren.
- Zugangsdaten nur im sicheren App-Store speichern, nicht pro Geraet
  vervielfachen.

Abnahmetests:

- Token-Erneuerung erzeugt keine neue parallele Sitzung.
- Session-Konflikte fuehren zu kontrolliertem Backoff.
- Zugangsdaten und Tokens erscheinen nie in Logs.

### [ ] Netzwerk- und MQTT-Verbindungen robust aufbauen

Problem:

- Doppelte MQTT-Client-IDs fuehrten zu gegenseitigen Verbindungsabbruechen.
- IPv6, DNS-Aufloesung und langsame X-Sense-Endpunkte verursachten
  irrefuehrende Authentifizierungsfehler oder dauerhafte Ausfaelle.
- Modellabhaengig fehlende Shadow-Endpunkte lieferten `404`, obwohl das Geraet
  grundsaetzlich unterstuetzt werden konnte.

Umsetzung:

- Pro Homey-Instanz und Verbindung eine stabile, kollisionsfreie MQTT-Client-ID.
- Begrenzte Connect-/Read-Timeouts, Retry mit Backoff und klare Fehlerklasse.
- IPv4/IPv6-Verhalten pruefen und bei reproduzierbarer IPv6-Stoerung einen
  kontrollierten IPv4-Fallback ermoeglichen.
- Fehlendes `mainpage`-/Shadow-Dokument modellabhaengig tolerieren und andere
  bestaetigte Datenquellen weiter verarbeiten.

Abnahmetests:

- Zwei Installationen desselben Kontos verwenden keine identische Client-ID.
- DNS-, Timeout-, Auth- und `404`-Fehler werden unterschiedlich behandelt.
- Ein fehlender optionaler Shadow verhindert weder Pairing noch MQTT-Alarme.

### [ ] Python-Event-Loop frei von blockierenden Aufrufen halten

Problem:

- In der HA-Integration blockierten SSL-Kontexterstellung, Zertifikatszugriffe
  und synchrone Dateizugriffe zeitweise den Event-Loop.
- Ein MQTT-Callback aus einem fremden Thread konnte ohne sichere Uebergabe
  Zustandsdaten veraendern.

Umsetzung:

- SSL-Kontext vor dem laufenden Event-Loop erstellen oder in einen Worker
  auslagern.
- Keine synchronen Datei-, Netzwerk- oder Zertifikatszugriffe in async
  Callbacks.
- Thread-fremde MQTT-Callbacks ausschliesslich thread-sicher in den
  Homey/Python-Event-Loop uebergeben.

Abnahmetests:

- Slow-I/O-Test blockiert weder Heartbeat noch Alarmverarbeitung.
- Parallel eintreffende MQTT-Nachrichten verursachen keine verlorenen Updates
  oder Race Conditions.

### [ ] MQTT- und Event-Logs redigieren

Problem:

- Die JavaScript-App protokolliert alle MQTT-Payloads.
- Eingereichte Homey-Berichte enthalten vollstaendige Shadows mit E-Mail,
  Seriennummern, SSID, IP- und MAC-Adressen.
- SKP0A-Nachrichten koennen den eingegebenen Code als `eventParam.pword` im
  Klartext enthalten.

Umsetzung:

- Passwoerter, Tokens, PINs und Benutzerkennungen zentral redigieren.
- Rohdatenlogging nur explizit und zeitlich begrenzt aktivieren.
- SKP0A-Codes nicht als allgemeine Flow-Tokens oder Diagnosewerte ausgeben.
- Seriennummern, SSID, IP, MAC sowie Haus-/Stations-/Geraete-IDs redigieren.

## P2: Bedienung und Geraeteumfang

### [ ] Flow-Karten modellabhaengig anbieten

Problem:

- Nicht unterstuetzte Test-, Mute- und Fire-Drill-Karten werden angezeigt.
- Bei Testkarten war teilweise kein Geraet auswaehlbar.
- Nutzer wuenschen das Ausloesen lauter Rauch-/CO-Sirenen bei einem externen
  Sicherheitsalarm sowie Home/Away/Disarm als Flow-Bedingung.
- Die Formulierung "Rauchmelder schaltet sich ein" ist missverstaendlich.
- Der globale `mute_alarm`-Run-Listener wird laut Diagnose pro Geraet erneut
  registriert.

Umsetzung:

- Aktionsmatrix pro Modell und Firmware.
- Nicht unterstuetzte Karten ausblenden.
- Test, Mute, Fire Drill und Sirene nur implementieren, wenn der konkrete
  X-Sense-App-/APK-Aufruf und eine Geraetebestaetigung belegt sind.
- Home/Away/Disarm und Sicherheitsaktionen nur registrieren, wenn im Konto
  passende SBS50-Sicherheitsgeraete vorhanden sind.
- Flow-Bezeichnungen eindeutig auf Alarm, Test und Stummschaltung beziehen.
- Globale Action-Listener einmalig in `App.onInit`, nicht in `Device.onInit`,
  registrieren.

### [ ] Sicherheitsmodus und Tuer-/Bewegungssensoren abbilden

Problem:

- Tuer-, Bewegungs- und weitere SBS50-Sicherheitsgeraete zeigten teilweise nur
  Batterie und reagierten nicht auf reale Ereignisse.
- Die X-Sense-Modi `Disarmed`, `Home` und `Away` fehlten als Zustand bzw.
  Flow-Bedingung.

Umsetzung:

- `2nd_safenotice` fuer Kontakt-, Bewegungs-, Keypad- und Modusereignisse in
  denselben normalisierten Parser aufnehmen.
- Sicherheitsmodus nur bei tatsaechlich vorhandenen Sicherheitsgeraeten
  exponieren; reine Rauchmelderkonten duerfen kein leeres Bedienfeld erhalten.
- Kontakt offen/geschlossen, Bewegung, Alarm und Modus getrennt modellieren.

Abnahmetests:

- Tuerkontakt und Bewegung aktualisieren Homey in Echtzeit.
- Home/Away/Disarm ist als Flow-Bedingung nutzbar.
- Ein reines Rauchmelderkonto erhaelt keine irrelevanten Sicherheitskarten.

### [ ] Capability-Matrix einfuehren

Problem:

- Nicht vorhandene Temperatur-/Feuchtigkeitswerte und unbekannte CO-Werte
  fuehren zu leeren oder irrefuehrenden Anzeigen.
- SC07-WX besitzt keine Temperatur- oder Feuchtigkeitssensoren.
- Batterie und Signalstaerke waren je nach Version/Modell unvollstaendig.
- Wasser-, Temperatur- und CO-Geraete wurden in mehreren HA-Versionen
  faelschlich als Rauchmelder dargestellt.
- Manche Schlafgeraete uebertragen Batterie nur beim Aufwachen; andere
  Protokolle liefern nur die Stufen `0..3`.
- Gleichzeitig `measure_battery` und `alarm_battery` zu verwenden muss gegen
  Homey-Vorgaben geprueft werden.

Umsetzung:

- Capabilities aus Modellwissen plus tatsaechlich beobachteten Daten bestimmen.
- Geraeteklasse strikt vom konkreten Modell ableiten; keine generische
  Smoke-Capability fuer Wasser-, Temperatur- oder reine CO-Sensoren.
- Unbekannt nicht als null oder zero darstellen.
- Batteriestufen `0..3` dokumentiert, begrenzt und reproduzierbar auf Prozent
  abbilden; fehlende Aktualisierung nicht als `0 %` interpretieren.
- Capability-Migrationen fuer bereits gekoppelte Geraete testen.

### [ ] Fehlertexte und Platzhalter korrigieren

Problem:

- Bei SC06-WX wurde `{{devicetype}}` statt des Geraetetyps angezeigt.
- Basisstationspflicht und nicht unterstuetztes Modell werden teilweise
  verwechselt.

### [ ] XS0F-PMA vollstaendig integrieren

Ausgangslage:

- PR #19 ergaenzt nur die Pairing-Whitelist.
- Der PR zielt auf das aeltere `main`. Der Store-naehere Session-Branch nutzt
  bereits `SMOKE_TYPES` und `PairingHelper`, enthaelt `XS0F-PMA` aber ebenfalls
  noch nicht. Den kleinen PR-Patch daher nach Festlegung der Projektbasis neu
  auf den aktuellen Pairing-Pfad anwenden statt ihn als Gesamtloesung zu
  uebernehmen.
- Der einzige GitHub-Check des PR ist fehlgeschlagen, allerdings wegen eines
  fehlgeschlagenen Assistant-Aufrufs und nicht wegen eines nachgewiesenen
  Codefehlers. Fachliche und automatisierte Modelltests fehlen weiterhin.
- `acBreak` und `baseRemove` sind noch nicht als Capabilities abgebildet.
- Alarmrouting hinter SBS50 bleibt unabhaengig vom Pairing-Fix zu loesen.

Akzeptanz:

- XS0F-PMA wird im Pairing des festgelegten Basisbranches gefunden.
- Discovery, aktueller Zustand, Rauchalarm, Selbsttest, Mute, `acBreak` und
  `baseRemove` sind mit anonymisierten Fixtures getestet.
- Ein vorhandenes XS0F-PMA kann ein App-Update ohne erneutes Pairing
  ueberstehen.

### [ ] Weitere Modelle aus aktueller HA-Matrix

Zu pruefen:

- SAL51 Smart Listener
- SD19-MN Rauchmelder
- SWS0B WLAN-Wasserlecksensor
- SKP0A Keypad
- Neuere SBS50-RF-Rauch-/CO-Melder

Fuer jedes Modell benoetigt:

- Discovery-Fixture
- State-Fixture
- Alarm-Fixture
- Alarm-Clear-Fixture
- Aktionsmatrix
- Capability-Matrix

### [ ] Verlaufs- und Berichtsdaten als eigene Ereignisquelle

Problem:

- Einige physische Selbsttests erschienen in der X-Sense-Historie, aber nicht
  in den aktuellen Shadow-/Statusfeldern.
- Ein veralteter Bericht darf nicht bei jedem Poll erneut als neues Ereignis
  ausgeloest werden.

Umsetzung:

- Bestaetigte History-/Report-Endpunkte nur fuer Modelle nutzen, bei denen
  Echtzeitdaten nachweislich fehlen.
- Ereignisse mit stabiler ID oder Zeitstempel deduplizieren.
- Aktionserfolg, aktueller Zustand und historischer Bericht getrennt halten.

### [ ] SKP0A sicher integrieren

Hinweise:

- Topic: `2nd_safenotice/update`
- Code: `notices[].eventParam.pword`
- Ein Event kommt erst nach gueltigem Code plus Modustaste.
- Das erneute Waehlen des bereits aktiven Modus erzeugt eventuell kein Event.

Sicherheitsanforderung:

- PIN niemals protokollieren.
- Lokale Zuordnung oder Hash-Vergleich bevorzugen.
- Klartext-PIN nur nach expliziter Nutzerfreigabe als Flow-Information
  bereitstellen.

## Separates experimentelles Projekt

### [ ] SSC0A/SSC0B-Kameras erst spaeter portieren

Gruende:

- Live-Ansicht in der HA-Integration ist weiterhin instabil.
- Offene Probleme bei WebRTC, SDP, ICE-Reihenfolge und Timeouts.
- `aiortc`/`av` verursachten bereits Abhaengigkeitskonflikte.
- Homey verwendet aktuell Python 3.14; native/kompilierte Abhaengigkeiten
  muessen fuer alle Homey-Plattformen verfuegbar sein.

Entscheidung:

- Keine Kamera-Abhaengigkeiten in die erste Python-Version aufnehmen.
- Kameraunterstuetzung optional und isoliert entwickeln.
- Kamera-Menues, Optionen und Ressourcen nur registrieren, wenn mindestens eine
  kompatible Kamera vorhanden ist.

## Historische oder erwartete Verhaltensweisen

Diese Punkte nicht als App-Bug behandeln:

- Batteriebetriebene WLAN-Melder trennen sich zur Energieeinsparung vom WLAN
  und verbinden sich bei Ereignissen erneut.
- XS01-M benoetigt eine Basisstation.
- Die SBS50 wird in der aktuellen App absichtlich nicht als eigenes
  Homey-Geraet angezeigt.
- SC07-WX liefert keine Temperatur und Luftfeuchtigkeit.
- XS01-WT ist ein Tuya-Modell und gehoert nicht automatisch zur
  X-Sense-Cloud-Integration.

## Teststrategie fuer den Python-Port

### [ ] Anonymisierte Protokoll-Fixtures sammeln

Mindestens:

- SBS50 `2nd_mainpage`
- SBS50 `2nd_safenotice`
- House `safealarm`
- Direkter WLAN-Rauchalarm
- RF-Rauchalarm
- CO-Messwert
- CO-Alarm
- Alarm-Ende
- Physischer Selbsttest
- Remote-Selbsttest eines unterstuetzten Modells
- Mute
- Online/Offline
- Numerischer SBS50-Container `00000007`
- Tuerkontakt und Bewegung
- Home/Away/Disarm
- History-Selbsttest
- Fehlender optionaler Shadow (`404`)
- SKP0A

### [ ] Automatisierte Regressionstests

- Parser-Unit-Tests fuer jede Fixture.
- Routing-Tests Station zu Kindgeraet.
- Tests fuer doppelte/verspaetete MQTT-Nachrichten.
- Subscription- und Reconnect-Tests.
- Pairing-Tests mit Timeout, leerer Teilantwort und Retry.
- Discovery-Test auf Vollstaendigkeit und Pagination.
- Auth-Tests fuer falsches Passwort, Cognito-Validierung, Timeout, DNS,
  Session-Konflikt und dokumentierte Passwortlaenge.
- Netzwerk-Tests fuer IPv4/IPv6, eindeutige MQTT-Client-ID und fehlenden
  optionalen Shadow.
- Capability-Migrationstests fuer bestehende Homey-Geraete.
- Modellmatrix-Test: Wasser, Temperatur und CO erhalten keine
  Rauch-Capability.
- Event-Loop- und Thread-Safety-Tests fuer MQTT-Callbacks.
- Sicherstellen, dass Logs keine Secrets oder PINs enthalten.

## Empfohlene Reihenfolge

1. Reine Python-Protokollbibliothek und normalisiertes Datenmodell.
2. MQTT-Subscription-Manager und Event-Routing.
3. P0-Alarm-, Alarm-Clear- und Selbsttest-Regressionstests.
4. Homey-App, Pairing und Migration bestehender Geraete.
5. Online-/Last-Seen-Status und Kontroll-Polling.
6. Modellabhaengige Flow- und Capability-Matrix.
7. XS0F-PMA, SAL51, SWS0B und SKP0A.
8. Kameraunterstuetzung nur separat und experimentell.
