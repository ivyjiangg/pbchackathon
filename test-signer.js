const { signAndPay } = require('./signer');

signAndPay(0.01, '3KZHQxPGJLxvFawG4mGHqtZjGQkDJW1THWLqdjyonGn3')
  .then(sig => console.log('signAndPay works. Sig:', sig))
  .catch(err => {
    console.error('signAndPay error:', err.message);
    console.error('Full error:', err);
    if (err.message && err.message.includes('insufficient')) {
      console.log('Expected: wallet has no Devnet USDC yet. Key reconstruction worked.');
    }
  });
