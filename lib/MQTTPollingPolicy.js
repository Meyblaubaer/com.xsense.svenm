'use strict';

function activeHouseIds(client) {
  if (client && typeof client.getActiveMQTTHouseIds === 'function') {
    return client.getActiveMQTTHouseIds();
  }

  if (!(client?.mqttClients instanceof Map)) return [];

  const ids = new Set();
  for (const info of client.mqttClients.values()) {
    if (info?.house?.houseId) ids.add(info.house.houseId);
  }
  return Array.from(ids);
}

function shouldPollForMQTT(client, healthByHouse) {
  const houseIds = activeHouseIds(client);
  if (houseIds.length === 0) return true;
  return houseIds.some(houseId => healthByHouse.get(houseId) !== true);
}

function isFallbackPollDue(client, healthByHouse, lastPoll, now, intervalMs = 300000) {
  return shouldPollForMQTT(client, healthByHouse) && (now - lastPoll) >= intervalMs;
}

module.exports = {
  activeHouseIds,
  isFallbackPollDue,
  shouldPollForMQTT,
};
