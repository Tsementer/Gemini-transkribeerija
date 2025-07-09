// netlify/functions/debug-env.js

exports.handler = async function (event) {
  const results = {};

  // Kontrollime GCLOUD_PROJECT muutujat
  if (process.env.GCLOUD_PROJECT) {
    results.gcloud_project = `Leitud, väärtus: ${process.env.GCLOUD_PROJECT}`;
  } else {
    results.gcloud_project = 'VIGA: GCLOUD_PROJECT muutujat ei leitud!';
  }

  // Kontrollime mandaatide olemasolu ja pikkust
  const credsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  if (credsJson && credsJson.length > 100) {
    results.credentials_exist = `Leitud, pikkus: ${credsJson.length} tähemärki.`;
    
    // Proovime JSON-it parsida, et kontrollida selle korrektsust
    try {
      const parsedCreds = JSON.parse(credsJson);
      if (parsedCreds.client_email) {
        results.credentials_valid = `OK, JSON on korrektne. E-post: ${parsedCreds.client_email}`;
      } else {
        results.credentials_valid = 'VIGA: JSON on vigane, "client_email" välja ei leitud.';
      }
    } catch (e) {
      results.credentials_valid = `VIGA: JSON-i parsimine ebaõnnestus! Viga: ${e.message}`;
    }

  } else {
    results.credentials_exist = 'VIGA: GOOGLE_APPLICATION_CREDENTIALS_JSON muutujat ei leitud või on see liiga lühike!';
    results.credentials_valid = 'Kontrolli ei saa teostada.';
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(results, null, 2),
  };
};
