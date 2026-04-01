/**
 * Fortified Realty Group — Showing Agent Application
 * Cloudflare Worker Backend
 *
 * Handles video uploads and routes them to Google Drive + Google Sheets.
 * Uses a Google Cloud service account for authentication.
 *
 * Environment Variables (set as Worker Secrets):
 *   GOOGLE_SERVICE_ACCOUNT_JSON — full JSON key file contents
 *   DRIVE_FOLDER_ID — Google Drive folder ID for video storage
 *   SHEET_ID — Google Sheets spreadsheet ID for logging
 *   GOOGLE_CHAT_WEBHOOK — Google Chat webhook URL for notifications
 */

export default {
  async fetch(request, env) {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return corsResponse(new Response(null, { status: 204 }));
    }

    if (request.method !== 'POST') {
      return corsResponse(new Response(JSON.stringify({ error: 'POST required' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json' }
      }));
    }

    try {
      const formData = await request.formData();
      const name = formData.get('name');
      const phone = formData.get('phone');
      const videoFile = formData.get('video');

      if (!name || !phone || !videoFile) {
        return corsResponse(new Response(JSON.stringify({
          error: 'Name, phone, and video file are required'
        }), { status: 400, headers: { 'Content-Type': 'application/json' } }));
      }

      // Get Google access token via service account
      const accessToken = await getGoogleAccessToken(env.GOOGLE_SERVICE_ACCOUNT_JSON);

      // Upload video to Google Drive
      const safeName = name.replace(/[^a-zA-Z0-9\s\-_]/g, '').replace(/\s+/g, '_');
      const driveFileName = `${safeName}_${videoFile.name}`;

      const driveResult = await uploadToDrive(
        accessToken,
        env.DRIVE_FOLDER_ID,
        driveFileName,
        videoFile
      );

      const fileUrl = `https://drive.google.com/file/d/${driveResult.id}/view`;

      // Log to Google Sheet
      const timestamp = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });
      await appendToSheet(accessToken, env.SHEET_ID, [timestamp, name, phone, fileUrl]);

      // Notify via Google Chat
      if (env.GOOGLE_CHAT_WEBHOOK) {
        try {
          await notifyGoogleChat(env.GOOGLE_CHAT_WEBHOOK, name, phone, timestamp, fileUrl);
        } catch (notifyErr) {
          console.error('Chat notification failed:', notifyErr);
        }
      }

      return corsResponse(new Response(JSON.stringify({
        status: 'success',
        url: fileUrl
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }));

    } catch (err) {
      console.error('Upload error:', err);
      return corsResponse(new Response(JSON.stringify({
        error: 'Upload failed: ' + err.message
      }), { status: 500, headers: { 'Content-Type': 'application/json' } }));
    }
  }
};

// ============================================================
// Google Auth — Service Account JWT → Access Token
// ============================================================

async function getGoogleAccessToken(serviceAccountJson) {
  const sa = JSON.parse(serviceAccountJson);
  const now = Math.floor(Date.now() / 1000);

  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  };

  const jwt = await signJwt(header, payload, sa.private_key);

  const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
  });

  const tokenData = await tokenResp.json();
  if (!tokenData.access_token) {
    throw new Error('Failed to get Google access token: ' + JSON.stringify(tokenData));
  }

  return tokenData.access_token;
}

async function signJwt(header, payload, privateKeyPem) {
  const enc = new TextEncoder();

  const headerB64 = base64url(JSON.stringify(header));
  const payloadB64 = base64url(JSON.stringify(payload));
  const signingInput = `${headerB64}.${payloadB64}`;

  const pemContents = privateKeyPem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s/g, '');

  const keyData = Uint8Array.from(atob(pemContents), c => c.charCodeAt(0));

  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    keyData,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    enc.encode(signingInput)
  );

  const sigB64 = base64url(signature);
  return `${signingInput}.${sigB64}`;
}

function base64url(input) {
  let str;
  if (typeof input === 'string') {
    str = btoa(input);
  } else {
    const bytes = new Uint8Array(input);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    str = btoa(binary);
  }
  return str.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ============================================================
// Google Drive — Upload file
// ============================================================

async function uploadToDrive(accessToken, folderId, fileName, file) {
  const metadata = {
    name: fileName,
    parents: [folderId]
  };

  const boundary = '---fortified-upload-boundary---';
  const metadataPart = JSON.stringify(metadata);

  const fileArrayBuffer = await file.arrayBuffer();

  const encoder = new TextEncoder();
  const parts = [
    encoder.encode(
      `--${boundary}\r\n` +
      `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
      `${metadataPart}\r\n` +
      `--${boundary}\r\n` +
      `Content-Type: ${file.type || 'video/mp4'}\r\n\r\n`
    ),
    new Uint8Array(fileArrayBuffer),
    encoder.encode(`\r\n--${boundary}--`)
  ];

  const totalLength = parts.reduce((sum, p) => sum + p.byteLength, 0);
  const body = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    body.set(part, offset);
    offset += part.byteLength;
  }

  const resp = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name,webViewLink',
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`
      },
      body: body
    }
  );

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Drive upload failed (${resp.status}): ${errText}`);
  }

  return await resp.json();
}

// ============================================================
// Google Sheets — Append row
// ============================================================

async function appendToSheet(accessToken, sheetId, values) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/A:D:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      values: [values]
    })
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Sheet append failed (${resp.status}): ${errText}`);
  }

  return await resp.json();
}

// ============================================================
// CORS helper
// ============================================================

function corsResponse(response) {
  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type');

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

// ============================================================
// Google Chat Webhook Notification
// ============================================================

async function notifyGoogleChat(webhookUrl, applicantName, phone, timestamp, fileUrl) {
  const message = {
    text: `🏠 *New Showing Agent Application*\n\n*Name:* ${applicantName}\n*Phone:* ${phone}\n*Time:* ${timestamp}\n*Video:* ${fileUrl}`
  };

  const resp = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(message)
  });

  if (!resp.ok) {
    throw new Error(`Chat webhook failed (${resp.status})`);
  }
}
