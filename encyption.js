const crypto = require('crypto');
const KEY = Buffer.from(process.env.ENCRYPTION_KEY, 'hex');
const ALGORITHM = 'aes-256-cbc';

function encrypt(text) {}
function decrypt(encrypted) {}

module.exports = {encrypt, decrypt}