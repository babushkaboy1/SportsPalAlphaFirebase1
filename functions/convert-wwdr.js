const fs = require('fs');
const path = require('path');

const cerPath = path.join(__dirname, 'secrets', 'wwdr.cer');
const pemPath = path.join(__dirname, 'secrets', 'wwdr.pem');

try {
  const derBuffer = fs.readFileSync(cerPath);
  const base64 = derBuffer.toString('base64');
  
  // Split into 64-char lines
  const lines = base64.match(/.{1,64}/g) || [];
  const pem = [
    '-----BEGIN CERTIFICATE-----',
    ...lines,
    '-----END CERTIFICATE-----',
    ''
  ].join('\n');

  fs.writeFileSync(pemPath, pem);
  console.log('Converted wwdr.cer to wwdr.pem');
} catch (e) {
  console.error('Error converting certificate:', e);
}
