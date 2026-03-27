const keytar = require('keytar');

async function test() {
  await keytar.setPassword('aegis-test', 'account1', 'hello-world');
  const val = await keytar.getPassword('aegis-test', 'account1');
  console.log('Retrieved:', val);
  if (val !== 'hello-world') throw new Error('VALUE MISMATCH');
  await keytar.deletePassword('aegis-test', 'account1');
  console.log('Keytar works.');
}

test().catch(err => {
  console.error('KEYTAR FAILED:', err.message);
  console.log('Fix: npm rebuild keytar');
});
