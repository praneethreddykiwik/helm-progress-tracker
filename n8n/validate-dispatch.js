function validateDispatch(payload, expectedOrigin, clock = Date.now()) {
  if (!expectedOrigin || !/^https:\/\/[a-z0-9.-]+(?::[0-9]+)?$/i.test(expectedOrigin)) {
    throw new Error('Configure the HTTPS app origin in this node before enabling delivery.');
  }
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!payload || payload.schema_version !== 1 || !uuid.test(payload.delivery_id || '') || !uuid.test(payload.event_id || '')) {
    throw new Error('Invalid notification envelope.');
  }
  if (typeof payload.capability !== 'string' || !/^[0-9a-f]{64}$/.test(payload.capability)) {
    throw new Error('Invalid notification capability.');
  }
  if (!Number.isFinite(payload.timestamp) || Math.abs(clock - payload.timestamp) > 300000) {
    throw new Error('Expired notification envelope.');
  }
  if (payload.base_url !== expectedOrigin) throw new Error('Application origin does not match the configured allowlist.');
  return { delivery_id: payload.delivery_id, event_id: payload.event_id, capability: payload.capability, base_url: expectedOrigin };
}
