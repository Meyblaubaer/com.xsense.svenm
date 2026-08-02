# X-Sense HACS-zu-Homey-Adaptionsplan

Stand: 2026-07-27

Gepruefter HACS-Stand:

- Repository: `Jarnsen/ha-xsense-component_test`
- Commit: `fb02dd91c8ee984cd0114e20659f1e61388b8e7e`
- Stand: Vorbereitung von `v1.4.13.7`
- Lizenz: Apache-2.0

## Grundentscheidung

Nicht die komplette HACS-Integration nach Homey portieren. Stattdessen den
weitgehend unabhaengigen Code unter `custom_components/xsense/python_xsense`
als Protokollreferenz verwenden und daraus einen kleinen Homey-neutralen
X-Sense-Kern bauen.

Home Assistant und Homey erhalten jeweils nur einen duennen Adapter um diesen
Kern. Dadurch bleiben Parser, Modellwissen und MQTT-Verhalten testbar, ohne
Home-Assistant-Klassen in die Homey-App zu ziehen.

## P0: Direkt adaptieren

### [ ] Normalisiertes Haus-/Stations-/Geraetemodell

Quelle:

- `python_xsense/house.py`
- `python_xsense/station.py`
- `python_xsense/device.py`
- `python_xsense/entity.py`

Nutzen:

- Einheitliche Aufloesung von `houseId`, `stationId`, Seriennummer und
  Kindgeraet.
- Lookup sowohl ueber Cloud-ID als auch Seriennummer.
- Verschachtelte `status`-, `peak`- und geraetespezifische Daten werden
  vereinheitlicht.
- Safe-Mode und Online-Status sind Teil des Domain-Modells.

Homey-Anpassung:

- Domain-Objekte duerfen keine Home-Assistant- oder Homey-Klassen importieren.
- Stabile Homey-Geraete-ID getrennt von veraenderlichen Cloud-IDs halten.

### [ ] Property- und Typ-Normalisierung

Quelle:

- `python_xsense/mapping.py`

Adaptierbar:

- Minifizierte Felder wie `a`, `b`, `c` modellabhaengig aufloesen.
- Boolean-, Integer-, Float-, Bereichs- und Tuerzustandswerte sicher parsen.
- `None` fuer unbekannte Werte statt irrefuehrendem `0` oder `false`.
- `wifiRssi` und andere Aliasnamen vereinheitlichen.

Homey-Anpassung:

- Parsergebnis zuerst normalisieren und erst danach in Homey-Capabilities
  uebersetzen.

### [ ] MQTT-Ereignisparser und Geraeterouting

Quelle:

- `python_xsense/event_parser.py`
- `python_xsense/base.py`
- zugehoerige Tests in `tests/test_coordinator.py`

Adaptierbar:

- Standard-Shadows und X-Sense-`eventData` auf dieselbe Datenform bringen.
- Identifikatoren rekursiv aus Payloads und JSON-Strings sammeln.
- `deviceSN`, `deviceSn`, `_deviceSN`, numerische Child-ID und weitere Aliase
  gleichwertig behandeln.
- `devs` als Dict oder Liste sowie top-level Child-Container wie `00000007`
  aufloesen.
- `isAlarm` nur in den kanonischen Alarmstatus spiegeln, wenn kein expliziter
  Status vorhanden ist.
- Selbsttestresultat, Zeit und Fehlerflags getrennt normalisieren.
- Presence-, Shadow-, House- und Selbsttest-Topics unterscheiden.

Homey-Anpassung:

- Parser muss reine Funktionen liefern.
- Ausgabe als normalisiertes Ereignis:
  `event_type`, `house_id`, `station_sn`, `device_sn`, `timestamp`, `state`.
- Deduplizierung vor Capability- und Flow-Aktualisierung.

### [ ] Modell-, Capability- und Aktionsmatrix

Quelle:

- `python_xsense/entity_map.py`

Ausgangslage:

- 72 Modell-/Geraeteeintraege.
- 125 modellbezogene Aktionsdefinitionen.
- Getrennte Typen fuer Rauch, CO, Kombimelder, Hitze, Wasser, Temperatur,
  Tuer, Bewegung, Mailbox, Keypad, Listener, Licht, Radon und weitere.

Adaptierbar:

- Modellklasse bestimmt den Homey-Treiber.
- Capabilities entstehen aus Modellklasse plus tatsaechlich gelieferten Daten.
- Test, Mute und Fire Drill nur anbieten, wenn die Aktionsroute vollstaendig
  aufgeloest werden kann.
- Unterschiedliche Topics, Shadows, Targets, Zeitformate und Zusatzfelder pro
  Modell uebernehmen.
