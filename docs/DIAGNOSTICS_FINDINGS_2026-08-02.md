# X-Sense Homey: Auswertung neuer Diagnoseberichte

Stand: 2026-08-02

Quellenbasis:

- Drei manuell eingereichte Homey-Diagnoseberichte.
- App-Version in allen Berichten: `1.1.11`.
- Homey-Versionen: `13.3.0` und `13.4.0`.
- Hardware: Homey Pro (Early 2023) und Homey Pro (2026).

Die Rohberichte werden wegen enthaltener E-Mail-Adressen, Seriennummern,
SSIDs, IP- und MAC-Adressen nicht in das Repository uebernommen.

## Nachtrag: Diagnoseberichte vom 2026-08-08

Quellen:

- App-Version `1.1.14`, Homey `13.4.0`.
- Homey Pro (2026), Log-ID `46ea0292-04fc-4039-9d23-ad0c2ace9c63`.
- Homey Pro (Early 2023), Log-ID `452ce5c2-ec1b-44a2-a0a5-662a813b5612`.

Bestaetigte Ursachen und Umsetzung:

- [x] Die X-Sense-API liefert abgelaufene Sitzungen als HTTP 200 mit
  `reCode=500` und `NotAuthorizedException`. Dieser Fall wurde bislang nicht
  als Authentifizierungsfehler erkannt. Cognito-Token werden nun vor Ablauf
  erneuert; ein abgelehnter Token loest genau einen zentral verriegelten
  Refresh und Request-Retry aus.
- [x] AWS-IoT-Zugangsdaten werden beim Signaturwechsel und nach 401/403 neu
  geladen. Dadurch bleibt MQTT auch nach Ablauf der urspruenglichen
  Zugangsdaten verbunden.
- [x] Bei sieben Stationen und 30 Geraeten erreichte die App das feste
  MQTT-Limit und schnitt Topics mit `Trimming subscriptions: 6 -> 3` ab. Wie
  die HACS-Integration verwendet Homey nun pro Station ein Wildcard-Topic fuer
  alle Shadow-Updates sowie ein Presence-Topic.
- [x] Veraltete `online=0`-Werte koennen bei unterstuetzten Modellen durch ein
  aktuelles `onlineTime` bestaetigt werden. Schlafende RF-Modelle bleiben von
  dieser Ableitung ausgeschlossen; SWS0B/XR0A-iR verwenden das verlaengerte
  49-Stunden-Fenster der HACS-Integration.
- [x] Mehrere STH51 an derselben Basisstation erzeugten gleichzeitig drei
  identische Temperatursynchronisierungen. Sie werden nun stationsweise
  gebuendelt und kurzzeitig dedupliziert.
- [x] Leere Pairing-Eingaben werden vor Cognito abgefangen. Damit erscheint
  nicht mehr der technische Fehler `Request does not contain valid parameters`.
- [x] Signierte MQTT-URLs, Request-MACs und Cognito-Secret-Hashes werden nicht
  mehr in das Laufzeitprotokoll geschrieben.

Abdeckung:

- Automatische Tests fuer parallele und dauerhaft abgelehnte Sitzungen,
  proaktiven Token-Refresh, AWS-Shadow-Retry, MQTT-Wildcards, Presence,
  Online-Zeitfenster, Pairing-Validierung und STH-Buendelung.

## GitHub-Kontrollstand 2026-08-09

- Die vollstaendige GitHub-Liste wurde ueber die oeffentliche API erneut
  geprueft.
- Es gibt keine offenen Issues und keine offenen Pull Requests.
- Seit dem 2026-08-02 wurde kein Issue oder Pull Request neu erstellt oder
  aktualisiert.
