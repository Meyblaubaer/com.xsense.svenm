'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Enhanced Debug Logger for X-Sense Integration
 *
 * Features:
 * - MQTT traffic logging (all topics + payloads)
 * - SSL/TLS handshake logging
 * - Shadow data dumping to files
 * - Sensor-specific debugging
 * - Structured logging like Home Assistant
 *
 * Enable via: XSENSE_DEBUG=true or XSENSE_DEBUG=mqtt,shadows,sensors
 */
class DebugLogger {
  constructor(homey, context = 'XSense') {
    this.homey = homey;
    this.context = context;

    // Parse debug flags from environment or Homey settings
    this.debugEnabled = this._parseDebugFlags();

    // Create debug output directory
    this.debugDir = '/tmp/xsense-debug';
    if (this.debugEnabled.any) {
      try {
        if (!fs.existsSync(this.debugDir)) {
          fs.mkdirSync(this.debugDir, { recursive: true });
        }
      } catch (err) {
        this.error('[DebugLogger] Failed to create debug directory:', err);
      }
    }

    // MQTT message counter
    this.mqttMessageCount = 0;
    this.shadowDumpCount = 0;

    // Memory Management: Limit stored messages
    this.maxMessages = 1000; // Keep last 1000 messages
    this.messages = [];

    if (this.debugEnabled.any) {
      this.log('=== DEBUG MODE ENABLED ===');
      this.log(`Flags: ${JSON.stringify(this.debugEnabled)}`);
      this.log(`Debug directory: ${this.debugDir}`);
      this.log(`Message limit: ${this.maxMessages}`);
    }
  }

  /**
   * Parse debug flags from environment or default to all enabled
   */
  _parseDebugFlags() {
    const envDebug = process.env.XSENSE_DEBUG || '';

    if (!envDebug || envDebug === 'false' || envDebug === '0') {
      return { any: false };
    }

    if (envDebug === 'true' || envDebug === '1') {
      // Enable all debug modes
      return {
        any: true,
        mqtt: true,
        shadows: true,
        sensors: true,
        ssl: true,
        api: true,
        all: true
      };
    }

    // Parse specific flags: XSENSE_DEBUG=mqtt,shadows,sensors
    const flags = envDebug.toLowerCase().split(',').map(f => f.trim());
    return {
      any: flags.length > 0,
      mqtt: flags.includes('mqtt'),
      shadows: flags.includes('shadows'),
      sensors: flags.includes('sensors'),
      ssl: flags.includes('ssl'),
      api: flags.includes('api'),
      all: flags.includes('all')
    };
  }

  /**
   * Log with context - uses Homey logger if available
   */
  log(...args) {
    const timestamp = new Date().toISOString();
    const message = `[${timestamp}] [${this.context}]`;
    const sanitizedArgs = args.map((arg) => this._sanitizeLogArg(arg));

    if (this.homey && this.homey.app) {
      this.homey.app.log(message, ...sanitizedArgs);
    } else if (this.homey && this.homey.log) {
      this.homey.log(message, ...sanitizedArgs);
    } else {
      // Fallback for testing without Homey
      console.log(message, ...sanitizedArgs);
    }
  }

  /**
   * Error logging with context
   */
  error(...args) {
    const timestamp = new Date().toISOString();
    const message = `[${timestamp}] [${this.context}] ERROR:`;
    const sanitizedArgs = args.map((arg) => this._sanitizeLogArg(arg));

    if (this.homey && this.homey.app) {
      this.homey.app.error(message, ...sanitizedArgs);
    } else if (this.homey && this.homey.error) {
      this.homey.error(message, ...sanitizedArgs);
    } else {
      // Fallback for testing without Homey
      console.error(message, ...sanitizedArgs);
    }
  }

  /**
   * Add message to in-memory buffer with size limit
   */
  _addMessage(message) {
    this.messages.push(message);

    // Keep only last N messages to prevent memory leaks
    if (this.messages.length > this.maxMessages) {
      this.messages = this.messages.slice(-this.maxMessages);
    }
  }

  /**
   * Log MQTT message
   */
  logMQTTMessage(direction, topic, payload, metadata = {}) {
    if (!this.debugEnabled.mqtt && !this.debugEnabled.all) return;

    this.mqttMessageCount++;
    const timestamp = new Date().toISOString();
    const messageId = this.mqttMessageCount;

    const logEntry = {
      timestamp,
      messageId,
      direction, // 'incoming' or 'outgoing'
      topic: this._sanitizeTopic(topic),
      payload: this._sanitizeData(this._tryParseJSON(payload)),
      metadata: this._sanitizeData(metadata)
    };

    // Store in memory with limit
    this._addMessage(logEntry);

    // Console log
    this.log(`MQTT ${direction.toUpperCase()} #${messageId}`);
    this.log(`  Topic: ${logEntry.topic}`);
    if (typeof logEntry.payload === 'object') {
      this.log(`  Payload:`, JSON.stringify(logEntry.payload, null, 2));
    } else {
      this.log('  Payload: [redacted non-JSON payload]');
    }
    if (Object.keys(metadata).length > 0) {
      this.log(`  Meta:`, logEntry.metadata);
    }

    // File log
    this._writeToFile(`mqtt-traffic.jsonl`, JSON.stringify(logEntry) + '\n', true);

    // Also write to device-specific log if topic contains device info
    if (topic.includes('/')) {
      const topicParts = topic.split('/');
      if (topicParts.length >= 3) {
        const deviceIdentifier = topicParts[topicParts.length - 2];
        this._writeToFile(`mqtt-device-${deviceIdentifier}.jsonl`, JSON.stringify(logEntry) + '\n', true);
      }
    }
  }

