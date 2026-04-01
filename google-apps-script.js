const FOLDER_ID = '1i2lgkI8dyuBZWJveah1C3Ydsmu3j8Lji';
const SHEET_ID = '14RtpFBd0dGp1gcsoWiUe9t4ihi29zhJmaeuEtIGUAyg';

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);

    const fullName = data.fullName || 'Unknown';
    const phone = data.phone || 'N/A';
    const fileNameOriginal = data.fileName || 'video.mp4';
    const mimeType = data.mimeType || 'video/mp4';
    const fileData = data.fileData;

    const blob = Utilities.newBlob(
      Utilities.base64Decode(fileData),
      mimeType,
      sanitize(fullName) + ' - ' + fileNameOriginal
    );

    const folder = DriveApp.getFolderById(FOLDER_ID);
    const file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    const videoUrl = file.getUrl();

    const sheet = SpreadsheetApp.openById(SHEET_ID).getSheets()[0];
    sheet.appendRow([
      new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }),
      fullName,
      phone,
      videoUrl
    ]);

    MailApp.sendEmail({
      to: Session.getActiveUser().getEmail(),
      subject: 'New Showing Agent Application: ' + fullName,
      htmlBody:
        '<h2>New Application Received</h2>' +
        '<p><strong>Name:</strong> ' + fullName + '</p>' +
        '<p><strong>Phone:</strong> ' + phone + '</p>' +
        '<p><strong>Video:</strong> <a href="' + videoUrl + '">Watch Video</a></p>'
    });

    return ContentService
      .createTextOutput(JSON.stringify({ status: 'ok' }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'error', message: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function sanitize(str) {
  return str.replace(/[^a-zA-Z0-9 \-]/g, '').trim().substring(0, 50);
}
