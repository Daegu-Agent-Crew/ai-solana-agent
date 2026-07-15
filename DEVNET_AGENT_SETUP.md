# Devnet Agent Setup

## 1. Create the dedicated wallet locally

```bash
npm install
npm run agent:wallet
```

The command prints:

- a public Devnet wallet address
- a 64-integer JSON secret array

Never commit the secret array.

## 2. Add the GitHub Actions secret

Repository → Settings → Secrets and variables → Actions → New repository secret

- Name: `DEVNET_AGENT_KEYPAIR`
- Value: the complete 64-integer JSON array

## 3. Fund only the Devnet wallet

Send a small amount of Devnet SOL to the printed public address. Recommended: `0.05 SOL`.

Do not send mainnet SOL or real assets.

## 4. Run the agent transaction test

Repository → Actions → Devnet Agent Test → Run workflow

Set `Run the signed zero-SOL self-transaction test` to `true`.

## Enforced safety policy

The current script:

- rejects any RPC URL that does not contain `devnet`
- permits only a zero-lamport transfer
- permits only a self-transfer to the same agent wallet
- has no arbitrary recipient, token transfer, swap, or mainnet command
- skips signed tests when the secret is absent

The next development stage should extend this policy one operation at a time.