- Der letzte Pull Request ist
  [#22 Coordinate periodic station polling](https://github.com/Meyblaubaer/com.xsense.svenm/pull/22),
  am 2026-08-02 in `main` gemergt.
- Der vorherige externe Pull Request
  [#19 Add XS0F-PMA smoke detector](https://github.com/Meyblaubaer/com.xsense.svenm/pull/19)
  ist geschlossen und wurde durch die vollstaendigere Umsetzung in
  [#20](https://github.com/Meyblaubaer/com.xsense.svenm/pull/20) ersetzt.
- Daraus entstehen aktuell keine weiteren Codeaenderungen fuer den
  Entwicklungsbranch `codex/fix-diagnostics-auth`.

## P0: Bestaetigte Alarmfehler

### [ ] Wasserereignis modellabhaengig routen

Beobachtung:

- Ein SWS0A hinter SBS50 meldet unter einer numerischen Child-ID
  `alarmStatus="1"`.
- Der Nutzer meldet, dass Homey den Leckalarm nicht ausgeloest hat.
- Derselbe Account wird im Log durch `Driver:smoke-detector` verarbeitet.

Schlussfolgerung:

- Ein generisches `alarmStatus` darf nicht automatisch als Rauchalarm
  behandelt werden.
- Fuer `EntityType.WATER` muss derselbe Status `alarm_water` und den passenden
  Wasser-Flow aktualisieren.
- Bereits falsch als Rauchmelder gekoppelte SWS0A benoetigen eine Migration
  oder ein kontrolliertes erneutes Pairing als Wassergeraet.

Abnahmetests:

- SWS0A-Child-Payload mit numerischer ID und `alarmStatus=1` setzt nur
  `alarm_water=true`.
- `alarmStatus=0` beendet den Wasserstatus.
- Kein Smoke- oder Mute-Flow wird dadurch ausgeloest.

### [ ] Ungueltige MQTT-Capability darf Alarmupdates nicht unterbrechen

Beobachtung:

- Auf zwei unterschiedlichen Homey-Modellen tritt fuer mehrere Geraete
  `Invalid Capability: alarm_mqtt_connected` mit Status `404` auf.
- Die App versucht die Capability sowohl dynamisch hinzuzufuegen als auch zu
  setzen.
- Direkt danach wird die Geraeteaktualisierung als MQTT-Statusfehler
  protokolliert.

Schlussfolgerung:

- `alarm_mqtt_connected` wird im relevanten Branch nur im generierten
  `app.json`, nicht aber als kanonische Homey-Compose-Capability definiert.
- Ein optionaler Diagnosewert kann dadurch die sicherheitsrelevante
  Aktualisierung abbrechen.

Umsetzung:

- MQTT-Gesundheit bevorzugt als redigierte App-Diagnose statt
  Geraete-Capability fuehren.
- Falls die Capability sichtbar bleiben soll, zentral im Manifest definieren,
  sauber migrieren und vor jedem Setzen mit `hasCapability` pruefen.
- Jede optionale Capability isoliert behandeln; ein Fehler darf Smoke-, CO-
  oder Wasserzustand nicht verhindern.
- Sicherheits-Capabilities immer vor optionalen Diagnosewerten aktualisieren.

Abnahmetests:

- Nicht vorhandene optionale Capability verursacht keinen Abbruch des
  Alarmupdates.
- Derselbe Test laeuft auf Homey Pro 2023 und 2026.

### [ ] Verpasste Rauchereignisse weiter untersuchen

Beobachtung:

- Zwei Berichte melden, dass Rauch-/Feuerereignisse Homey nicht erreichen.
- Die Status-Shadows zeigen die SBS50-Kinder grundsaetzlich korrekt an.
- In den eingereichten Ausschnitten ist kein aktiver Rauch-Payload enthalten;
  die Ursache kann deshalb nicht allein aus dem Snapshot bestimmt werden.

Naechste Diagnose:

- Letzte Nachricht pro notwendigem Alarm-Topic ohne Payload/Seriennummer
  protokollieren.
- SUBACK und Topic-Gesundheit erfassen.
- Physisches Alarm-Fixture fuer SD19-MN, XP0A-MR und XS0B-MR sammeln.
- Kontroll-Polling muss einen verpassten MQTT-Alarmstatus korrigieren.

## P1: Pairing und Modellumfang

### [ ] SD19-MN unterstuetzen

Beobachtung:

- Die Cloud-Discovery findet sieben Geraete hinter einer SBS50.
- Die Kindgeraete sind SD19-MN und liefern Batterie, RF-Level, Online-Status,
  Alarm, Mute und Zeitstempel.
- Das Pairing meldet dennoch mehrfach, dass kein unterstuetztes Geraet gefunden
  wurde.

Schlussfolgerung:

- Discovery funktioniert, aber die Pairing-/Treibermatrix filtert SD19-MN aus.
- Die aktuelle HACS-Matrix klassifiziert SD19-MN als Rauchmelder und besitzt
  bereits modellbezogene Test-, Mute- und Fire-Drill-Routen.

Umsetzung:

- SD19-MN in die gemeinsame Modellmatrix aufnehmen.
- Erst Zustands-, Alarm-, Alarm-Clear-, Test- und Mute-Fixtures pruefen; nicht
  nur die Pairing-Whitelist erweitern.

### [ ] Pairing-Fehler lokalisieren

Beobachtung:

- Die ausgelieferte App zeigt den nicht ersetzten Platzhalter
  `{{deviceType}}`.
- Derselbe generische Text erscheint bei Rauch- und CO-Pairing.
- Vor einem spaeter erfolgreichen Discovery-Lauf gab es sowohl `User does not
  exist` als auch `Incorrect username or password`.

Umsetzung:

- Lokalisierungsschluessel und Parametername exakt pruefen.
- Falsche Zugangsdaten, kein passendes Modell und temporaer leere Discovery
  getrennt anzeigen.
- Nach erfolgreichem Login alte Authfehler nicht als aktuellen Geraetefehler
  weiterverwenden.

## P1: App-Lebenszyklus

### [ ] Flow-Listener nur einmal registrieren

Beobachtung:

- `FlowCardAction[mute_alarm]` meldet fuer mehrere initialisierte Geraete:
  `Run listener was already registered`.

Schlussfolgerung:

- Der globale Action-Listener wird offenbar im Geraete-Lebenszyklus erneut
  registriert.

Umsetzung:

- Globale Flow-Actions einmal in `App.onInit` registrieren.
- Geraetebehandlung ueber das Flow-Argument aufloesen.
- Registrierung idempotent testen; kein Listener in `Device.onInit`.

## P0: Datenschutz der Diagnose

### [ ] Roh-Shadows und Identifikatoren nicht in Homey-Berichte schreiben

Beobachtung:

- Die Berichte enthalten komplette SBS50-Shadows.
- Sichtbar sind unter anderem Konto-E-Mail, Seriennummern, SSID, lokale IP,
  MAC-Adressen, Firmware und exakte Ereigniszeiten.

Umsetzung:

- Standarddiagnose auf Modell, Firmware, anonymisierte Anzahl, Capability-
  Zustand, Topic-Kategorie und Fehlerklasse begrenzen.
- E-Mail, Token, Seriennummern, Haus-/Stations-/Geraete-IDs, SSID, IP und MAC
  zentral redigieren.
- Rohpayload nur nach ausdruecklicher Freigabe und zeitlich begrenzt erfassen.
- Redaction mit automatisierten Tests absichern.

## Quellstand: Relevanter GitHub-Branch gefunden

Feststellung:

- Diagnoseberichte stammen aus App-Version `1.1.11`.
- Das lokale `main` und `origin/main` sind identisch auf Commit
  `ebe2d76de8bec535e23a062bbe1474637b6603ee`.
- Der zusaetzliche GitHub-Branch
  `session/agent_47e200ea-ddfe-4de9-9b7a-74932151dfa5` steht auf Commit
  `086b96d809d03912d5bec922a060f5ff3d5b4d06` und ist sechs Commits weiter als
  `main`.
- Dieser Branch enthaelt `lib/PairingHelper.js` und exakt die in den
  Stacktraces sichtbare `alarm_mqtt_connected`-Logik.
- Die Versionsmetadaten sind weiterhin nicht synchron: Auch dieser Branch
  meldet in `app.json` Version `1.1.8` und in `package.json` Version `1.1.0`,
  waehrend der Diagnosebuild `1.1.11` meldet.

Folge:

- Der relevante Quellcode ist auf GitHub vorhanden und kann fuer die
  Fehlerbehebung verwendet werden.
- Vor Aenderungen muss der Session-Branch kontrolliert in einen regulaeren
  Entwicklungsbranch uebernommen werden; direktes Arbeiten auf dem aelteren
  `main` wuerde sechs Store-nahe Aenderungen verlieren.
- `app.json`, `.homeycompose/app.json` und `package.json` muessen auf dieselbe
  Releaseversion gebracht werden.

Zusaetzlicher Root Cause fuer `alarm_mqtt_connected`:

- Die Capability ist nur im generierten `app.json` eingetragen.
- Unter `.homeycompose/capabilities/` fehlt
  `alarm_mqtt_connected.json`.
- Ein Homey-Compose-Build kann deshalb die manuelle Definition verwerfen,
  obwohl der Laufzeitcode sie dynamisch hinzufuegt. Das erklaert den
  reproduzierten `Invalid Capability`-/404-Fehler.

## Prioritaet

1. Den sechs Commits weiterentwickelten Session-Branch als Store-nahe Basis in
   einen regulaeren Entwicklungsbranch uebernehmen und Versionen synchronisieren.
2. `alarm_mqtt_connected` entfernen oder korrekt definieren und Fehler
   isolieren.
3. SWS0A modellabhaengig auf `alarm_water` routen und falsch gekoppelte
   Geraete migrieren.
4. MQTT-Alarmtopics mit SUBACK-/Gesundheitsdiagnose fuer Rauch pruefen.
5. Flow-Listener zentral und einmalig registrieren.
6. SD19-MN vollstaendig in die Modellmatrix aufnehmen.
7. Diagnoseausgabe konsequent redigieren.

## Diagnose vom 11.08.2026 (App 1.1.14)

Quelle:

- Homey-Diagnose `558f2008-eaa0-429c-b3f8-9e20c1c0c618`
- Homey Pro (Early 2023), Homey `13.4.1-rc.2`
- Nutzerhinweis: Alle Sensoren aktualisierten sich nach monatelangem Betrieb
  ploetzlich nicht mehr.

Beobachtung:

- Der Bericht enthaelt weder Stacktrace noch `stderr`-Fehler.
- Die App findet eine SBS50-Station und alle acht untergeordneten Geraete.
- Der MQTT-Neuaufbau um 20:05 Uhr wird als erfolgreich bestaetigt; danach
  werden die Stations-Shadows ebenfalls erfolgreich gelesen.
- Nach einem App-Neustart um 20:10 Uhr funktionieren Cognito-Anmeldung,
  AWS-IoT-Zugang, Discovery, Shadow-Abruf und MQTT-Verbindung erneut.
- Version 1.1.14 stuft MQTT bereits nach erfolgreichem SUBACK als gesund ein
  und unterdrueckt dann das Fallback-Polling. Der Bericht beweist daher nicht,
  dass danach tatsaechlich Sensornachrichten empfangen wurden.

Schlussfolgerung:

- Kein neuer, eigenstaendiger Laufzeitfehler ist erkennbar.
- Das Fehlerbild wird durch die bereits lokal umgesetzten Korrekturen fuer
  automatische Cognito-/AWS-Credential-Erneuerung, MQTT-Wildcard-Topics und
  AWS-Retry abgedeckt.
- Aus diesem einzelnen Bericht laesst sich keine Regression der verwendeten
  Homey-RC-Version ableiten.

Zusaetzlicher Datenschutzbefund:

- Version 1.1.14 protokolliert noch SECRET_HASH, Request-MAC, vollstaendige
  API-Antworten mit AWS-Credentials und signierte MQTT-WebSocket-URLs.
- Der Entwicklungsstand entfernt diese Werte aus den Meldungen und speichert
  bei API-Aufrufen nur noch redigierte Anfragewerte sowie eine strukturelle
  Antwortzusammenfassung ohne Nutzdaten.
- Ein automatisierter Test stellt sicher, dass Credential-Werte nicht in der
  Antwortzusammenfassung erscheinen.
