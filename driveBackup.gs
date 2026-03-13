// Google Apps Script — deploy as Web App
// Execute as: Me | Who has access: Anyone
// After deploy, copy the Web App URL into Settings → Google Drive Script URL

var FOLDER_NAME = 'PPT Designer Backup';

function doPost(e) {
  try {
    var params = JSON.parse(e.postData.contents);
    var base64Data = params.imageData;
    var filename   = params.filename || ('slide_' + Date.now() + '.jpg');

    // Get or create backup folder
    var folders = DriveApp.getFoldersByName(FOLDER_NAME);
    var folder  = folders.hasNext() ? folders.next() : DriveApp.createFolder(FOLDER_NAME);

    // Decode base64 and create file
    var bytes = Utilities.base64Decode(base64Data);
    var blob  = Utilities.newBlob(bytes, 'image/jpeg', filename);
    var file  = folder.createFile(blob);

    // Make file readable by anyone with link
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    var viewUrl     = 'https://drive.google.com/file/d/' + file.getId() + '/view';
    var directUrl   = 'https://drive.google.com/uc?id=' + file.getId() + '&export=view';

    return ContentService
      .createTextOutput(JSON.stringify({ ok: true, url: directUrl, viewUrl: viewUrl, id: file.getId() }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// GET: health check OR fetch image bytes by fileId
function doGet(e) {
  if (e.parameter && e.parameter.fileId) {
    try {
      var file   = DriveApp.getFileById(e.parameter.fileId);
      var blob   = file.getBlob();
      var base64 = Utilities.base64Encode(blob.getBytes());
      return ContentService
        .createTextOutput(JSON.stringify({ ok: true, data: base64, mimeType: blob.getContentType() }))
        .setMimeType(ContentService.MimeType.JSON);
    } catch (err) {
      return ContentService
        .createTextOutput(JSON.stringify({ ok: false, error: err.toString() }))
        .setMimeType(ContentService.MimeType.JSON);
    }
  }
  return ContentService
    .createTextOutput(JSON.stringify({ ok: true, message: 'PPT Designer Drive backup ready' }))
    .setMimeType(ContentService.MimeType.JSON);
}