- XS01-WX-v9-, SBS50- und WiFi-Sonderfaelle zentral behandeln.

Homey-Anpassung:

- Aus derselben Matrix Pairing-Filter, Capabilities und Flow-Verfuegbarkeit
  ableiten.
- Keine statischen Sammel-Capabilities wie Temperatur/CO auf jedem
  Rauchmelder.
- Aktionen erst als erfolgreich melden, wenn eine Geraeterueckmeldung vorliegt.

### [ ] Thing- und Shadow-Namensregeln

Quelle:

- `python_xsense/entity.py`
- `python_xsense/async_xsense.py`
- `python_xsense/mqtt_helper.py`

Adaptierbar:

- `SBS50{sn}`, `SBS10`, `{type}-{sn}` und `{type}{sn}` korrekt unterscheiden.
- XS01-WX-v9 anhand Seriennummer mit abweichendem Bindestrich behandeln.
- House-Level- statt Station-Level-Shadows fuer bestimmte WiFi-Geraete.
- Modellabhaengige `mainpage`, `2nd_mainpage`, `info`, `2nd_info`,
  `2nd_safemode` und per-device Info-Shadows.
- Optionale Shadows mit `404` ueberspringen, ohne das gesamte Geraet zu
  verwerfen.

## P1: Mit Homey-Adapter adaptieren

### [ ] Asynchroner API-Client und Session-Lebenszyklus

Quelle:

- `python_xsense/async_xsense.py`
- `python_xsense/base.py`
- `python_xsense/exceptions.py`

Adaptierbar:

- Dynamische Client-/Cognito-Konfiguration.
- Access-, Refresh- und AWS-Token mit Ablaufzeit.
- Einmaliger Refresh und Retry bei `401`/`403`.
- Fehlerklassen fuer Auth, Session, API, Timeout und Not Found.
- Initiale Voll-Discovery getrennt von regelmaessigen Statusupdates.

Nicht ungeprueft kopieren:

- `boto3`, `botocore` und `pycognito` sind relativ schwere Abhaengigkeiten.
- Fuer Homey zuerst Paketgroesse, Python-3.14-Kompatibilitaet und
  Plattformverfuegbarkeit pruefen.
- Bestehende JS-SRP-Implementierung kann fuer Auth stabiler bleiben, falls
  Homey-Python diese Pakete nicht verlaesslich bereitstellt.

### [ ] MQTT-Helfer, nicht den HA-MQTT-Client

Quelle:

- Adaptieren: `python_xsense/mqtt_helper.py`
- Nicht portieren: `custom_components/xsense/mqtt.py`

Adaptierbar:

- AWS-signierte WebSocket-URL mit begrenzter Lebensdauer.
- Zufallige MQTT-Client-ID.
- Wildcard-Shadow-, Presence- und House-Event-Topics.
- QoS 1 fuer Subscriptions.
- Reconnect-Backoff.
- Shadow-ACK-Topics herausfiltern.
- Temperaturdaten gezielt ueber `2nd_apptempdata` anfordern.

Homey-Anpassung:

- Eigener kleiner Subscription-Manager mit Soll-/Ist-Zustand und SUBACK.
- Callback thread-sicher in den Homey-Python-Event-Loop uebergeben.
- Langsames Kontroll-Polling trotz bestehender MQTT-Verbindung beibehalten.

### [ ] Verfuegbarkeits- und Last-Seen-Regeln

Quelle:

- `python_xsense/entity.py`
- `tests/test_entity_availability.py`

Adaptierbar:

- Explizites `online`/`onLine` hat Vorrang.
- Reportzeit nur als modellabhaengige Zusatzindikation.
- Standardfrist 34 Stunden.
- Erweiterte Frist 49 Stunden fuer SWS0B und XR0A-iR.
- Modelle mit unzuverlaessiger Reportzeit von dieser Heuristik ausnehmen.

Homey-Anpassung:

- Fristen als Matrixdaten und nicht als verstreute Bedingungen speichern.
- Lokales Update niemals als neue echte Geraeteaktivitaet verbuchen.

### [ ] Security-Modi, Keypad und Stationsaktionen

Quelle:

- `python_xsense/station.py`
- Aktionshelfer in `python_xsense/async_xsense.py`
- Keypad-Tests und Blueprints

Adaptierbar:

- `Disarmed`, `Home` und `Away` lesen und setzen.
- Keypad-Modus- und Codeereignisse aus `2nd_safenotice`.
- SOS starten/beenden, Alarm abbrechen und Fire Drill.
- Signal- und Installationsmodus fuer kompatible RF-Geraete.

Sicherheitsgrenzen:

- Keypad-PIN immer redigieren.
- Stationsaktionen nur nach APK-belegter Route und modellbezogen freischalten.
- Keine optimistische Erfolgsmeldung.

