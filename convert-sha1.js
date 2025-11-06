// Convert SHA1 fingerprint to Facebook Key Hash (Base64)
const sha1 = 'A1:44:BD:09:6C:D9:38:6D:FF:00:56:4C:CF:D5:C7:F5:D3:3B:FB:56';

// Remove colons and convert hex to bytes
const hex = sha1.replace(/:/g, '');
const bytes = Buffer.from(hex, 'hex');

// Convert to Base64
const base64 = bytes.toString('base64');

console.log('\n=================================');
console.log('Facebook Key Hash:');
console.log(base64);
console.log('=================================\n');
console.log('Copy this and paste it into Facebook Developer Console under:');
console.log('Settings → Basic → Android → Key Hashes\n');
