// ============================================================
// Fortified Realty Group — Showing Agent Application Backend
// Google Apps Script  (paste into script.google.com)
// ============================================================
//
// SETUP (one-time, ~2 minutes):
//
// 1. Go to https://script.google.com and click "New Project"
// 2. Delete the placeholder code and paste this entire file
// 3. Update the FOLDER_ID and SHEET_ID below (instructions in comments)
// 4. Click Deploy > New deployment
//    - Type: "Web app"
//    - Execute as: "Me"
//    - Who has access: "Anyone"
// 5. Copy the Web App URL and paste it into your application page
//    (replace __APPS_SCRIPT_URL__ in index.html)
// ============================================================

// ── CONFIGURATION ──

// Create a Google Drive folder called "Showing Agent Applications"
// and paste its ID here. (Open the folder → grab the ID from the URL:
// https://drive.google.com/drive/folders/THIS_IS_THE_ID)
const FOLDER_ID = '1i2lgkI8dyuBZWJveah1C3Ydsmu3j8Lji';

// Create a Google Sheet called "Showing Agent Applications"
// with headers in Row 1:  Timestamp | Full Name | Phone | Video Link
// Paste the Sheet ID here. (Open the sheet → grab from URL:
// https://docs.google.com/spreadsheets/d/THIS_IS_THE_ID/edit)
const SHEET_ID = '14RtpFBd0dGp1gcsoWiUe9t4ihi29zhJmaeuEtIGUAyg';

// Google Chat webhook URL for instant notifications
const GOOGLE_CHAT_WEBHOOK = 'https://chat.googleapis.com/v1/spaces/AAQAdS7gYW4/messages?key=AIzaSyDdI0hCZtE6vySjMm-WEfRq3CPzqKqqsHI&token=cwGbECCB4q2bfD2tjZI7nXrBGHzP9nMd14j2RMNpIww';


// ── MAIN HANDLER ──

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);

    const fullName  = data.fullName || 'Unknown';
    const phone     = data.phone || 'N/A';
    const fileNameOriginal = data.fileName || 'video.mp4';
    const mimeType  = data.mimeType || 'video/mp4';
    const fileData  = data.fileData; // base64 string

    // Decode the video and save to Drive
    const blob = Utilities.newBlob(
      Utilities.base64Decode(fileData),
      mimeType,
      sanitize(fullName) + ' - ' + fileNameOriginal
    );

    const folder = DriveApp.getFolderById(FOLDER_ID);
    const file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    const videoUrl = file.getUrl();

    // Log to Google Sheet
    const sheet = SpreadsheetApp.openById(SHEET_ID).getSheets()[0];
    sheet.appendRow([
      new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }),
      fullName,
      phone,
      videoUrl
    ]);

    // Send yourself an email notification
    MailApp.sendEmail({
      to: Session.getActiveUser().getEmail(),
      subject: '🏠 New Showing Agent Application: ' + fullName,
      htmlBody:
        '<h2>New Application Received</h2>' +
        '<p><strong>Name:</strong> ' + fullName + '</p>' +
        '<p><strong>Phone:</strong> ' + phone + '</p>' +
        '<p><strong>Video:</strong> <a href="' + videoUrl + '">Watch Video</a></p>' +
        '<br><p style="color:#666;">— Fortified Realty Group Application System</p>'
    });

    // Send Google Chat notification
    sendChatNotification(fullName, phone, videoUrl);

    return ContentService
      .createTextOutput(JSON.stringify({ status: 'ok' }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'error', message: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// Send notification to Google Chat space
function sendChatNotification(fullName, phone, videoUrl) {
  const message = {
    text: '🏠 *New Showing Agent Application*' +
          '\n\n*Name:* ' + fullName +
          '\n*Phone:* ' + phone +
          '\n*Video:* ' + videoUrl
  };

  UrlFetchApp.fetch(GOOGLE_CHAT_WEBHOOK, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(message)
  });
}

// Sanitize name for filename
function sanitize(str) {
  return str.replace(/[^a-zA-Z0-9 \-]/g, '').trim().substring(0, 50);
}
