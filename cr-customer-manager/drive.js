import fs from 'fs';
import { promises as fsPromises } from 'fs';
import path from 'path';
import { google } from 'googleapis';

const TOKEN_FILE_PATH = path.resolve('data', 'drive-tokens.json');
const DRIVE_FOLDER_NAME = 'CR-CRM-Invoices';

let cachedFolderId = null;

async function ensureTokenDirectory() {
  await fsPromises.mkdir(path.dirname(TOKEN_FILE_PATH), { recursive: true });
}

async function writeTokensToFile(tokens) {
  await ensureTokenDirectory();
  await fsPromises.writeFile(TOKEN_FILE_PATH, JSON.stringify(tokens, null, 2), 'utf8');
}

export function buildOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    'http://localhost:3005/auth/google/callback'
  );
}

export function getAuthUrl(oauthClient) {
  return oauthClient.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [
      'https://www.googleapis.com/auth/drive.file',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile'
    ]
  });
}

export async function exchangeCodeForTokens(oauthClient, code) {
  const { tokens } = await oauthClient.getToken(code);
  oauthClient.setCredentials(tokens);

  const oauth2 = google.oauth2({ version: 'v2', auth: oauthClient });
  const { data } = await oauth2.userinfo.get();

  const tokenPayload = {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expiry_date: tokens.expiry_date,
    email: data.email,
    name: data.name,
    picture: data.picture
  };

  await writeTokensToFile(tokenPayload);

  return {
    email: data.email,
    name: data.name,
    picture: data.picture
  };
}

export async function loadStoredTokens(oauthClient) {
  try {
    await fsPromises.access(TOKEN_FILE_PATH, fs.constants.F_OK);
  } catch {
    return null;
  }

  const raw = await fsPromises.readFile(TOKEN_FILE_PATH, 'utf8');
  const tokens = JSON.parse(raw);

  oauthClient.setCredentials(tokens);

  oauthClient.on('tokens', async (newTokens) => {
    try {
      let existingTokens = {};
      try {
        const currentRaw = await fsPromises.readFile(TOKEN_FILE_PATH, 'utf8');
        existingTokens = JSON.parse(currentRaw);
      } catch {
        existingTokens = {};
      }

      const mergedTokens = {
        ...existingTokens,
        ...newTokens
      };

      await writeTokensToFile(mergedTokens);
    } catch {
      // Ignore token auto-save errors
    }
  });

  return tokens;
}

export async function revokeTokens(oauthClient) {
  try {
    await oauthClient.revokeCredentials();
  } catch {
    // Ignore revoke errors
  }

  try {
    await fsPromises.unlink(TOKEN_FILE_PATH);
  } catch {
    // Ignore delete errors
  }

  cachedFolderId = null;
  oauthClient.setCredentials({});
}

export async function getDriveClient(oauthClient) {
  return google.drive({ version: 'v3', auth: oauthClient });
}

export async function ensureCRFolder(drive, folderName = DRIVE_FOLDER_NAME) {
  if (cachedFolderId) {
    return cachedFolderId;
  }

  try {
    const listResponse = await drive.files.list({
      q: `mimeType='application/vnd.google-apps.folder' and name='${folderName}' and trashed=false`,
      fields: 'files(id, name)',
      pageSize: 1
    });

    const existingFolder = listResponse?.data?.files?.[0];
    if (existingFolder?.id) {
      cachedFolderId = existingFolder.id;
      return cachedFolderId;
    }

    const createResponse = await drive.files.create({
      requestBody: {
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder'
      },
      fields: 'id'
    });

    cachedFolderId = createResponse?.data?.id || null;
    return cachedFolderId;
  } catch (error) {
    console.warn('Failed to ensure Drive folder:', error?.message || error);
    return null;
  }
}

export async function uploadInvoiceToDrive(drive, folderId, invoiceData) {
  try {
    const fileName = `cr-invoice-${invoiceData.invoice_number || invoiceData.id}-${invoiceData.id}.json`;
    const content = JSON.stringify(invoiceData, null, 2);

    const existing = await drive.files.list({
      q: `name='${fileName}' and '${folderId}' in parents and trashed=false`,
      fields: 'files(id)',
      pageSize: 1
    });

    const existingFile = existing?.data?.files?.[0];

    if (existingFile?.id) {
      const updated = await drive.files.update({
        fileId: existingFile.id,
        media: {
          mimeType: 'application/json',
          body: content
        },
        fields: 'id, webViewLink'
      });

      return {
        fileId: updated?.data?.id,
        webViewLink: updated?.data?.webViewLink
      };
    }

    const created = await drive.files.create({
      requestBody: {
        name: fileName,
        parents: [folderId]
      },
      media: {
        mimeType: 'application/json',
        body: content
      },
      fields: 'id, webViewLink'
    });

    return {
      fileId: created?.data?.id,
      webViewLink: created?.data?.webViewLink
    };
  } catch (error) {
    console.warn('Failed to upload invoice to Drive:', error?.message || error);
    return null;
  }
}

export async function uploadScanToDrive(drive, folderId, localFilePath, invoiceId) {
  try {
    const extension = path.extname(localFilePath).toLowerCase();

    let mimeType = 'application/octet-stream';
    if (extension === '.pdf') mimeType = 'application/pdf';
    if (extension === '.jpg' || extension === '.jpeg') mimeType = 'image/jpeg';
    if (extension === '.png') mimeType = 'image/png';
    if (extension === '.tiff' || extension === '.tif') mimeType = 'image/tiff';

    const fileName = `cr-scan-${invoiceId}-${path.basename(localFilePath)}`;

    const created = await drive.files.create({
      requestBody: {
        name: fileName,
        parents: [folderId]
      },
      media: {
        mimeType,
        body: fs.createReadStream(localFilePath)
      },
      fields: 'id, webViewLink'
    });

    return {
      fileId: created?.data?.id,
      webViewLink: created?.data?.webViewLink
    };
  } catch (error) {
    console.warn('Failed to upload scan to Drive:', error?.message || error);
    return null;
  }
}

export async function getDriveSyncStatus(oauthClient) {
  try {
    const raw = await fsPromises.readFile(TOKEN_FILE_PATH, 'utf8');
    const tokens = JSON.parse(raw);

    return {
      connected: true,
      email: tokens.email,
      name: tokens.name,
      picture: tokens.picture,
      folderId: cachedFolderId || null,
      folderName: DRIVE_FOLDER_NAME,
      folderLink: cachedFolderId
        ? `https://drive.google.com/drive/folders/${cachedFolderId}`
        : null
    };
  } catch {
    return { connected: false };
  }
}