  /**
   * Log MQTT subscription
   */
  logMQTTSubscription(topic, qos = 0) {
    if (!this.debugEnabled.mqtt && !this.debugEnabled.all) return;

    this.log(`MQTT SUBSCRIBE: ${topic} (QoS: ${qos})`);
    this._writeToFile('mqtt-subscriptions.log', `[${new Date().toISOString()}] ${topic} (QoS: ${qos})\n`, true);
  }

  /**
   * Log SSL/TLS handshake details
   */
  logSSLHandshake(details) {
    if (!this.debugEnabled.ssl && !this.debugEnabled.all) return;

    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      ...details
    };

    this.log('SSL/TLS HANDSHAKE');
    this.log(JSON.stringify(logEntry, null, 2));

    this._writeToFile('ssl-handshakes.jsonl', JSON.stringify(logEntry) + '\n', true);
  }

  /**
   * Dump shadow data to file
   */
  dumpShadow(thingName, shadowName, shadowData, metadata = {}) {
    if (!this.debugEnabled.shadows && !this.debugEnabled.all) return;

    this.shadowDumpCount++;
    const timestamp = new Date().toISOString();
    const dumpId = this.shadowDumpCount;

    const dumpEntry = {
      timestamp,
      dumpId,
      thingName: '[REDACTED]',
      shadowName: shadowName || 'default',
      metadata: this._sanitizeData(metadata),
      shadow: this._sanitizeData(shadowData)
    };

    this.log(`SHADOW DUMP #${dumpId}: [redacted]/${shadowName || 'default'}`);
    this.log(`  Keys: ${shadowData ? Object.keys(shadowData).length : 0}`);
    if (metadata.deviceType) {
      this.log(`  DeviceType: ${metadata.deviceType}`);
    }

    // Write to main shadow log
    this._writeToFile('shadows.jsonl', JSON.stringify(dumpEntry) + '\n', true);

    // Write individual shadow file for easy inspection
    const safeName = `redacted-${dumpId}-${shadowName || 'default'}`.replace(/[^a-zA-Z0-9-_]/g, '_');
    this._writeToFile(`shadow-${safeName}.json`, JSON.stringify(dumpEntry, null, 2));
  }

  /**
   * Log sensor-specific data (STH51, etc.)
   */
  logSensorData(deviceType, deviceId, sensorData, source = 'unknown') {
    if (!this.debugEnabled.sensors && !this.debugEnabled.all) return;

    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      deviceType,
      deviceId: '[REDACTED]',
      source, // 'mqtt', 'shadow', 'api'
      data: this._sanitizeData(sensorData)
    };

    this.log(`SENSOR DATA [${deviceType}] [redacted] (${source})`);
    this.log(JSON.stringify(logEntry.data, null, 2));

    // Write to sensor-specific log
    this._writeToFile(`sensor-${deviceType}.jsonl`, JSON.stringify(logEntry) + '\n', true);

    // Write to device-specific log
    const safeDeviceId = 'redacted';
    this._writeToFile(`device-${safeDeviceId}.jsonl`, JSON.stringify(logEntry) + '\n', true);
  }

  /**
   * Log API call
   */
  logAPICall(method, url, bizCode, request, response, duration) {
    if (!this.debugEnabled.api && !this.debugEnabled.all) return;

    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      method,
      url: this._sanitizeLogArg(url),
      bizCode,
      duration,
      request: this._sanitizeData(request),
      response: response ? this._truncateResponse(this._sanitizeData(response)) : null
    };

    this.log(`API CALL: ${bizCode} (${duration}ms)`);
    this.log(`  URL: ${url}`);
    if (response && response.code !== undefined) {
      this.log(`  Response Code: ${response.code}`);
    }

    this._writeToFile('api-calls.jsonl', JSON.stringify(logEntry) + '\n', true);
  }

  /**
   * Log device update with before/after comparison
   */
  logDeviceUpdate(deviceId, deviceName, before, after, source = 'unknown') {
    if (!this.debugEnabled.sensors && !this.debugEnabled.all) return;

    const timestamp = new Date().toISOString();
    const changes = this._detectChanges(before, after);

    const logEntry = {
      timestamp,
      deviceId,
      deviceName,
      source,
      changesDetected: changes.length,
      changes,
      before,
      after
    };

    if (changes.length > 0) {
      this.log(`DEVICE UPDATE: ${deviceName} (${changes.length} changes from ${source})`);
      changes.forEach(change => {
        this.log(`  ${change.field}: ${change.before} → ${change.after}`);
      });
    }

    this._writeToFile('device-updates.jsonl', JSON.stringify(logEntry) + '\n', true);
  }

  /**
   * Create debug snapshot (all current state)
   */
  createSnapshot(label, data) {
    if (!this.debugEnabled.any) return;

    const timestamp = new Date().toISOString();
    const snapshot = {
      timestamp,
      label,
      data
    };

    const filename = `snapshot-${label}-${Date.now()}.json`;
    this._writeToFile(filename, JSON.stringify(snapshot, null, 2));
    this.log(`DEBUG SNAPSHOT created: ${filename}`);
  }

  /**
   * Helper: Try to parse JSON
   */
  _tryParseJSON(str) {
    if (typeof str !== 'string') return str;
    try {
      return JSON.parse(str);
    } catch (e) {
      return str;
    }
  }

  _sanitizeTopic(topic) {
    return String(topic || '')
      .replace(/(\$aws\/things\/)[^/]+/g, '$1[REDACTED]')
      .replace(/(@xsense\/events\/[^/]+\/)[^/]+/g, '$1[REDACTED]');
  }

  _sanitizeLogArg(value) {
    if (value instanceof Error) return this._sanitizeLogArg(value.message);
    if (value && typeof value === 'object') return this._sanitizeData(value);
    if (typeof value !== 'string') return value;
    return value
      .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, '[REDACTED_EMAIL]')
      .replace(/\b(\d{1,3}\.){3}\d{1,3}\b/g, '[REDACTED_IP]')
      .replace(/\b([0-9a-f]{2}[:-]){5}[0-9a-f]{2}\b/gi, '[REDACTED_MAC]')
      .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, '[REDACTED_ID]')
      .replace(/\b(?=[a-z0-9-]{8,}\b)(?=[a-z0-9-]*\d)[a-z0-9-]+\b/gi, '[REDACTED_ID]');
  }

  _sanitizeData(value, depth = 0) {
    if (depth > 12) return '[TRUNCATED]';
    if (Array.isArray(value)) return value.map((item) => this._sanitizeData(item, depth + 1));
    if (value && typeof value === 'object') {
      const result = {};
      let redactedKeyIndex = 0;
      for (const [key, child] of Object.entries(value)) {
        const sensitiveKey = /(password|secret|token|email|ssid|ip(address)?|mac|userid|houseid|station(sn|id)?|device(sn|id)?)/i.test(key);
        const outputKey = /^\d{6,}$/.test(key) ? `[REDACTED_KEY_${redactedKeyIndex += 1}]` : key;
        result[outputKey] = sensitiveKey ? '[REDACTED]' : this._sanitizeData(child, depth + 1);
      }
      return result;
    }
    if (typeof value === 'string') {
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return '[REDACTED_EMAIL]';
      if (/^(\d{1,3}\.){3}\d{1,3}$/.test(value)) return '[REDACTED_IP]';
      if (/^([0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i.test(value)) return '[REDACTED_MAC]';
    }
    return value;
  }

  /**
   * Helper: Write to file
   */
  _writeToFile(filename, content, append = false) {
    if (!this.debugEnabled.any) return;

    try {
      const filepath = path.join(this.debugDir, filename);
      if (append) {
        fs.appendFileSync(filepath, content, 'utf8');
      } else {
        fs.writeFileSync(filepath, content, 'utf8');
      }
    } catch (err) {
      this.error(`[DebugLogger] Failed to write ${filename}:`, err);
    }
  }

  /**
   * Helper: Detect changes between two objects
   */
  _detectChanges(before, after) {
    const changes = [];
    if (!before || !after) return changes;

    const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const key of allKeys) {
      if (before[key] !== after[key]) {
        changes.push({
          field: key,
          before: before[key],
          after: after[key]
        });
      }
    }
    return changes;
  }

  /**
   * Helper: Sanitize request (remove sensitive data)
   */
  _sanitizeRequest(request) {
    if (!request) return null;
    return this._sanitizeData(request);
  }

  /**
   * Helper: Truncate large responses
   */
  _truncateResponse(response, maxLength = 5000) {
    const str = JSON.stringify(response);
    if (str.length > maxLength) {
      return {
        _truncated: true,
        _originalLength: str.length,
        data: str.substring(0, maxLength) + '...[TRUNCATED]'
      };
    }
    return response;
  }

  /**
   * Get debug statistics
   */
  getStats() {
    return {
      enabled: this.debugEnabled,
      mqttMessages: this.mqttMessageCount,
      shadowDumps: this.shadowDumpCount,
      debugDir: this.debugDir
    };
  }
}

module.exports = DebugLogger;
