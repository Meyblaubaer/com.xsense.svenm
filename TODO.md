# X-Sense Homey App - TODO List

## Current Status: v1.1.5 (Production Ready)

✅ **Fully Functional App with AWS Cognito SRP Authentication**
- ✅ AWS Cognito Authentication implemented
- ✅ MQTT over AWS IoT WebSocket
- ✅ Thing Shadow API for device state
- ✅ Session management with re-authentication
- ✅ 6 Device Drivers (Smoke, CO, Motion, Temperature, Water, Heat)
- ✅ Flow Cards and capabilities
- ✅ Exponential backoff for server errors
- ✅ Credential encryption support

---

## Known Issues (7-Day Collection Period)

**Collection Period:** 2026-02-04 to 2026-02-11
**Batch Fix Version:** v1.1.10

### 1. MQTT "Quota exceeded" during app restart ✅ FIXED (v1.1.10)
**Status:** Fixed via Mutex & Batching
**Fixed:** 2026-02-16
**Changes:**
1. Added `SimpleMutex` to `XSenseAPI.js` to serialize connection attempts.
2. Implemented MQTT batch subscription in `_subscribeTopic`.
3. Optimized topic collection in `_subscribeStationTopics` to eliminate redundant calls.
4. Ensured atomic `subscriptions` Set updates before network calls.

---

## Recently Fixed (v1.1.5) ✅

### Session-expired loop with "bizCode cannot be empty"
- **Fixed:** lib/XSenseAPI.js:443-446, 572
- **Test Result:** 0 errors in 5-minute test, 22 successful API calls
- **Users Affected:** Eling (eling@stichting-eling.nl)
- **Changes:**
  - Added pre-emptive token validation before API calls
  - Extended session error detection to include "bizCode cannot be empty"

---

## User Education (No Code Fix Needed) ℹ️

### XS01-WX "Motion Sensor" Not Found
- **User:** Heiko (heiko.glueck@gmx.de)
- **Issue:** XS01-WX is a Wi-Fi Smoke Detector, not a motion sensor
- **Resolution:** User guidance to add under "Smoke Detector" category
- **Communication:** Drafted, pending send

### AWS Cognito RegEx Validation Error
- **User:** Pyrgomantis@yahoo.de
- **Issue:** External AWS Cognito validation error, outside app control
- **Resolution:** Workaround steps (password reset, email change, new account)
- **Communication:** Drafted, pending send

---

## Future Considerations

### Performance Optimization
- Consider implementing MQTT subscription pooling for large installations (10+ devices)
- Add device state caching to reduce API calls
- Implement progressive backoff for repeated MQTT quota errors

### Feature Requests
- Track user feature requests here during collection period
- Review before v1.2.0 planning

---

## Development Resources

### Helpful Links
- Python XSense Library: https://github.com/theosnel/python-xsense
- Home Assistant Integration: https://github.com/Jarnsen/ha-xsense-component_test
- AWS Cognito JS SDK: https://www.npmjs.com/package/amazon-cognito-identity-js
- AWS IoT SDK: https://www.npmjs.com/package/aws-iot-device-sdk

### Testing
- Always run 5-minute test with `homey app run` after fixes
- Analyze logs for errors, session loops, and MQTT stability
- Monitor API call counts and response times

### 2. Certification Issues (App Store Images) ✅ FIXED
**Status:** Images resized and unique graphics created
**Fixed:** 2026-02-16
**Changes:**
1. Resized all `large.png` and `small.png` to square ratio (500x500 and 75x75) to fix distortion.
2. Created distinctive, branded graphics for all driver categories (CO, Heat, Water, Door, Motion, Mailbox).
3. Ensured SVG icons are unique and placed in driver root folders.
