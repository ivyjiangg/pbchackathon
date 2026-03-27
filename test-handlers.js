const h = require('./handlers');

let passed = 0;
let failed = 0;

function assert(label, condition) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ FAILED: ${label}`);
    failed++;
  }
}

async function run() {
  console.log('\n=== TEST: provisionWallet ===');
  const result = await h.provisionWallet({
    dailyBudget: 5.00,
    weeklyBudget: 25.00,
    monthlyBudget: 100.00,
    perTxLimit: 1.00,
    autoApproveThreshold: 2.00,
    whitelistedURLs: ['localhost:9090'],
    blacklistedURLs: ['casino.com'],
    whitelistedAddresses: [],
    blacklistedAddresses: ['BadActorAddress123'],
    whitelistedProgramIDs: [],
    blacklistedProgramIDs: ['BadProgramID123'],
    allowedTokenMints: [],
    blockedTokenMints: [],
    keywordBlocklist: ['drain', 'casino'],
    forbiddenActions: ['swap on unapproved DEX'],
    priorityInstructions: 'Never interact with meme tokens.'
  });
  assert('provisionWallet returns success', result.success === true);
  assert('provisionWallet returns a public key', typeof result.publicKey === 'string' && result.publicKey.length > 30);

  console.log('\n=== TEST: getWalletStatus ===');
  const status = h.getWalletStatus();
  assert('wallet is provisioned', status.provisioned === true);
  assert('publicKey is present', !!status.publicKey);
  assert('share2 file exists', status.share2Exists === true);
  assert('recovery file exists', status.recoveryExists === true);

  console.log('\n=== TEST: getConfig ===');
  const config = h.getConfig();
  assert('config has dailyBudgetUSDC', config.dailyBudgetUSDC === 5.00);
  assert('config has weeklyBudgetUSDC', config.weeklyBudgetUSDC === 25.00);
  assert('config has monthlyBudgetUSDC', config.monthlyBudgetUSDC === 100.00);
  assert('config has perTransactionLimitUSDC', config.perTransactionLimitUSDC === 1.00);
  assert('config has autoApproveThresholdUSDC', config.autoApproveThresholdUSDC === 2.00);
  assert('config has blacklistedURLs', Array.isArray(config.blacklistedURLs));
  assert('blacklistedURLs contains casino.com', config.blacklistedURLs.includes('casino.com'));
  assert('config has blacklistedAddresses', Array.isArray(config.blacklistedAddresses));
  assert('blacklistedAddresses populated', config.blacklistedAddresses.length > 0);
  assert('config has keywordBlocklist', Array.isArray(config.keywordBlocklist));
  assert('keywordBlocklist contains drain', config.keywordBlocklist.includes('drain'));
  assert('config has priorityInstructions', typeof config.priorityInstructions === 'string');
  assert('config has forbiddenActions', Array.isArray(config.forbiddenActions));
  assert('config has allowedTokenMints', Array.isArray(config.allowedTokenMints));
  assert('config has blockedTokenMints', Array.isArray(config.blockedTokenMints));
  assert('config has walletPublicKey', !!config.walletPublicKey);

  console.log('\n=== TEST: savePolicy (update without re-provisioning) ===');
  const saveResult = h.savePolicy({
    dailyBudget: 3.00,
    weeklyBudget: 15.00,
    monthlyBudget: 60.00,
    perTxLimit: 0.75,
    autoApproveThreshold: 1.50,
    whitelistedURLs: ['localhost:9090', 'api.trusted.com'],
    blacklistedURLs: ['casino.com', 'drain.io'],
    blacklistedAddresses: ['BadActorAddress123'],
    whitelistedAddresses: [],
    blacklistedProgramIDs: [],
    whitelistedProgramIDs: [],
    allowedTokenMints: [],
    blockedTokenMints: [],
    keywordBlocklist: ['drain', 'rug', 'casino'],
    forbiddenActions: [],
    priorityInstructions: 'Only use approved DEXes.'
  });
  assert('savePolicy returns success', saveResult.success === true);
  const updated = h.getConfig();
  assert('config updated dailyBudget to 3.00', updated.dailyBudgetUSDC === 3.00);
  assert('walletPublicKey preserved after savePolicy', !!updated.walletPublicKey);
  assert('keywordBlocklist has rug', updated.keywordBlocklist.includes('rug'));

  console.log('\n=== TEST: getSpendStats ===');
  const stats = h.getSpendStats();
  assert('spentTodayUSDC exists', typeof stats.spentTodayUSDC === 'number');
  assert('dailyRemaining exists', typeof stats.dailyRemaining === 'number');
  assert('weeklyRemaining exists', typeof stats.weeklyRemaining === 'number');
  assert('monthlyRemaining exists', typeof stats.monthlyRemaining === 'number');

  console.log('\n=== TEST: resetSpendCounters ===');
  const resetResult = h.resetSpendCounters('all');
  assert('resetSpendCounters returns success', resetResult.success === true);
  assert('spentTodayUSDC reset to 0', resetResult.spend.spentTodayUSDC === 0);
  assert('spentWeekUSDC reset to 0', resetResult.spend.spentWeekUSDC === 0);
  assert('spentMonthUSDC reset to 0', resetResult.spend.spentMonthUSDC === 0);

  console.log('\n=== TEST: getPendingApprovals (empty) ===');
  const pending = h.getPendingApprovals();
  assert('getPendingApprovals returns array', Array.isArray(pending));

  console.log('\n=== TEST: denyTransaction (simulate pending entry) ===');
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const PENDING_PATH = path.join(os.homedir(), '.aegis', 'pending.json');
  const mockPending = [{
    id: 'test-tx-001',
    amount: 2.50,
    url: 'api.example.com/data',
    recipient: 'FakeRecipientAddress123',
    timestamp: new Date().toISOString(),
    status: 'PENDING'
  }];
  fs.writeFileSync(PENDING_PATH, JSON.stringify(mockPending, null, 2));

  const denyResult = h.denyTransaction('test-tx-001');
  assert('denyTransaction returns success', denyResult.success === true);

  const activity = h.getActivity();
  const deniedEntry = activity.find(a => a.id === 'test-tx-001');
  assert('denied tx appears in activity log', !!deniedEntry);
  assert('denied tx has status DENIED', deniedEntry && deniedEntry.status === 'DENIED');

  console.log('\n=== TEST: exportRecoveryShare ===');
  const recovery = await h.exportRecoveryShare();
  assert('exportRecoveryShare returns success', recovery.success === true);
  assert('share3 is a non-empty string', typeof recovery.share3 === 'string' && recovery.share3.length > 10);

  console.log('\n=== TEST: getActivity ===');
  const activityLog = h.getActivity();
  assert('getActivity returns array', Array.isArray(activityLog));
  assert('activity log has at least one entry', activityLog.length > 0);

  console.log(`\n${'─'.repeat(40)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed === 0) console.log('ALL TESTS PASSED ✓');
  else console.log('SOME TESTS FAILED — check output above');
}

run().catch(err => {
  console.error('\nTest runner crashed:', err.message);
  console.error(err);
});
