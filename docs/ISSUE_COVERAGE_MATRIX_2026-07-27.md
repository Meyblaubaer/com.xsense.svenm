# X-Sense Quellenabdeckung

Stand: 2026-08-02

Diese Matrix belegt, welche Forumbeitraege und GitHub-Issues fuer die
Portierungscheckliste vollstaendig gelesen wurden. Sie bewertet nicht allein
den GitHub-Status: Ein wegen Inaktivitaet geschlossenes Issue kann technisch
weiterhin offen sein.

## Legende

- `P`: Direkt fuer Protokoll, Parser, Sicherheit oder Zuverlaessigkeit relevant.
- `M`: Modell-, Capability- oder Aktionsumfang fuer den Homey-Port.
- `K`: Kamera; fuer das erste Release bewusst zurueckgestellt.
- `H`: Home-Assistant-/HACS-spezifischer Installations- oder Frameworkfehler.
- `N`: Test, Fehlmeldung oder themenfremdes Issue.

## Forum

| Quelle | Vollstaendig gelesen | Ergebnis |
|---|---:|---|
| [Aktueller Homey-Support-Thread](https://community.homey.app/t/148713) | 93/93 Beitraege | Alle Fehlerbilder in Hauptcheckliste uebernommen |
| [Zweiter deutscher Homey-Thread](https://community.homey.app/t/148872) | 14/14 Beitraege | Pairing-, Login-, Signal- und SWS0B-Hinweise uebernommen |
| [Historischer X-Sense-App-Thread](https://community.homey.app/t/119925) | komplett geprueft | Ueberwiegend Tuya XS01-WT; nur zur Abgrenzung relevant |

## Homey-App-Issues

Geprueft: 17 echte Issues inklusive aller vorhandenen Kommentare.

| Gelesen | Status | Issue | Titel | Einordnung |
|---:|---|---:|---|---|
| ja | closed | [#1](https://github.com/Meyblaubaer/com.xsense.svenm/issues/1) | SC07-WX not found | P |
| ja | closed | [#3](https://github.com/Meyblaubaer/com.xsense.svenm/issues/3) | Homey integration | P |
| ja | closed | [#4](https://github.com/Meyblaubaer/com.xsense.svenm/issues/4) | Smoke detectors not found | P |
| ja | closed | [#5](https://github.com/Meyblaubaer/com.xsense.svenm/issues/5) | No status in Homey | P |
| ja | closed | [#6](https://github.com/Meyblaubaer/com.xsense.svenm/issues/6) | no update from sensors towards homey | P |
| ja | closed | [#7](https://github.com/Meyblaubaer/com.xsense.svenm/issues/7) | Device not found | P |
| ja | closed | [#8](https://github.com/Meyblaubaer/com.xsense.svenm/issues/8) | Not all device capabilities updated | P |
| ja | closed | [#9](https://github.com/Meyblaubaer/com.xsense.svenm/issues/9) | Is it possible to create a flow trigger when the test button is pressed and the test was successful | P |
| ja | closed | [#10](https://github.com/Meyblaubaer/com.xsense.svenm/issues/10) | No updates | P |
| ja | closed | [#11](https://github.com/Meyblaubaer/com.xsense.svenm/issues/11) | No alarm to homey app | P |
| ja | open | [#12](https://github.com/Meyblaubaer/com.xsense.svenm/issues/12) | No Device found | P |
| ja | open | [#13](https://github.com/Meyblaubaer/com.xsense.svenm/issues/13) | New test button option is not working for me | P |
| ja | open | [#14](https://github.com/Meyblaubaer/com.xsense.svenm/issues/14) | Smoke alarm shows no temp and humidity | P |
| ja | open | [#15](https://github.com/Meyblaubaer/com.xsense.svenm/issues/15) | Added XS0F-PMA smoke detector linked with RFM2300ZW-B in X-Sense app. But I cannot add them in Homey. | P |
| ja | open | [#16](https://github.com/Meyblaubaer/com.xsense.svenm/issues/16) | Intergrade the SAL51 | P |
| ja | open | [#17](https://github.com/Meyblaubaer/com.xsense.svenm/issues/17) | Connection does not update in homey | P |
| ja | open | [#18](https://github.com/Meyblaubaer/com.xsense.svenm/issues/18) | I can’t add new devices | P |

Zusaetzlich geprueft:

- [PR #19: Add XS0F-PMA smoke detector to supported device types](https://github.com/Meyblaubaer/com.xsense.svenm/pull/19): nur Pairing-Whitelist fuer XS0F-PMA; Alarmrouting und Capabilities bleiben separat zu loesen. Der PR basiert auf dem aelteren `main`, nicht auf dem sechs Commits weiterentwickelten Session-Branch. Der einzige Check `Kilo Code Review` ist wegen eines fehlgeschlagenen Assistant-Aufrufs rot und liefert keine fachliche Codebewertung.

## Erneute GitHub-Pruefung am 2026-08-02

- Weiterhin 17 echte Issues: 7 offen und 10 geschlossen.
- Gegenueber dem Snapshot vom 2026-07-27 haben sich Titel, Status,
  Kommentarzahl und `updated_at` keines Issues geaendert.
- Weiterhin genau ein offener Pull Request: PR #19, ein Commit, eine Datei,
  `+3/-1`, ohne Review- oder Diskussionskommentare.
- GitHub meldet den PR als technisch zusammenfuehrbar, aber `unstable`: Der
  einzige Check ist fehlgeschlagen. Es gibt keine erfolgreichen Statuschecks.
- Die Aenderung darf nicht unveraendert als vollstaendige Unterstuetzung fuer
  XS0F-PMA gewertet werden. Sie erweitert nur die statische Pairing-Liste des
  alten `main`.
- Nach Uebernahme des Session-Branches muss `XS0F-PMA` in dessen
  `SMOKE_TYPES`-/`PairingHelper`-Pfad neu eingepflegt und danach mit Discovery-,
  State-, Alarm-, Test-, Mute- und Capability-Tests abgesichert werden.

## Home-Assistant-Issues

Geprueft: 123 echte Issues. Pull Requests im GitHub-Issue-API-Feed
wurden nicht als Issues mitgezaehlt. Auch eingeklappte und paginierte
Kommentarverlaeufe wurden nachgeladen.

| Gelesen | Status | Issue | Titel | Einordnung |
|---:|---|---:|---|---|
| ja | closed | [#3](https://github.com/Jarnsen/ha-xsense-component_test/issues/3) | Could not install the .13 version | H |
| ja | closed | [#4](https://github.com/Jarnsen/ha-xsense-component_test/issues/4) | test | N |
| ja | closed | [#6](https://github.com/Jarnsen/ha-xsense-component_test/issues/6) | Invalid handler specified | H |
| ja | closed | [#7](https://github.com/Jarnsen/ha-xsense-component_test/issues/7) | Error occurred loading flow for integration xsense: No module named 'xsense' | H |
| ja | closed | [#8](https://github.com/Jarnsen/ha-xsense-component_test/issues/8) | Impossible to configure | H |
| ja | closed | [#10](https://github.com/Jarnsen/ha-xsense-component_test/issues/10) | Invalid authentication | P |
| ja | closed | [#11](https://github.com/Jarnsen/ha-xsense-component_test/issues/11) | Test button disappears for XS01-M after adding XHO2-M and SC07-MR / Add test button for XHO2-M and SC07-MR | M |
| ja | closed | [#12](https://github.com/Jarnsen/ha-xsense-component_test/issues/12) | X-Sense Home Security configuration wizard will NOT start | H |
| ja | closed | [#13](https://github.com/Jarnsen/ha-xsense-component_test/issues/13) | Homeassistant 2024.12.1 complains about "Error while setting up xsense platform for button" | H |
| ja | closed | [#14](https://github.com/Jarnsen/ha-xsense-component_test/issues/14) | Mute status difference between 2 detector models (SC07-WX & XS01-WX) | P |
| ja | closed | [#15](https://github.com/Jarnsen/ha-xsense-component_test/issues/15) | Switching from original to new repo | H |
| ja | closed | [#16](https://github.com/Jarnsen/ha-xsense-component_test/issues/16) | cannot import name 'EnsureJobAfterCooldown' from 'homeassistant.components.mqtt.util' | H |
| ja | closed | [#18](https://github.com/Jarnsen/ha-xsense-component_test/issues/18) | Tous les détecteurs ne remontent pas (XS01-WX) | P |
| ja | closed | [#20](https://github.com/Jarnsen/ha-xsense-component_test/issues/20) | Change device_class for Smoke Detectors | M |
| ja | closed | [#21](https://github.com/Jarnsen/ha-xsense-component_test/issues/21) | Seit Update 2025.2.5 sind die x-sense Entitäten nicht mehr verfügbar. | H |
| ja | closed | [#22](https://github.com/Jarnsen/ha-xsense-component_test/issues/22) | XS01-WX problem | P |
| ja | closed | [#23](https://github.com/Jarnsen/ha-xsense-component_test/issues/23) | XH02-M: Missing Test Button in Home Assistant | M |
| ja | closed | [#24](https://github.com/Jarnsen/ha-xsense-component_test/issues/24) | xsense plugin will not load on Home Assistant 2025.3.0b0 (beta) | H |
| ja | closed | [#25](https://github.com/Jarnsen/ha-xsense-component_test/issues/25) | Setup failed for custom integration 'xsense': Requirements for xsense not found: ['paho-mqtt==1.6.1']. | H |
| ja | closed | [#26](https://github.com/Jarnsen/ha-xsense-component_test/issues/26) | xsense mailbox sensor | M |
| ja | closed | [#27](https://github.com/Jarnsen/ha-xsense-component_test/issues/27) | X-sense fails to start on HA 2025.3 | H |
| ja | closed | [#28](https://github.com/Jarnsen/ha-xsense-component_test/issues/28) | Integration doesn't work since HA 2025.3.0 update | H |
| ja | closed | [#29](https://github.com/Jarnsen/ha-xsense-component_test/issues/29) | Xsense won‘t activate due to mqtt error (paho-1.6.1) after upgrading to HA 25.3 | H |
| ja | closed | [#30](https://github.com/Jarnsen/ha-xsense-component_test/issues/30) | Setup failed for custom integration 'xsense': Requirements for xsense not found | H |
| ja | closed | [#31](https://github.com/Jarnsen/ha-xsense-component_test/issues/31) | Not working after HA Core Update to 2025.3.0 | H |
| ja | closed | [#32](https://github.com/Jarnsen/ha-xsense-component_test/issues/32) | Error Config flow could not be loaded: 500 Internal Server Error Server got itself in trouble. | H |
| ja | closed | [#33](https://github.com/Jarnsen/ha-xsense-component_test/issues/33) | paho-mqtt version issue with HA 2025.3.x | H |
| ja | closed | [#34](https://github.com/Jarnsen/ha-xsense-component_test/issues/34) | Adding AS05 security components | P |
| ja | closed | [#35](https://github.com/Jarnsen/ha-xsense-component_test/issues/35) | Updating to 1.0.16 - paho-mqtt requirement failure | H |
| ja | closed | [#36](https://github.com/Jarnsen/ha-xsense-component_test/issues/36) | STH51 detectors not available in HA 2025.3.x | M |
| ja | closed | [#38](https://github.com/Jarnsen/ha-xsense-component_test/issues/38) | Add integration XP0A-iR | M |
| ja | closed | [#39](https://github.com/Jarnsen/ha-xsense-component_test/issues/39) | Issue with X-Sense SC06-WX Integration ? | P |
| ja | closed | [#43](https://github.com/Jarnsen/ha-xsense-component_test/issues/43) | Authentication Problem | P |
| ja | closed | [#45](https://github.com/Jarnsen/ha-xsense-component_test/issues/45) | Feature request: Press button from HA | M |
| ja | closed | [#47](https://github.com/Jarnsen/ha-xsense-component_test/issues/47) | Keine Wertänderung bei Alarm, Fehler bei Test Taste | P |
| ja | closed | [#48](https://github.com/Jarnsen/ha-xsense-component_test/issues/48) | Smoke detector not deleted from HA after deleted in X-Sense App | P |
| ja | closed | [#50](https://github.com/Jarnsen/ha-xsense-component_test/issues/50) | Unable to login on core 2025.5.0 | P |
| ja | closed | [#51](https://github.com/Jarnsen/ha-xsense-component_test/issues/51) | Add support and test button for SC07-MR | M |
| ja | closed | [#52](https://github.com/Jarnsen/ha-xsense-component_test/issues/52) | MQTT Duplicate Client ID's? | P |
| ja | closed | [#53](https://github.com/Jarnsen/ha-xsense-component_test/issues/53) | Implementation for Disarm, Home and Away satus. | P |
| ja | closed | [#54](https://github.com/Jarnsen/ha-xsense-component_test/issues/54) | Device add request - XC0C-iA | M |
| ja | closed | [#56](https://github.com/Jarnsen/ha-xsense-component_test/issues/56) | Cannot install: 500 internal server error | H |
| ja | closed | [#58](https://github.com/Jarnsen/ha-xsense-component_test/issues/58) | Unable to log in – “Unknown error occurred” | P |
| ja | closed | [#59](https://github.com/Jarnsen/ha-xsense-component_test/issues/59) | X-Sense values start freezing | P |
| ja | closed | [#60](https://github.com/Jarnsen/ha-xsense-component_test/issues/60) | Document How To Change Password / Provide Means to Change Password Without Reinstalling | P |
| ja | closed | [#61](https://github.com/Jarnsen/ha-xsense-component_test/issues/61) | AP goes away | N |
| ja | closed | [#63](https://github.com/Jarnsen/ha-xsense-component_test/issues/63) | Misleading "Alarm Status" (Smoke/CO alarm SC07-WX) | P |
| ja | closed | [#64](https://github.com/Jarnsen/ha-xsense-component_test/issues/64) | Entities updating too slowly (Smoke/CO alarm SC07-WX) | P |
| ja | closed | [#65](https://github.com/Jarnsen/ha-xsense-component_test/issues/65) | Cannot add this repo as a custom repository | H |
| ja | closed | [#66](https://github.com/Jarnsen/ha-xsense-component_test/issues/66) | Entities available when device offline (Smoke/CO alarm SC07-WX) | P |
| ja | closed | [#67](https://github.com/Jarnsen/ha-xsense-component_test/issues/67) | Device request XP0A-iR | M |
| ja | closed | [#68](https://github.com/Jarnsen/ha-xsense-component_test/issues/68) | Compatability for X-Sense Link Pro +? | P |
| ja | closed | [#69](https://github.com/Jarnsen/ha-xsense-component_test/issues/69) | XS01-WX - AttributeError: 'Station' object has no attribute 'station' when clicking test button | P |
| ja | closed | [#70](https://github.com/Jarnsen/ha-xsense-component_test/issues/70) | Login nicht immer möglich | P |
| ja | closed | [#71](https://github.com/Jarnsen/ha-xsense-component_test/issues/71) | configuratione name "none" for button | M |
| ja | closed | [#72](https://github.com/Jarnsen/ha-xsense-component_test/issues/72) | XS01-WX Alarm Status does not update | P |
| ja | closed | [#73](https://github.com/Jarnsen/ha-xsense-component_test/issues/73) | Failed setup, will retry: not enough values to unpack (expected 2, got 1) | P |
| ja | closed | [#74](https://github.com/Jarnsen/ha-xsense-component_test/issues/74) | Integration won't load | H |
| ja | closed | [#75](https://github.com/Jarnsen/ha-xsense-component_test/issues/75) | Entities are not updated | P |
| ja | closed | [#76](https://github.com/Jarnsen/ha-xsense-component_test/issues/76) | current problems with integration | P |
| ja | closed | [#77](https://github.com/Jarnsen/ha-xsense-component_test/issues/77) | x-sense integration no longer works caused by "Name does not resolve" | P |
| ja | closed | [#81](https://github.com/Jarnsen/ha-xsense-component_test/issues/81) | Implement diagnostics data functionality | P |
| ja | closed | [#83](https://github.com/Jarnsen/ha-xsense-component_test/issues/83) | Calculation issues on battery value | P |
| ja | closed | [#85](https://github.com/Jarnsen/ha-xsense-component_test/issues/85) | XC0C-iA | M |
| ja | closed | [#88](https://github.com/Jarnsen/ha-xsense-component_test/issues/88) | Missing Test Button for XS0B-MR | M |
| ja | closed | [#89](https://github.com/Jarnsen/ha-xsense-component_test/issues/89) | Update ASYNC Update | P |
| ja | closed | [#90](https://github.com/Jarnsen/ha-xsense-component_test/issues/90) | XS01-WX Alarm Status does not update | P |
| ja | closed | [#92](https://github.com/Jarnsen/ha-xsense-component_test/issues/92) | X-sense STH0A sensor support? | M |
| ja | closed | [#93](https://github.com/Jarnsen/ha-xsense-component_test/issues/93) | SWS0A water alarm shows as smoke alarm | P |
| ja | closed | [#94](https://github.com/Jarnsen/ha-xsense-component_test/issues/94) | Integration for Smoke Detector Model XS0D-MR61 | M |
| ja | closed | [#96](https://github.com/Jarnsen/ha-xsense-component_test/issues/96) | Remove devices | P |
| ja | closed | [#97](https://github.com/Jarnsen/ha-xsense-component_test/issues/97) | Issue with X-Sense SC06-WX Integration ? | M |
| ja | closed | [#98](https://github.com/Jarnsen/ha-xsense-component_test/issues/98) | IPv6 breaks integration | P |
| ja | closed | [#99](https://github.com/Jarnsen/ha-xsense-component_test/issues/99) | XS0D-MR Test Button | M |
| ja | closed | [#100](https://github.com/Jarnsen/ha-xsense-component_test/issues/100) | Integration for X-Sense Smart Mailbox Alarm SMA11 | M |
| ja | closed | [#101](https://github.com/Jarnsen/ha-xsense-component_test/issues/101) | Integration for Smoke Detector Model XPOA-IR | P |
| ja | closed | [#102](https://github.com/Jarnsen/ha-xsense-component_test/issues/102) | Alarm data | P |
| ja | closed | [#103](https://github.com/Jarnsen/ha-xsense-component_test/issues/103) | Cannot configure | H |
| ja | closed | [#105](https://github.com/Jarnsen/ha-xsense-component_test/issues/105) | Alarm control mode | P |
| ja | closed | [#107](https://github.com/Jarnsen/ha-xsense-component_test/issues/107) | https://github.com/Jarnsen/ha-xsense-component_test is not a valid add-on repository | H |
| ja | closed | [#108](https://github.com/Jarnsen/ha-xsense-component_test/issues/108) | Error invalid repository | H |
| ja | closed | [#110](https://github.com/Jarnsen/ha-xsense-component_test/issues/110) | STH0A Smart Thermometer Hygrometer reports "detected smoke" | P |
| ja | closed | [#111](https://github.com/Jarnsen/ha-xsense-component_test/issues/111) | authentication allegedly failed | P |
| ja | closed | [#113](https://github.com/Jarnsen/ha-xsense-component_test/issues/113) | "Connect to Home Assistant" option | P |
| ja | closed | [#114](https://github.com/Jarnsen/ha-xsense-component_test/issues/114) | Newer Hygrometer Thermometer recently released from X-Sense: STH0B | M |
| ja | closed | [#116](https://github.com/Jarnsen/ha-xsense-component_test/issues/116) | Remove device option | P |
| ja | closed | [#118](https://github.com/Jarnsen/ha-xsense-component_test/issues/118) | Support for X-Sense SDS0A door sensor | M |
| ja | closed | [#119](https://github.com/Jarnsen/ha-xsense-component_test/issues/119) | Question:  What are smoke sensors in the carbon monoxide XC0C-MR and leak detector SWS51? | P |
| ja | closed | [#121](https://github.com/Jarnsen/ha-xsense-component_test/issues/121) | Setup failed for custom integration 'xsense': Requirements for xsense not found: ['python-xsense==0.0.16']. Source: setup.py:278 #331 | H |
| ja | closed | [#122](https://github.com/Jarnsen/ha-xsense-component_test/issues/122) | No Smoke Alarm Entity for XS01-WX | P |
| ja | closed | [#123](https://github.com/Jarnsen/ha-xsense-component_test/issues/123) | Subscription.__init__() missing 1 required positional argument: 'subscription_id' on HA 2026.6.0b0 | H |
| ja | closed | [#148](https://github.com/Jarnsen/ha-xsense-component_test/issues/148) | Track alarm and test event updates from X-Sense | P |
| ja | closed | [#149](https://github.com/Jarnsen/ha-xsense-component_test/issues/149) | Track siren and alarm triggering support | P |
| ja | closed | [#150](https://github.com/Jarnsen/ha-xsense-component_test/issues/150) | Verify standalone Wi-Fi detector coverage | P |
| ja | closed | [#151](https://github.com/Jarnsen/ha-xsense-component_test/issues/151) | Investigate X-Sense camera device support | K |
| ja | closed | [#160](https://github.com/Jarnsen/ha-xsense-component_test/issues/160) | Failed setup, will retry:  XSense API Issue: Unable to retrieve station data: 404 | P |
| ja | closed | [#165](https://github.com/Jarnsen/ha-xsense-component_test/issues/165) | Unable to retrieve station data: 404 | P |
| ja | closed | [#167](https://github.com/Jarnsen/ha-xsense-component_test/issues/167) | Camera Error but i don't have a camera | K |
| ja | closed | [#171](https://github.com/Jarnsen/ha-xsense-component_test/issues/171) | Detected blocking call to load_default_certs & Detected blocking call to set_default_verify_paths Warning in HA Logs | P |
| ja | closed | [#176](https://github.com/Jarnsen/ha-xsense-component_test/issues/176) | Could not update X-Sense camera data | K |
| ja | closed | [#178](https://github.com/Jarnsen/ha-xsense-component_test/issues/178) | Remove Serial Number Sensors | P |
| ja | open | [#182](https://github.com/Jarnsen/ha-xsense-component_test/issues/182) | SSC0A Cam isn't working | K |
| ja | closed | [#188](https://github.com/Jarnsen/ha-xsense-component_test/issues/188) | Loop error at startup | P |
| ja | closed | [#190](https://github.com/Jarnsen/ha-xsense-component_test/issues/190) | Timed out connecting to X-Sense | P |
| ja | closed | [#196](https://github.com/Jarnsen/ha-xsense-component_test/issues/196) | Fix: Subscription.__init__() missing subscription_id (HA 2025.x compatibility) | H |
| ja | closed | [#199](https://github.com/Jarnsen/ha-xsense-component_test/issues/199) | Confusing/misleading behavior with smoke detectors | P |
| ja | closed | [#200](https://github.com/Jarnsen/ha-xsense-component_test/issues/200) | Configuration error, wird erneut versucht: Subscription.__init__() takes from 5 to 7 positional arguments but 8 were given | H |
| ja | closed | [#210](https://github.com/Jarnsen/ha-xsense-component_test/issues/210) | After Update to HA Core 2026.6.1 - X-sense 1.0.18 issues - Einrichtungsfehler, wird erneut versucht: Subscription.__init__() missing 1 required positional argument: 'subscription_id' | H |
| ja | closed | [#211](https://github.com/Jarnsen/ha-xsense-component_test/issues/211) | Update not shown in HomeAssistant | P |
| ja | closed | [#232](https://github.com/Jarnsen/ha-xsense-component_test/issues/232) | Old v1.2.6.x releases fail to install on HA 2026.7 (Python 3.14) — aiortc has no cp314 wheel | K |
| ja | closed | [#233](https://github.com/Jarnsen/ha-xsense-component_test/issues/233) | Homeassistant Core 7.0 issues with X-Sense Version 1.2.6.18 | K |
| ja | closed | [#234](https://github.com/Jarnsen/ha-xsense-component_test/issues/234) | Xcom-IR Integration | M |
| ja | closed | [#235](https://github.com/Jarnsen/ha-xsense-component_test/issues/235) | xsense-recordings dashboard exists even though I dont have any cameras | K |
| ja | open | [#236](https://github.com/Jarnsen/ha-xsense-component_test/issues/236) | Feature Request / Patch: Use X-Sense SKP0A keypad codes as Home Assistant events | M |
| ja | closed | [#238](https://github.com/Jarnsen/ha-xsense-component_test/issues/238) | X-Sense Recordings menu has appeared | K |
| ja | closed | [#239](https://github.com/Jarnsen/ha-xsense-component_test/issues/239) | X-Sense calls hass.async_create_task from a thread other than the event loop which may cause Home Assistant to crash or data to corrupt | P |
| ja | closed | [#240](https://github.com/Jarnsen/ha-xsense-component_test/issues/240) | After Update to 1.4.1 - Missing Entities | P |
| ja | closed | [#241](https://github.com/Jarnsen/ha-xsense-component_test/issues/241) | New Version 1.4.3 no Entity available anymore | P |
| ja | closed | [#242](https://github.com/Jarnsen/ha-xsense-component_test/issues/242) | After update: All entities stopped working! | P |
| ja | open | [#243](https://github.com/Jarnsen/ha-xsense-component_test/issues/243) | No self Test for XS01-WX | M |
| ja | closed | [#244](https://github.com/Jarnsen/ha-xsense-component_test/issues/244) | Co Levels missing from sensor since Version 1.4.6 update | P |
| ja | closed | [#245](https://github.com/Jarnsen/ha-xsense-component_test/issues/245) | ERROR - The entity no longer has a state class | P |
| ja | closed | [#246](https://github.com/Jarnsen/ha-xsense-component_test/issues/246) | Mute button not working for muting alarm sound | P |

## Auswertungsregel

- `closed` ohne bestaetigten Fix bleibt als Risiko in der Hauptcheckliste.
- Ein einzelner erfolgreicher Kommentar hebt spaetere Gegenmeldungen nicht auf.
- Home-Assistant-spezifische Fehler werden nicht portiert, ihre technischen
  Ursachen wie blockierendes I/O, Thread-Safety oder Dependency-Konflikte aber
  als Python-Risiko beruecksichtigt.
- Kamera-Issues bleiben dokumentiert, werden jedoch nicht in die erste
  Homey-Python-Version aufgenommen.
