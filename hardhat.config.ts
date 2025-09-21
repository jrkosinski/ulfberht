import { HardhatUserConfig } from 'hardhat/config';
import '@nomicfoundation/hardhat-toolbox';

require('dotenv').config();

const FALLBACK_PRIVATE_KEY =
    'c0ffee254729296a45a3885630617005af6f3a571fe75275a9AC7E10F9d54979';

const config: HardhatUserConfig = {
    solidity: {
        version: '0.8.28',
        settings: {
            optimizer: {
                enabled: true,
                runs: 1000,
            },
        },
    },
    paths: {
        sources: './src', // Directory for your Solidity contracts
        tests: './hardhat-test', // Directory for your Hardhat tests
        cache: './cache',
        artifacts: './artifacts',
    },
    networks: {
        hardhat: {
            // You can configure different networks here if needed
        },
        sepolia: {
            accounts: [process.env.SEPOLIA_PRIVATE_KEY ?? FALLBACK_PRIVATE_KEY],
            chainId: 11155111,
            url: `https://sepolia.infura.io/v3/${process.env.INFURA_ID}`,
        },
        optimism: {
            accounts: [
                process.env.OPTIMISM_PRIVATE_KEY ?? FALLBACK_PRIVATE_KEY,
            ],
            chainId: 10,
            url: `https://mainnet.optimism.io`,
        },
        ethereum: {
            accounts: [
                process.env.OPTIMISM_PRIVATE_KEY ?? FALLBACK_PRIVATE_KEY,
            ],
            chainId: 1,
            url: `https://ethereum-rpc.publicnode.com`,
        },
        arbitrum: {
            accounts: [
                process.env.OPTIMISM_PRIVATE_KEY ?? FALLBACK_PRIVATE_KEY,
            ],
            chainId: 42161,
            url: `https://arb1.arbitrum.io/rpc`,
        },
        base: {
            accounts: [
                process.env.OPTIMISM_PRIVATE_KEY ?? FALLBACK_PRIVATE_KEY,
            ],
            chainId: 8453,
            url: `https://mainnet.base.org`,
        },
        polygon: {
            accounts: [
                process.env.OPTIMISM_PRIVATE_KEY ?? FALLBACK_PRIVATE_KEY,
            ],
            chainId: 137,
            url: `https://polygon.api.onfinality.io/public`,
        },
        amoy: {
            accounts: [
                process.env.OPTIMISM_PRIVATE_KEY ?? FALLBACK_PRIVATE_KEY,
            ],
            chainId: 80002,
            url: `https://rpc-amoy.polygon.technology`,
        },
        op_sepolia: {
            url: 'https://sepolia.optimism.io',
            chainId: 11155420,
            gasPrice: 8000000000,
            gasMultiplier: 2,
            accounts: [process.env.SEPOLIA_PRIVATE_KEY ?? FALLBACK_PRIVATE_KEY],
        },
        optimism_sepolia: {
            accounts: [process.env.SEPOLIA_PRIVATE_KEY ?? FALLBACK_PRIVATE_KEY],
            chainId: 11155420,
            url: `https://sepolia.optimism.io`,
        },
    },
};

export default config;
