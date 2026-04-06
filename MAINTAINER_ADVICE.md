# Maintainer Advice (Claw)

Based on my analysis of the Homey Community thread, GitHub issues, and the App certification report, here are some recommendations to solve the remaining issues:

## 1. 🖼️ Certification Issues (App Store Guidelines)

The reviewer mentioned distorted app images and identical driver icons.

*   **App Images:** Resize `assets/images/large.png` and `small.png` to a **square ratio** (e.g., 500x500 and 75x75). The current 500x350 ratio is likely being stretched by Homey's store UI.
*   **Driver Icons:** Although the SVG icons for `heat-sensor` and `mailbox-alarm` look unique (I checked the code), make sure they are visually distinct when rendered small.
*   **Driver Images:** The `large.png` images for several drivers (CO, Smoke, Water, Motion) were indeed identical in file size (91KB or 58KB). Provide unique photos/renders of the actual devices for each driver category.

## 2. 🏠 Shared Accounts / No Devices Found

I have implemented a fix for **shared house discovery** in `lib/XSenseAPI.js`. 
Previously, only own houses were returned if the API responded with an object containing `houseInfoList` and `shareHouseInfoList` instead of a direct array. This should fix the issue reported by Jordy M (XS01-WX not found).

## 3. 💨 Carbon Monoxide (SC07-WX)

I have updated the `smoke-detector` driver to correctly transmit **CO PPM values** to Homey. Combined smoke/CO detectors like the SC07-WX will now show both the alarm status and the current CO concentration (if supported by the device shadow).

## 4. 🌡️ Temperature & Humidity (STH51)

I have refined the parsing of `status.b` and `status.c` fields. Ensure that the device in Homey has the `measure_temperature` and `measure_humidity` capabilities. If they are missing, a simple repair or re-pairing might be needed after my recent code changes.

## 5. 🏷️ Tags & Categories

I noticed `app.json` has been updated with the recommended tags and categories. This is good!

---

**Next Steps:**
- Test the discovery with a shared account if possible.
- Verify the CO value display on a combo device.
- Replace the identical images in the `assets` folders.
