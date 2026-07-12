// =====================================================================
// Reel Room — Configuration
// Follow SETUP_GUIDE.md to get your own CLIENT_ID from Google Cloud
// Console, then paste it below. Nothing else in this file needs to change.
// =====================================================================

const CONFIG = {
  // Paste your OAuth 2.0 Web Client ID here (ends with .apps.googleusercontent.com)
  CLIENT_ID: "PASTE_YOUR_GOOGLE_CLIENT_ID_HERE.apps.googleusercontent.com",

  // Drive scope: app can only see/edit files IT creates — it can never
  // browse or read the rest of your Google Drive.
  DRIVE_SCOPE: "https://www.googleapis.com/auth/drive.file",

  // Name of the folder this app creates inside your Drive
  APP_FOLDER_NAME: "Reel Room Data",
  DATA_FILE_NAME: "reel-room-data.json"
};
