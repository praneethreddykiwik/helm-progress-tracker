function classifyOutcome(response, executionId) {
  const code = Number(response.statusCode || 0);
  const body = response.body || {};
  if (code >= 200 && code < 300 && typeof body.id === 'string' && body.id) {
    return { state: 'provider-accepted', provider_id: body.id, execution_id: String(executionId) };
  }
  if (code === 429 || code >= 500 || !code || code >= 200 && code < 300) {
    return { state: 'uncertain', error: 'unknown_outcome', execution_id: String(executionId) };
  }
  return { state: 'failed', error: 'provider_rejected', execution_id: String(executionId) };
}
