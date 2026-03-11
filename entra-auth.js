'use strict';

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');

const ALLOWED_DOMAIN = 'oiclove.onmicrosoft.com';

function isEntraConfigured() {
  return !!(
    process.env.ENTRA_CLIENT_ID &&
    process.env.ENTRA_CLIENT_SECRET &&
    process.env.ENTRA_TENANT_ID &&
    process.env.ENTRA_REDIRECT_URI
  );
}

function getTenantAuthority() {
  const tenant = (process.env.ENTRA_TENANT_ID || '').trim();
  return `https://login.microsoftonline.com/${tenant}`;
}

const STATE_TTL_MS = 10 * 60 * 1000;

function createSignedState() {
  const secret = process.env.SESSION_SECRET || 'sales-report-secret-change-in-production';
  const r = crypto.randomBytes(16).toString('hex');
  const t = String(Date.now());
  const payload = r + '.' + t;
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return payload + '.' + sig;
}

function verifySignedState(stateParam) {
  if (!stateParam || typeof stateParam !== 'string') return false;
  const parts = stateParam.split('.');
  if (parts.length !== 3) return false;
  const [r, t, sig] = parts;
  const secret = process.env.SESSION_SECRET || 'sales-report-secret-change-in-production';
  const payload = r + '.' + t;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  if (expected !== sig) return false;
  const ts = parseInt(t, 10);
  if (isNaN(ts) || Date.now() - ts > STATE_TTL_MS || ts > Date.now() + 60000) return false;
  return true;
}

function getAuthorizationUrl(state) {
  const authority = getTenantAuthority();
  const clientId = process.env.ENTRA_CLIENT_ID;
  const redirectUri = process.env.ENTRA_REDIRECT_URI;
  const scope = 'openid email profile';
  const stateValue = state || createSignedState();
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope,
    state: stateValue,
    response_mode: 'query',
  });
  return `${authority}/oauth2/v2.0/authorize?${params.toString()}`;
}

async function exchangeCodeForTokens(code) {
  const authority = getTenantAuthority();
  const tokenUrl = `${authority}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: process.env.ENTRA_CLIENT_ID,
    client_secret: process.env.ENTRA_CLIENT_SECRET,
    code,
    redirect_uri: process.env.ENTRA_REDIRECT_URI,
    grant_type: 'authorization_code',
  });
  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed: ${res.status} ${text}`);
  }
  return res.json();
}

function getSigningKey(header, callback) {
  const tenant = (process.env.ENTRA_TENANT_ID || '').trim();
  const jwksUri = `https://login.microsoftonline.com/${tenant}/discovery/v2.0/keys`;
  const client = jwksClient({
    jwksUri,
    cache: true,
    cacheMaxAge: 600000,
    rateLimit: true,
  });
  client.getSigningKey(header.kid, (err, key) => {
    if (err) return callback(err);
    if (!key) return callback(new Error('No signing key found'));
    const signingKey = key.getPublicKey();
    callback(null, signingKey);
  });
}

function validateIdToken(idToken) {
  const clientId = process.env.ENTRA_CLIENT_ID;
  // Azure id_token "iss" uses tenant GUID, not domain. Use ENTRA_TENANT_GUID for validation if set.
  const tenantForIssuer = (process.env.ENTRA_TENANT_GUID || process.env.ENTRA_TENANT_ID || '').trim();
  const issuer = `https://login.microsoftonline.com/${tenantForIssuer}/v2.0`;
  return new Promise((resolve, reject) => {
    jwt.verify(
      idToken,
      getSigningKey,
      {
        algorithms: ['RS256'],
        audience: clientId,
        issuer,
        ignoreExpiration: false,
      },
      (err, decoded) => {
        if (err) return reject(err);
        resolve(decoded);
      }
    );
  });
}

function getAllowedDomain() {
  return ALLOWED_DOMAIN;
}

function isAllowedEmail(email) {
  if (!email || typeof email !== 'string') return false;
  const domain = email.split('@')[1];
  if (!domain) return false;
  return domain.toLowerCase() === ALLOWED_DOMAIN.toLowerCase();
}

function getEmailFromPayload(decoded) {
  return decoded.email || decoded.preferred_username || decoded.upn || null;
}

function getAdminEmails() {
  const raw = process.env.ENTRA_ADMIN_EMAILS || '';
  return raw
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

function isAdminEmail(email) {
  if (!email) return false;
  const admins = getAdminEmails();
  if (admins.length === 0) return false;
  return admins.includes(email.toLowerCase());
}

module.exports = {
  isEntraConfigured,
  createSignedState,
  verifySignedState,
  getAuthorizationUrl,
  exchangeCodeForTokens,
  validateIdToken,
  getAllowedDomain,
  isAllowedEmail,
  getEmailFromPayload,
  isAdminEmail,
};