### [ ] Geraetekonfiguration

Quelle:

- Config-Writer in `python_xsense/async_xsense.py`
- `number.py`, `select.py` und `switch.py` nur als Funktionsinventar

Moegliche Homey-Einstellungen:

- Alarm- und Sprachlautstaerke.
- Alarmton.
- LED-/Chirp-Einstellungen.
- Temperatur-/Feuchtebereiche.
- Warnungen und Mute-Status.

Voraussetzung:

- Nur Werte anzeigen, die das konkrete Modell berichtet oder deren
  Schreibroute in der Matrix bestaetigt ist.
- Wertebereiche vor dem Versand validieren.

### [ ] History als Fallback

Quelle:

- History-Methoden in `python_xsense/async_xsense.py`
- Normalisierung in `python_xsense/event_parser.py`

Adaptierbar:

- Tages-/Monatshistorie.
- Stations- und Geraetehistorie.
- CO- und Temperaturverlauf.
- Security-Dispatch-Historie.

Homey-Anpassung:

- Zunaechst nur fuer verpasste Selbsttest-/Alarmberichte verwenden.
- Letzte stabile Event-ID/Zeit speichern und alte Ereignisse deduplizieren.
- Keine umfangreiche Verlaufsdatenbank in der ersten Version.

### [ ] Redigierte Supportdiagnose

Quelle:

- `diagnostics.py`
- `tests/test_diagnostics.py`

Adaptierbar:

- Nur funktionale Schluessel statt kompletter Rohpayloads exportieren.
- E-Mail, Passwort, Token, IDs, Seriennummern, Netzwerkdaten und PIN redigieren.
- Token nur als vorhanden/abgelaufen/Restlaufzeit melden.
- Modellzahlen, MQTT-Verbindungszustand und letzte Topic-Kategorie ausgeben.

## P2: Testmuster adaptieren

### [ ] Protokolltests nach Homey uebertragen

Besonders wertvoll:

- Child-Routing fuer Listen, `devs` und numerische IDs.
- SBS50-Alarm und `2nd_safenotice`.
- Selbsttest-Topicvarianten und Fehlerflags.
- Thing-/Shadow-Namensregeln.
- Aktionsroute muss vor Anzeige vollstaendig aufloesbar sein.
- Availability mit explizitem Offline und veralteter Reportzeit.
- Fehlender optionaler Shadow.
- Kein doppeltes Geraet bei spaeter auftauchender Seriennummer.
- Redaction-Tests fuer Diagnosen und Logs.

Nicht die HA-Testumgebung kopieren. Dieselben anonymisierten Payloads gegen den
Homey-neutralen Kern testen.

## Nicht portieren

- `coordinator.py`: Home-Assistant-DataUpdateCoordinator und Event-Bus.
- `binary_sensor.py`, `sensor.py`, `button.py`, `switch.py`, `select.py`,
  `number.py`: nur als Funktions- und Capability-Inventar verwenden.
- `config_flow.py`, `manifest.json`, `hacs.json`, `repairs.py`: HACS-/HA-Lebenszyklus.
- `custom_components/xsense/mqtt.py`: Kopie interner HA-MQTT-Infrastruktur und
  bereits mehrfach durch HA-API-Aenderungen gebrochen.
- `frontend.py`, `http.py`, `media_source.py`: HA-spezifische Oberflaeche.
- Kamera-, Recording-, WebRTC-, `aiortc`-, `av`- und Pion-Bausteine fuer das
  erste Homey-Release.

## Lizenzanforderung

Wenn Apache-2.0-Code direkt kopiert oder abgeleitet wird:

- Apache-2.0-Lizenz in das Homey-Projekt aufnehmen.
- Bestehende Copyright-/Attributionshinweise erhalten.
- Veraenderte Dateien als veraendert kennzeichnen.
- Vorhandene `NOTICE`-Hinweise uebernehmen, falls spaeter welche hinzukommen.

Alternativ nur das dokumentierte Protokollwissen verwenden und die
Homey-neutrale Implementierung neu schreiben.

## Empfohlene Umsetzung

1. `xsense_core` mit Models, Mapping, Event-Parser und Matrix erstellen.
2. Bestehende HACS-Fixtures als anonymisierte Core-Regressionstests nachbauen.
3. Async API/Auth und Shadow-Auswahl integrieren.
4. MQTT-Subscription-Manager mit sicherem Event-Loop-Handoff implementieren.
5. Homey-Adapter fuer Pairing, Capabilities und Flow-Karten erstellen.
6. Settings, Security-Modi und History-Fallback danach ergaenzen.
7. Kameras weiterhin getrennt behandeln.
