# X-Sense Homey 1.1.12: Implementierte Fehlerkorrekturen

Stand: 2026-08-02

## GitHub-Zuordnung

| Quelle | Umsetzung | Regressionstest |
|---|---|---|
| Issue #12 | SWS0B-Stationen ohne Kindgeraete werden als Wassergeraet entdeckt und mit stabiler ID gekoppelt. | `test/api-discovery.test.js`, `test/pairing-helper.test.js` |
| Issue #13 | Physische Selbsttests werden aus Event-, Shadow- und verschachtelten SBS50-Payloads normalisiert; der Flow startet erst nach Geraetebericht. | `test/event-normalizer.test.js` |
| Issue #14 | Modellbezogene Mindest-Capabilities, echte UTC-Quellzeit und unbekannte CO-Werte statt falscher Nullwerte. | `test/model-registry.test.js`, `test/event-normalizer.test.js` |
| Issue #15 / PR #19 | XS0F-PMA ist in der zentralen Modellmatrix enthalten; Pairing, Alarmparser, `acBreak` und `baseRemove` sind abgedeckt. | `test/model-registry.test.js`, `test/event-normalizer.test.js` |
| Issue #16 | SAL51 wird als kombinierter Rauch-/CO-Listener gekoppelt; explizite Smoke-/CO-Alarmtypen werden getrennt geroutet. | `test/model-registry.test.js`, `test/event-normalizer.test.js` |
| Issue #17 | `online` und `onLine` steuern Homey-Verfuegbarkeit; Kontroll-Polling bleibt auch bei gesundem MQTT aktiv. | `test/api-discovery.test.js` |
| Issue #18 | Discovery-Retry, stabile Fallback-IDs, Deduplizierung und modellbezogene Treiberzuordnung stabilisieren erneutes Pairing. | `test/pairing-helper.test.js` |
| Closed #5/#6 | Alle Treiber initialisieren jetzt API, MQTT, Callback und Kontroll-Polling ueber denselben Basis-Lebenszyklus. | Publish-Validierung und Syntaxpruefung |
| Closed #9/#11 | Rekursiver `devs`-/`notices`-/Safe-Notice-Parser und bestaetigte Selbsttest-Flows ersetzen Root-only- und Optimistic-Handling. | `test/event-normalizer.test.js` |

## Zusaetzliche Korrekturen

- `mute_alarm` wird genau einmal in `App.onInit` registriert.
- `alarm_mqtt_connected` besitzt jetzt eine kanonische Homey-Compose-Datei
  und ist explizit von der Capture-Ignore-Regel ausgenommen.
- Soll-, ausstehende und bestaetigte MQTT-Subscriptions werden getrennt
  verfolgt; Gesundheit wird erst nach Broker-Bestaetigung gemeldet.
- Alarmtopics werden vor optionalen Topics abonniert.
- Fehlgeschlagene oder leere Discovery ersetzt keinen zuvor erfolgreichen
  Cache.
- TLS-Zertifikate werden wieder geprueft.
- MQTT-, Shadow- und Sensordiagnosen werden vor Log- und Dateiausgabe
  redigiert.
- AWS- und MQTT-Abhaengigkeiten wurden aktualisiert; `npm audit` meldet keine
  bekannte Schwachstelle.

## Validierung

- `npm test`: 12/12 Tests erfolgreich.
- Syntaxpruefung aller App-, Library-, Treiber- und Testdateien erfolgreich.
- Homey CLI: Publish-Level-Validierung erfolgreich.
- `npm audit`: 0 bekannte Schwachstellen.

Physische Alarme koennen lokal nicht ausgeloest werden. Reporter sollen ein
Issue erneut oeffnen, falls ein reales Geraet mit 1.1.12 weiterhin abweicht.
