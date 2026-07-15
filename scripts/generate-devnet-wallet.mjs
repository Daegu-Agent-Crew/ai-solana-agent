import { Keypair } from '@solana/web3.js';

const keypair = Keypair.generate();
const secret = JSON.stringify(Array.from(keypair.secretKey));

console.log('Devnet agent wallet created.');
console.log(`Public key: ${keypair.publicKey.toBase58()}`);
console.log('Add the following value as GitHub Actions secret DEVNET_AGENT_KEYPAIR:');
console.log(secret);
console.log('\nNever commit this value to the repository. Use Devnet only.');
